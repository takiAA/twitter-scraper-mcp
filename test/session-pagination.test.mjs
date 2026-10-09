import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionPager } from '../dist/src/session-pagination.js';
import { createTwitterService } from '../dist/src/twitter.js';
import { loadConfig } from '../dist/src/config.js';

const post = (id) => ({ id: String(id), publishedAt: `2026-10-${String(id).padStart(2, '0')}` });
const page = (ids, cursor) => ({
  tweets: ids.map(post),
  cursor,
  source: 'twscrape',
  fetchedAt: '2026-10-09T00:00:00Z',
  twscrapeVersion: '0.20.1',
});
const args = { query: 'polymarket', sortOrder: 'relevancy', maxResults: 2 };

test('session continuation preserves overflow, upstream order and cross-page deduplication', async () => {
  const calls = [];
  const pager = createSessionPager(async (op, p) => {
    calls.push([op, p]);
    return p.cursor ? page([3, 4, 5], null) : page([1, 2, 3], 'x-bottom');
  }, 1000);
  const a = await pager.read('searchTweets', args);
  assert.deepEqual(
    a.tweets.map((t) => t.id),
    ['1', '2'],
  );
  assert.equal(a.hasMore, true);
  assert.match(a.nextToken, /^session\./);
  assert.ok(!a.nextToken.includes('x-bottom'));
  const b = await pager.read('searchTweets', { ...args, nextToken: a.nextToken });
  assert.deepEqual(
    b.tweets.map((t) => t.id),
    ['3', '4'],
  );
  assert.equal(calls[1][1].cursor, 'x-bottom');
  assert.equal('nextToken' in calls[1][1], false);
  const c = await pager.read('searchTweets', { ...args, nextToken: b.nextToken });
  assert.deepEqual(
    c.tweets.map((t) => t.id),
    ['5'],
  );
  assert.equal(c.nextToken, null);
  assert.equal(c.hasMore, false);
  assert.equal(calls.length, 2);
  // A checkpoint is not consumed: a caller retry cannot skip its remaining items.
  const retry = await pager.read('searchTweets', {
    ...args,
    maxResults: 1,
    nextToken: a.nextToken,
  });
  assert.deepEqual(
    retry.tweets.map((t) => t.id),
    ['3'],
  );
});

test('expired, cross-query, cross-tool and foreign cursors never contact X', async () => {
  let clock = 0;
  let calls = 0;
  const pager = createSessionPager(
    async () => {
      calls++;
      return page([1, 2, 3], null);
    },
    1000,
    () => clock,
  );
  const a = await pager.read('searchTweets', args);
  for (const [op, p] of [
    ['searchTweets', { ...args, nextToken: 'api-cursor' }],
    ['searchTweets', { ...args, query: 'different', nextToken: a.nextToken }],
    ['searchTweets', { ...args, sortOrder: 'recency', nextToken: a.nextToken }],
    ['getUserTweets', { ...args, nextToken: a.nextToken }],
  ])
    await assert.rejects(pager.read(op, p), (e) => e.code === 'INVALID_CURSOR');
  clock += 15 * 60 * 1000;
  await assert.rejects(
    pager.read('searchTweets', { ...args, nextToken: a.nextToken }),
    (e) => e.code === 'INVALID_CURSOR',
  );
  assert.equal(calls, 1);
});

test('empty pages retain continuation, repeated cursors stop and loops stay bounded', async () => {
  let calls = 0;
  const pager = createSessionPager(async () => {
    calls++;
    return page([], `cursor-${calls}`);
  }, 1000);
  const a = await pager.read('searchTweets', args);
  assert.equal(calls, 8);
  assert.equal(a.partial, true);
  assert.equal(a.hasMore, true);
  const stalled = createSessionPager(async () => page([1], 'same'), 1000);
  const b = await stalled.read('searchTweets', args);
  assert.equal(b.hasMore, false);
  assert.equal(b.partial, true);
  assert.equal(b.paginationStopped, true);
});

test('failed reads leave an existing checkpoint available; oldest checkpoints are evicted', async () => {
  let fail = false;
  const pager = createSessionPager(async (_, p) => {
    if (fail) throw new Error('network unavailable');
    return page(p.cursor ? [3, 4] : [1, 2], p.cursor ? null : 'next');
  }, 1000);
  const a = await pager.read('searchTweets', args);
  fail = true;
  await assert.rejects(pager.read('searchTweets', { ...args, nextToken: a.nextToken }));
  fail = false;
  assert.deepEqual(
    (await pager.read('searchTweets', { ...args, nextToken: a.nextToken })).tweets.map((t) => t.id),
    ['3', '4'],
  );
  for (let n = 0; n < 32; n++) await pager.read('searchTweets', { ...args, query: String(n) });
  await assert.rejects(
    pager.read('searchTweets', { ...args, nextToken: a.nextToken }),
    (e) => e.code === 'INVALID_CURSOR',
  );
  pager.clear();
});

test('timeline preserves profile, filters binding and sorts only the returned page', async () => {
  const user = { id: '7', username: 'test' };
  const calls = [];
  const pager = createSessionPager(async (_, p) => {
    calls.push(p);
    return { ...page(p.cursor ? [1] : [3, 2], p.cursor ? null : 'next'), user };
  }, 1000);
  const p = { username: 'test', excludeReplies: true, excludeRetweets: true, maxResults: 2 };
  const a = await pager.read('getUserTweets', p);
  assert.deepEqual(
    a.tweets.map((t) => t.id),
    ['3', '2'],
  );
  const b = await pager.read('getUserTweets', { ...p, nextToken: a.nextToken });
  assert.deepEqual(b.user, user);
  assert.deepEqual(calls[1].user, user);
});

test('advanced filters compile to session operators and reject invalid or API-only usage', async () => {
  const calls = [];
  const service = createTwitterService(loadConfig({}), {
    fetch: async () => assert.fail('no network'),
    createScrape: () => ({
      read: async (op, p) => {
        calls.push(p);
        return {};
      },
      close: async () => {},
    }),
  });
  await service.searchTweets({
    query: 'polymarket',
    filters: {
      language: 'zh',
      fromUsername: '@Polymarket',
      excludeReplies: true,
      excludeRetweets: true,
      hasMedia: true,
      minLikes: 100,
      minReplies: 2,
      minRetweets: 3,
      sinceDate: '2026-10-01',
      untilDate: '2026-10-10',
    },
  });
  assert.equal(
    calls[0].query,
    'polymarket lang:zh from:Polymarket -filter:replies -filter:retweets filter:media min_faves:100 min_replies:2 min_retweets:3 since:2026-10-01 until:2026-10-10',
  );
  for (const filters of [
    { language: 'zh OR anything' },
    { sinceDate: '2026-02-30' },
    { sinceDate: '2026-10-10', untilDate: '2026-10-01' },
    { minLikes: -1 },
    { fromUsername: 'a b' },
    { unknown: true },
  ])
    await assert.rejects(
      service.searchTweets({ query: 'x', filters }),
      (e) => e.code === 'INVALID_INPUT',
    );
  assert.equal(calls.length, 1);
  const api = createTwitterService(loadConfig({ TWITTER_DISCOVERY_BACKEND: 'api' }), {
    fetch: async () => assert.fail('no network'),
    createApi: () => assert.fail('no API call'),
  });
  await assert.rejects(
    api.searchTweets({ query: 'x', filters: { language: 'zh' } }),
    (e) => e.code === 'INVALID_INPUT',
  );
  await assert.rejects(
    api.searchTweets({ query: 'x', nextToken: 'session.foreign' }),
    (e) => e.code === 'INVALID_CURSOR',
  );
  await assert.rejects(
    api.getUserTweets({ username: 'test', nextToken: 'session.foreign' }),
    (e) => e.code === 'INVALID_CURSOR',
  );
  await api.close();
  await service.close();
});
