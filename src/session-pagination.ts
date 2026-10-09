import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { TwitterError } from './errors.js';

const rawPage = z.object({
  tweets: z.array(z.object({ id: z.string().regex(/^[1-9]\d{0,19}$/) }).passthrough()).max(200),
  cursor: z.string().min(1).max(4096).nullable(),
  source: z.literal('twscrape'),
  fetchedAt: z.string(),
  twscrapeVersion: z.string(),
  partial: z.boolean().optional(),
  user: z.record(z.unknown()).optional(),
});
type State = {
  binding: string;
  cursor: string | null;
  started: boolean;
  pending: Record<string, unknown>[];
  seen: Set<string>;
  cursors: Set<string>;
  meta: Record<string, unknown>;
  expiresAt: number;
};

// Tokens refer to bounded, process-local snapshots, never cookies or raw X responses.
export function createSessionPager(
  fetchPage: (
    operation: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ) => Promise<Record<string, unknown>>,
  timeoutMs: number,
  now = Date.now,
) {
  const ttl = 15 * 60 * 1000;
  const states = new Map<string, { state: State; bytes: number }>();
  let bytes = 0;
  const remove = (token: string) => {
    bytes -= states.get(token)?.bytes || 0;
    states.delete(token);
  };
  return {
    clear() {
      states.clear();
      bytes = 0;
    },
    async read(operation: string, params: Record<string, unknown>) {
      for (const [token, item] of states) if (item.state.expiresAt <= now()) remove(token);
      const { nextToken, maxResults, ...filters } = params;
      const binding = JSON.stringify([operation, Object.entries(filters).sort()]);
      const old = typeof nextToken === 'string' ? states.get(nextToken)?.state : undefined;
      if (nextToken && (!old || old.binding !== binding))
        throw new TwitterError(
          'INVALID_CURSOR',
          'Session cursor expired, belongs to different inputs, or was lost on server restart. Repeat the original query without nextToken.',
        );
      const state: State = old
        ? {
            ...old,
            pending: [...old.pending],
            seen: new Set(old.seen),
            cursors: new Set(old.cursors),
            meta: { ...old.meta },
          }
        : {
            binding,
            cursor: null,
            started: false,
            pending: [],
            seen: new Set(),
            cursors: new Set(),
            meta: {},
            expiresAt: now() + ttl,
          };
      const tweets: Record<string, unknown>[] = [];
      const limit = Number(maxResults);
      const deadline = now() + timeoutMs;
      let requests = 0;
      let stopped = false;
      let partial = Boolean(state.meta.partial);
      while (tweets.length < limit && state.seen.size < 5000) {
        if (state.pending.length) {
          const tweet = state.pending.shift()!;
          const id = String(tweet.id);
          if (!state.seen.has(id)) {
            state.seen.add(id);
            tweets.push(tweet);
          }
          continue;
        }
        if (state.started && !state.cursor) break;
        if (requests >= 8 || now() >= deadline) {
          partial = true;
          break;
        }
        const data = rawPage.safeParse(
          await fetchPage(
            operation + 'Page',
            {
              ...filters,
              ...(state.cursor ? { cursor: state.cursor } : {}),
              ...(state.meta.user ? { user: state.meta.user } : {}),
            },
            Math.max(1, deadline - now()),
          ),
        );
        if (!data.success)
          throw new TwitterError('UPSTREAM_FORMAT', 'Session page returned an unsupported shape.');
        requests++;
        const page = data.data;
        state.started = true;
        partial ||= Boolean(page.partial);
        state.meta = {
          source: page.source,
          fetchedAt: page.fetchedAt,
          twscrapeVersion: page.twscrapeVersion,
          ...(page.user ? { user: page.user } : {}),
          partial,
        };
        state.pending = page.tweets;
        if (page.cursor && state.cursors.has(page.cursor)) {
          state.cursor = null;
          partial = true;
          stopped = true;
        } else {
          state.cursor = page.cursor;
          if (page.cursor) state.cursors.add(page.cursor);
        }
      }
      // A session is a bounded browsing sequence, never an unbounded archive job.
      if (state.seen.size >= 5000) {
        state.pending = [];
        state.cursor = null;
        stopped = true;
        partial = true;
      }
      const hasMore = state.pending.length > 0 || state.cursor !== null;
      let token: string | null = null;
      if (hasMore) {
        state.meta.partial = partial;
        const size = Buffer.byteLength(
          JSON.stringify({ ...state, seen: [...state.seen], cursors: [...state.cursors] }),
        );
        if (size > 16 * 1024 * 1024)
          throw new TwitterError(
            'UPSTREAM_FORMAT',
            'Session page exceeds the continuation memory budget.',
          );
        while (states.size >= 32 || bytes + size > 16 * 1024 * 1024)
          remove(states.keys().next().value!);
        token = 'session.' + randomBytes(24).toString('base64url');
        states.set(token, { state, bytes: size });
        bytes += size;
      }
      if (operation === 'getUserTweets')
        tweets.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
      return {
        ...state.meta,
        ...(operation === 'searchTweets'
          ? { query: params.query, sortOrder: params.sortOrder }
          : {}),
        tweets,
        resultCount: tweets.length,
        nextToken: token,
        hasMore,
        cursorExpiresAt: token ? new Date(state.expiresAt).toISOString() : null,
        partial,
        limitReached: tweets.length === limit,
        coverage: 'bounded',
        ...(stopped ? { paginationStopped: true } : {}),
      };
    },
  };
}
