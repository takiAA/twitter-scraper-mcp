import { Parser } from 'htmlparser2';
import { TwitterApi } from 'twitter-api-v2';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { z } from 'zod';
import type { Config } from './config.js';
import {
  searchInput,
  userTweetsInput,
  sessionSearchQuery,
  type SearchOptions,
  type UserTweetsOptions,
} from './inputs.js';

import { TwitterError } from './errors.js';
export { TwitterError } from './errors.js';
import { createScrapeTransport, type ScrapeTransport } from './twscrape.js';
import { scrapeInput } from './scrape-tools.js';

export function normalizeTweetId(input: string): string {
  let value = input.trim();
  if (!/^\d{1,20}$/.test(value)) {
    try {
      const url = new URL(value);
      const hosts = ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'];
      if (
        url.protocol !== 'https:' ||
        !hosts.includes(url.hostname) ||
        url.username ||
        url.password ||
        url.port
      )
        throw new Error();
      const match = url.pathname.match(
        /^\/(?:[A-Za-z0-9_]+|i\/web)\/status\/(\d{1,20})(?:\/(?:photo|video)\/\d+)?\/?$/,
      );
      if (!match) throw new Error();
      value = match[1];
    } catch {
      throw new TwitterError(
        'INVALID_INPUT',
        'Provide a numeric tweet ID or an HTTPS x.com/twitter.com status URL.',
      );
    }
  }
  if (BigInt(value) === 0n) throw new TwitterError('INVALID_INPUT', 'Tweet ID must be positive.');
  return value;
}

export function extractEmbedText(html: string): { text: string; date: string | null } {
  let inParagraph = false;
  let finished = false;
  let suppressed = 0;
  let inDate = false;
  let text = '';
  let date = '';
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === 'script' || name === 'style') suppressed++;
        if (name === 'p' && !finished) inParagraph = true;
        if (name === 'br' && inParagraph) text += '\n';
        if (name === 'a' && finished && /\/status\/\d+/.test(attrs.href || '')) inDate = true;
      },
      ontext(value) {
        if (suppressed) return;
        if (inParagraph) text += value;
        if (inDate) date += value;
      },
      onclosetag(name) {
        if (name === 'script' || name === 'style') suppressed = Math.max(0, suppressed - 1);
        if (name === 'p' && inParagraph) {
          inParagraph = false;
          finished = true;
        }
        if (name === 'a') inDate = false;
      },
    },
    { decodeEntities: true },
  );
  parser.end(html);
  if (!finished)
    throw new TwitterError('UPSTREAM_FORMAT', 'X returned an unsupported embed format.');
  return { text: text.trim(), date: date.trim() || null };
}

const embedSchema = z.object({
  html: z.string(),
  author_name: z.string(),
  author_url: z.string().url(),
  url: z.string().url(),
});
const postSchema = z.object({
  data: z.object({
    id: z.string().regex(/^\d+$/),
    text: z.string(),
    created_at: z.string().optional(),
    author_id: z.string().optional(),
    note_tweet: z.object({ text: z.string() }).optional(),
    note_post: z.object({ text: z.string() }).optional(),
    public_metrics: z.record(z.number()).optional(),
  }),
  includes: z
    .object({
      users: z
        .array(z.object({ id: z.string(), name: z.string(), username: z.string() }))
        .optional(),
    })
    .optional(),
});

const userSchema = z.object({
  id: z.string().regex(/^[1-9]\d{0,19}$/),
  name: z.string(),
  username: z.string(),
});
const pageSchema = z.object({
  data: z.array(postSchema.shape.data).optional(),
  includes: postSchema.shape.includes,
  meta: z.object({
    result_count: z.number().int().nonnegative(),
    next_token: z.string().min(1).optional(),
  }),
  errors: z.array(z.unknown()).optional(),
});
const postFields = {
  'post.fields': 'author_id,created_at,public_metrics,note_post',
  expansions: 'author_id',
  'user.fields': 'username,name',
};

function normalizePost(
  data: z.infer<typeof postSchema>['data'],
  users: z.infer<typeof userSchema>[] = [],
) {
  const author = users.find((user) => user.id === data.author_id);
  return {
    id: data.id,
    text: data.note_post?.text ?? data.note_tweet?.text ?? data.text,
    author: author ? { name: author.name, username: author.username } : null,
    publishedAt: data.created_at ?? null,
    url: `https://x.com/i/status/${data.id}`,
    metrics: data.public_metrics ?? null,
    source: 'x-api' as const,
  };
}

function normalizePage(raw: unknown) {
  const parsed = pageSchema.safeParse(raw);
  if (!parsed.success)
    throw new TwitterError('UPSTREAM_FORMAT', 'X returned an invalid page of posts.');
  const page = parsed.data;
  const posts = page.data ?? [];
  if (
    page.meta.result_count !== posts.length ||
    (!posts.length && (page.errors?.length ?? 0) > 0)
  ) {
    throw new TwitterError('UPSTREAM_ERROR', 'X did not return a usable page of posts.');
  }
  return {
    tweets: posts.map((post) => normalizePost(post, page.includes?.users)),
    resultCount: posts.length,
    nextToken: page.meta.next_token ?? null,
    partial: (page.errors?.length ?? 0) > 0,
    source: 'x-api' as const,
  };
}

function validated<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new TwitterError(
      'INVALID_INPUT',
      'Invalid parameters: ' +
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    );
  return parsed.data;
}

export interface ApiTransport {
  read(id: string): Promise<unknown>;
  search(options: SearchOptions): Promise<unknown>;
  user(username: string): Promise<unknown>;
  userTweets(id: string, options: UserTweetsOptions): Promise<unknown>;
  post(text: string): Promise<unknown>;
  delete(id: string): Promise<unknown>;
  close(): void;
}
export type ApiFactory = (config: Config, writing: boolean) => ApiTransport;

export const createApiTransport: ApiFactory = (config, writing) => {
  const oauth = config.apiKey && config.apiSecret && config.accessToken && config.accessSecret;
  if (!oauth && (writing || !config.bearerToken)) {
    throw new TwitterError(
      'AUTH_REQUIRED',
      writing
        ? 'Publishing requires all four TWITTER_API_KEY, TWITTER_API_SECRET_KEY, TWITTER_ACCESS_TOKEN and TWITTER_ACCESS_TOKEN_SECRET values. Password login is no longer supported.'
        : 'API reads require TWITTER_BEARER_TOKEN or all four OAuth 1.0a credentials.',
    );
  }
  const agent = config.proxyUrl ? new HttpsProxyAgent(config.proxyUrl) : undefined;
  const options = { httpAgent: agent };
  const client = oauth
    ? new TwitterApi(
        {
          appKey: config.apiKey!,
          appSecret: config.apiSecret!,
          accessToken: config.accessToken!,
          accessSecret: config.accessSecret!,
        },
        options,
      )
    : new TwitterApi(config.bearerToken!, options);
  return {
    read: (id) =>
      client.v2.get(`https://api.x.com/2/tweets/${id}`, postFields, {
        timeout: config.timeoutMs,
        prefix: '',
      }),
    search: (options) =>
      client.v2.get(
        'https://api.x.com/2/tweets/search/recent',
        {
          ...postFields,
          query: options.query,
          max_results: options.maxResults,
          sort_order: options.sortOrder,
          ...(options.nextToken ? { next_token: options.nextToken } : {}),
          ...(options.sinceId ? { since_id: options.sinceId } : {}),
        },
        { timeout: config.timeoutMs, prefix: '' },
      ),
    user: (username) =>
      client.v2.get(
        `https://api.x.com/2/users/by/username/${encodeURIComponent(username)}`,
        {
          'user.fields': 'name,username',
        },
        { timeout: config.timeoutMs, prefix: '' },
      ),
    userTweets: (id, options) => {
      const exclude = [
        options.excludeReplies ? 'replies' : '',
        options.excludeRetweets ? 'retweets' : '',
      ].filter(Boolean);
      return client.v2.get(
        `https://api.x.com/2/users/${id}/tweets`,
        {
          ...postFields,
          max_results: options.maxResults,
          ...(exclude.length ? { exclude: exclude.join(',') } : {}),
          ...(options.nextToken ? { pagination_token: options.nextToken } : {}),
          ...(options.sinceId ? { since_id: options.sinceId } : {}),
        },
        { timeout: config.timeoutMs, prefix: '' },
      );
    },
    // Low-level SDK call lets us set a request timeout. No retry middleware.
    post: (text) =>
      client.v2.post(
        'https://api.x.com/2/tweets',
        { text },
        { timeout: config.timeoutMs, prefix: '' },
      ),
    delete: (id) =>
      client.v2.delete(`https://api.x.com/2/tweets/${id}`, undefined, {
        timeout: config.timeoutMs,
        prefix: '',
      }),
    close: () => agent?.destroy(),
  };
};

function statusError(status: number, writing = false): TwitterError {
  if (status === 401)
    return new TwitterError('AUTH_FAILED', 'X rejected the configured API credentials.');
  if (status === 403)
    return new TwitterError(
      'FORBIDDEN',
      'X denied access. Check account permissions and post visibility.',
    );
  if (status === 402)
    return new TwitterError(
      'API_ACCESS_REQUIRED',
      'X API access or credits are required for this request.',
    );
  if (status === 404)
    return new TwitterError(
      'NOT_FOUND',
      'The requested user or post is unavailable or not accessible through this endpoint.',
    );
  if (status === 429)
    return new TwitterError('RATE_LIMITED', 'X rate limited this request. Wait before retrying.');
  if (writing && status >= 500) return unknownPublication();
  return new TwitterError('UPSTREAM_ERROR', `X rejected the request (HTTP ${status}).`);
}
function unknownPublication() {
  return new TwitterError(
    'PUBLISH_OUTCOME_UNKNOWN',
    'Publication could not be confirmed. Check your X account before retrying; the post may already exist. No automatic retry was made.',
  );
}
function translateError(error: unknown, writing = false): TwitterError {
  if (error instanceof TwitterError) return error;
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'number' && code >= 400 && code <= 599) return statusError(code, writing);
  if (writing) return unknownPublication();
  return new TwitterError(
    'NETWORK_ERROR',
    'X could not be reached or the request timed out. Check connectivity and PROXY_URL.',
  );
}

async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new TwitterError('UPSTREAM_FORMAT', 'X returned an empty response.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1024 * 1024)
        throw new TwitterError('UPSTREAM_FORMAT', 'X returned an oversized embed response.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new TwitterError('UPSTREAM_FORMAT', 'X returned invalid JSON.');
  }
}

export function createTwitterService(
  config: Config,
  dependencies: {
    fetch: typeof fetch;
    createApi?: ApiFactory;
    createScrape?: (config: Config) => ScrapeTransport;
  },
) {
  let readApi: ApiTransport | undefined;
  let writeApi: ApiTransport | undefined;
  const factory = dependencies.createApi || createApiTransport;
  let scraper: ScrapeTransport | undefined;
  const scrape = (operation: string, params: Record<string, unknown>) => {
    scraper ??= (dependencies.createScrape || createScrapeTransport)(config);
    return scraper.read(operation, params);
  };
  const sessionWrite = async (
    operation: 'sendTweet' | 'deleteTweet',
    params: Record<string, unknown>,
  ) => {
    if (!config.writeAccount)
      throw new TwitterError(
        'AUTH_REQUIRED',
        'Set TWITTER_WRITE_ACCOUNT to an exact local account label before writing.',
      );
    try {
      const data = await scrape(operation, params);
      const valid = z
        .object({
          id: z.string().regex(/^[1-9]\d{0,19}$/),
          status: z.literal(operation === 'sendTweet' ? 'published' : 'deleted'),
          source: z.literal('x-session'),
          account: z.literal(config.writeAccount),
          ...(operation === 'sendTweet' ? { text: z.string(), url: z.string().url() } : {}),
        })
        .safeParse(data);
      if (!valid.success || (operation === 'deleteTweet' && data.id !== params.tweetId))
        throw new TwitterError('UPSTREAM_FORMAT', 'Invalid session write response.');
      return data;
    } catch (error) {
      if (
        error instanceof TwitterError &&
        !['REQUEST_TIMEOUT', 'UPSTREAM_ERROR', 'UPSTREAM_FORMAT'].includes(error.code)
      )
        throw error;
      throw new TwitterError(
        operation === 'sendTweet' ? 'PUBLISH_OUTCOME_UNKNOWN' : 'DELETE_OUTCOME_UNKNOWN',
        'Write could not be confirmed. Check the account before retrying; no automatic retry was made.',
      );
    }
  };
  return {
    async getTweet(input: string): Promise<Record<string, unknown>> {
      const id = normalizeTweetId(input);
      try {
        if (config.readBackend === 'twscrape')
          return await scrape('getTweetDetails', { tweetId: id });
        if (config.readBackend === 'api') {
          readApi ??= factory(config, false);
          const parsed = postSchema.safeParse(await readApi.read(id));
          if (!parsed.success || parsed.data.data.id !== id)
            throw new TwitterError('UPSTREAM_FORMAT', 'X API returned no matching post.');
          return normalizePost(parsed.data.data, parsed.data.includes?.users);
        }
        const url = new URL('https://publish.twitter.com/oembed');
        url.searchParams.set('url', `https://twitter.com/i/status/${id}`);
        url.searchParams.set('omit_script', 'true');
        url.searchParams.set('hide_thread', 'true');
        const response = await dependencies.fetch(url);
        if (!response.ok) {
          await response.body?.cancel();
          throw statusError(response.status);
        }
        const parsed = embedSchema.safeParse(await readJson(response));
        if (!parsed.success)
          throw new TwitterError('UPSTREAM_FORMAT', 'X returned an unexpected embed response.');
        const embed = parsed.data;
        if (normalizeTweetId(embed.url) !== id)
          throw new TwitterError('UPSTREAM_FORMAT', 'X returned a different post.');
        const authorUrl = new URL(embed.author_url);
        const username = ['x.com', 'twitter.com'].includes(authorUrl.hostname)
          ? authorUrl.pathname.slice(1)
          : null;
        const content = extractEmbedText(embed.html);
        return {
          id,
          text: content.text,
          author: { name: embed.author_name, username },
          url: `https://x.com/i/status/${id}`,
          publishedDate: content.date,
          source: 'oembed',
          limitations: [
            'Display text may omit parts of long posts.',
            'No engagement metrics or full thread.',
          ],
        };
      } catch (error) {
        throw translateError(error);
      }
    },
    async searchTweets(input: z.input<typeof searchInput>): Promise<Record<string, unknown>> {
      const options = validated(searchInput, input);
      try {
        if (config.discoveryBackend === 'twscrape') {
          const { filters, ...params } = options;
          const query = sessionSearchQuery(options);
          if (query.length > 4096)
            throw new TwitterError(
              'INVALID_INPUT',
              'Search query with filters exceeds 4096 characters.',
            );
          const result = await scrape('searchTweets', { ...params, query });
          return { ...result, query: options.query, effectiveQuery: query };
        }
        if (options.filters !== undefined)
          throw new TwitterError(
            'INVALID_INPUT',
            'Browser-style filters require the twscrape session backend. In API mode, use API-supported operators in query.',
          );
        if (options.nextToken?.startsWith('session.'))
          throw new TwitterError(
            'INVALID_CURSOR',
            'Session cursors cannot be used with the official API backend.',
          );
        readApi ??= factory(config, false);
        return {
          ...normalizePage(await readApi.search(options)),
          query: options.query,
          sortOrder: options.sortOrder,
        };
      } catch (error) {
        throw translateError(error);
      }
    },
    async getUserTweets(input: z.input<typeof userTweetsInput>): Promise<Record<string, unknown>> {
      const options = validated(userTweetsInput, input);
      const username = options.username.replace(/^@/, '');
      try {
        if (config.discoveryBackend === 'twscrape')
          return await scrape('getUserTweets', { ...options, username });
        if (options.nextToken?.startsWith('session.'))
          throw new TwitterError(
            'INVALID_CURSOR',
            'Session cursors cannot be used with the official API backend.',
          );
        readApi ??= factory(config, false);
        // Resolve each page explicitly; no stale username cache or automatic pagination.
        const rawUser = await readApi.user(username);
        const parsed = z.object({ data: userSchema }).safeParse(rawUser);
        if (!parsed.success) {
          const errors = (rawUser as { errors?: { type?: string }[] } | null)?.errors;
          if (
            Array.isArray(errors) &&
            errors.some(
              (e) => typeof e?.type === 'string' && e.type.endsWith('/resource-not-found'),
            )
          ) {
            throw new TwitterError(
              'NOT_FOUND',
              'The requested user does not exist or is unavailable.',
            );
          }
          throw new TwitterError('UPSTREAM_FORMAT', 'X returned no valid user.');
        }
        if (parsed.data.data.username.toLowerCase() !== username.toLowerCase())
          throw new TwitterError('UPSTREAM_FORMAT', 'X returned a different user.');
        return {
          ...normalizePage(await readApi.userTweets(parsed.data.data.id, options)),
          user: parsed.data.data,
        };
      } catch (error) {
        throw translateError(error);
      }
    },
    async scrape(operation: string, input: unknown): Promise<Record<string, unknown>> {
      let params: Record<string, unknown>;
      try {
        params = scrapeInput(operation, input);
      } catch {
        throw new TwitterError('INVALID_INPUT', 'Invalid twscrape operation or parameters.');
      }
      return scrape(operation, params);
    },
    async sendTweet(text: string): Promise<Record<string, unknown>> {
      if (!text.trim() || text.length > 25000)
        throw new TwitterError(
          'INVALID_INPUT',
          'Tweet text must be nonblank and at most 25000 characters. X enforces the account-specific weighted length limit.',
        );
      if (!config.enableWrite)
        throw new TwitterError(
          'WRITE_DISABLED',
          'Publishing is disabled. Set TWITTER_ENABLE_WRITE=true only for an account you intend to publish from.',
        );
      if (config.writeBackend === 'session') return sessionWrite('sendTweet', { text });
      // Construct/authenticate before issuing a write. Missing credentials cannot
      // fall back to a different account or provider after an attempted publish.
      writeApi ??= factory(config, true);
      try {
        const result = postSchema.safeParse(await writeApi.post(text));
        if (!result.success) throw unknownPublication();
        return {
          id: result.data.data.id,
          text: result.data.data.text,
          url: `https://x.com/i/status/${result.data.data.id}`,
          status: 'published',
          source: 'x-api',
        };
      } catch (error) {
        throw translateError(error, true);
      }
    },
    async deleteTweet(input: string): Promise<Record<string, unknown>> {
      const id = normalizeTweetId(input);
      if (!config.enableWrite)
        throw new TwitterError(
          'WRITE_DISABLED',
          'Deletion is disabled. Set TWITTER_ENABLE_WRITE=true only when intentionally modifying your account.',
        );
      if (config.writeBackend === 'session') return sessionWrite('deleteTweet', { tweetId: id });
      writeApi ??= factory(config, true);
      try {
        const response = z
          .object({ data: z.object({ deleted: z.literal(true) }) })
          .safeParse(await writeApi.delete(id));
        if (!response.success) throw unknownPublication();
        return { id, status: 'deleted', source: 'x-api' };
      } catch (error) {
        const translated = translateError(error, true);
        if (translated.code === 'PUBLISH_OUTCOME_UNKNOWN')
          throw new TwitterError(
            'DELETE_OUTCOME_UNKNOWN',
            'Deletion could not be confirmed. Check the post before retrying; no automatic retry was made.',
          );
        throw translated;
      }
    },
    async close() {
      readApi?.close();
      writeApi?.close();
      await scraper?.close();
    },
  };
}
export type TwitterService = ReturnType<typeof createTwitterService>;
