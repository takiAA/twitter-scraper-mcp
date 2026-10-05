import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import nock from 'nock';
import { createTwitterService } from '../dist/src/twitter.js';
import { loadConfig } from '../dist/src/config.js';

nock.disableNetConnect();
afterEach(() => {
  try {
    assert.ok(nock.isDone(), `Unconsumed mocks: ${nock.pendingMocks()}`);
  } finally {
    nock.cleanAll();
  }
});
after(() => nock.enableNetConnect());
function service(env = { TWITTER_BEARER_TOKEN: 'test-token' }) {
  return createTwitterService(loadConfig({ ...env, TWITTER_DISCOVERY_BACKEND: 'api' }), {
    fetch: async () => assert.fail('discovery must use API, not oEmbed'),
  });
}
const api = () => nock('https://api.x.com', { reqheaders: { authorization: 'Bearer test-token' } });
const user = { id: '7', name: 'Go', username: 'golang' };
const page = {
  data: [
    {
      id: '123',
      text: 'short',
      note_post: { text: 'full post' },
      author_id: '7',
      created_at: '2026-10-05T00:00:00Z',
      public_metrics: { like_count: 3 },
    },
  ],
  includes: { users: [user] },
  meta: { result_count: 1, next_token: 'next-page' },
};

test('recent search forwards operators, sort, limits and expansions through real SDK', async () => {
  const query = '(MCP OR "AI agent") from:golang -is:retweet';
  api()
    .get('/2/tweets/search/recent')
    .query(
      (q) =>
        q.query === query &&
        q.max_results === '10' &&
        q.sort_order === 'recency' &&
        q['post.fields'].includes('note_post') &&
        q.expansions === 'author_id' &&
        !q.next_token,
    )
    .reply(200, page);
  const client = service();
  try {
    const result = await client.searchTweets({ query });
    assert.equal(result.tweets[0].text, 'full post');
    assert.equal(result.tweets[0].author.username, 'golang');
    assert.equal(result.resultCount, 1);
    assert.equal(result.nextToken, 'next-page');
    assert.equal(result.partial, false);
  } finally {
    await client.close();
  }
});
test('search pagination uses next_token once without fetching further pages', async () => {
  api()
    .get('/2/tweets/search/recent')
    .query(
      (q) =>
        q.next_token === 'next-page' &&
        q.since_id === '100' &&
        q.sort_order === 'relevancy' &&
        q.max_results === '25',
    )
    .reply(200, { meta: { result_count: 0 } });
  const client = service();
  try {
    assert.deepEqual(
      (
        await client.searchTweets({
          query: 'MCP',
          maxResults: 25,
          sortOrder: 'relevancy',
          nextToken: 'next-page',
          sinceId: '100',
        })
      ).tweets,
      [],
    );
  } finally {
    await client.close();
  }
});
test('timeline resolves @username then fetches exactly one page with default filters', async () => {
  api().get('/2/users/by/username/golang').query(true).reply(200, { data: user });
  api()
    .get('/2/users/7/tweets')
    .query(
      (q) =>
        q.max_results === '10' &&
        q.exclude === 'retweets' &&
        !q.pagination_token &&
        q['post.fields'].includes('created_at'),
    )
    .reply(200, page);
  const client = service();
  try {
    const result = await client.getUserTweets({ username: '@golang' });
    assert.deepEqual(result.user, user);
    assert.equal(result.nextToken, 'next-page');
    assert.equal(result.tweets[0].id, '123');
  } finally {
    await client.close();
  }
});
test('timeline maps cursor, since ID and explicit reply/retweet choices', async () => {
  api().get('/2/users/by/username/golang').query(true).reply(200, { data: user });
  api()
    .get('/2/users/7/tweets')
    .query(
      (q) =>
        q.max_results === '5' &&
        q.exclude === 'replies' &&
        q.pagination_token === 'cursor' &&
        q.since_id === '99' &&
        !q.next_token,
    )
    .reply(200, { data: [], meta: { result_count: 0 } });
  const client = service();
  try {
    const result = await client.getUserTweets({
      username: 'golang',
      maxResults: 5,
      nextToken: 'cursor',
      sinceId: '99',
      excludeReplies: true,
      excludeRetweets: false,
    });
    assert.equal(result.nextToken, null);
  } finally {
    await client.close();
  }
});
test('timeline includes all post types when both exclusions are false', async () => {
  api().get('/2/users/by/username/golang').query(true).reply(200, { data: user });
  api()
    .get('/2/users/7/tweets')
    .query((q) => !q.exclude)
    .reply(200, { meta: { result_count: 0 } });
  const client = service();
  try {
    await client.getUserTweets({
      username: 'golang',
      excludeRetweets: false,
      excludeReplies: false,
    });
  } finally {
    await client.close();
  }
});
test('invalid search and timeline inputs never initiate HTTP', async () => {
  const client = service();
  try {
    for (const input of [
      { query: ' ' },
      { query: 'x', maxResults: 9 },
      { query: 'x', maxResults: 101 },
      { query: 'x', maxResults: 10.5 },
      { query: 'x', nextToken: ' ' },
      { query: 'x', sinceId: 'invalid' },
      { query: 'x', sortOrder: 'bad' },
    ])
      await assert.rejects(
        () => client.searchTweets(input),
        (e) => e.code === 'INVALID_INPUT',
      );
    for (const input of [
      { username: 'https://x.com/golang' },
      { username: '../bad' },
      { username: '@@name' },
      { username: 'abcdefghijklmnop' },
      { username: 'golang', maxResults: 4 },
      { username: 'golang', excludeReplies: 'false' },
    ])
      await assert.rejects(
        () => client.getUserTweets(input),
        (e) => e.code === 'INVALID_INPUT',
      );
  } finally {
    await client.close();
  }
});
test('discovery needs API credentials even when getTweet defaults to oEmbed', async () => {
  const client = service({});
  await assert.rejects(
    () => client.searchTweets({ query: 'MCP' }),
    (e) => e.code === 'AUTH_REQUIRED',
  );
  await assert.rejects(
    () => client.getUserTweets({ username: 'golang' }),
    (e) => e.code === 'AUTH_REQUIRED',
  );
});
test('user lookup failure never issues a timeline request', async () => {
  for (const [response, status, code] of [
    [{ errors: [{ type: 'https://api.x.com/2/problems/resource-not-found' }] }, 200, 'NOT_FOUND'],
    [{}, 404, 'NOT_FOUND'],
    [{}, 403, 'FORBIDDEN'],
    [{ data: { ...user, username: 'wrong' } }, 200, 'UPSTREAM_FORMAT'],
  ]) {
    api().get('/2/users/by/username/golang').query(true).reply(status, response);
    const client = service();
    try {
      await assert.rejects(
        () => client.getUserTweets({ username: 'golang' }),
        (e) => e.code === code,
      );
    } finally {
      await client.close();
    }
  }
});
test('search reports authentication, API access and rate limiting failures', async () => {
  for (const [status, code] of [
    [401, 'AUTH_FAILED'],
    [402, 'API_ACCESS_REQUIRED'],
    [429, 'RATE_LIMITED'],
  ]) {
    api()
      .get('/2/tweets/search/recent')
      .query(true)
      .reply(status, { errors: [{ message: 'upstream secret' }] });
    const client = service();
    try {
      await assert.rejects(
        () => client.searchTweets({ query: 'MCP' }),
        (e) => e.code === code && !e.message.includes('secret'),
      );
    } finally {
      await client.close();
    }
  }
});
test('empty pages are successful but malformed and error-only pages are not empty successes', async () => {
  for (const [response, code] of [
    [{}, 'UPSTREAM_FORMAT'],
    [{ data: [{ id: '123' }], meta: { result_count: 1 } }, 'UPSTREAM_FORMAT'],
    [{ meta: { result_count: 1 } }, 'UPSTREAM_ERROR'],
    [{ meta: { result_count: 0 }, errors: [{ detail: 'failed' }] }, 'UPSTREAM_ERROR'],
  ]) {
    api().get('/2/tweets/search/recent').query(true).reply(200, response);
    const client = service();
    try {
      await assert.rejects(
        () => client.searchTweets({ query: 'MCP' }),
        (e) => e.code === code,
      );
    } finally {
      await client.close();
    }
  }
});
test('partial page results are flagged without leaking raw upstream errors', async () => {
  api()
    .get('/2/tweets/search/recent')
    .query(true)
    .reply(200, { ...page, errors: [{ detail: 'private details' }] });
  const client = service();
  try {
    const result = await client.searchTweets({ query: 'MCP' });
    assert.equal(result.partial, true);
    assert.equal(result.tweets.length, 1);
    assert.ok(!JSON.stringify(result).includes('private details'));
  } finally {
    await client.close();
  }
});
