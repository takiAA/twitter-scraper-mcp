import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import nock from 'nock';
import { loadConfig } from '../dist/src/config.js';
import { createTwitterService } from '../dist/src/twitter.js';

nock.disableNetConnect();
afterEach(() => {
  try {
    assert.ok(nock.isDone(), `Unconsumed HTTP mocks: ${nock.pendingMocks()}`);
  } finally {
    nock.cleanAll();
  }
});
after(() => nock.enableNetConnect());
const credentials = {
  TWITTER_API_KEY: 'test-key',
  TWITTER_API_SECRET_KEY: 'test-secret',
  TWITTER_ACCESS_TOKEN: 'test-token',
  TWITTER_ACCESS_TOKEN_SECRET: 'test-token-secret',
  TWITTER_ENABLE_WRITE: 'true',
};
const create = (env) =>
  createTwitterService(loadConfig(env), {
    fetch: async () => assert.fail('API mode must not use oEmbed'),
  });

test('real SDK uses OAuth 1.0a and posts once to api.x.com without password login', async () => {
  nock('https://api.x.com', {
    reqheaders: {
      authorization: (value) =>
        value.startsWith('OAuth ') &&
        value.includes('oauth_signature=') &&
        value.includes('test-token'),
    },
  })
    .post('/2/tweets', { text: 'test only' })
    .reply(201, { data: { id: '123', text: 'test only' } });
  const service = create(credentials);
  try {
    assert.equal((await service.sendTweet('test only')).status, 'published');
  } finally {
    await service.close();
  }
});
test('real SDK supports bearer-token reads with expansions', async () => {
  nock('https://api.x.com', { reqheaders: { authorization: 'Bearer test-bearer' } })
    .get('/2/tweets/123')
    .query((query) => query.expansions === 'author_id')
    .reply(200, { data: { id: '123', text: 'read' } });
  const service = create({ TWITTER_READ_BACKEND: 'api', TWITTER_BEARER_TOKEN: 'test-bearer' });
  try {
    assert.equal((await service.getTweet('123')).text, 'read');
  } finally {
    await service.close();
  }
});
test('SDK authentication and rate-limit failures map to tool errors', async () => {
  for (const [status, code] of [
    [401, 'AUTH_FAILED'],
    [403, 'FORBIDDEN'],
    [429, 'RATE_LIMITED'],
    [503, 'PUBLISH_OUTCOME_UNKNOWN'],
  ]) {
    nock('https://api.x.com')
      .post('/2/tweets')
      .reply(status, { errors: [{ message: 'redacted' }] });
    const service = create(credentials);
    try {
      await assert.rejects(
        () => service.sendTweet('test'),
        (e) => e.code === code,
      );
    } finally {
      await service.close();
    }
  }
});
test('a bearer token alone cannot accidentally authorize publishing', async () => {
  const service = create({ TWITTER_ENABLE_WRITE: 'true', TWITTER_BEARER_TOKEN: 'test' });
  await assert.rejects(
    () => service.sendTweet('test'),
    (e) => e.code === 'AUTH_REQUIRED',
  );
});
test('SDK requests time out without retrying a possibly published post', async () => {
  nock('https://api.x.com')
    .post('/2/tweets')
    .delayConnection(300)
    .reply(201, { data: { id: '123', text: 'test' } });
  const service = create({ ...credentials, REQUEST_TIMEOUT_MS: '100' });
  try {
    await assert.rejects(
      () => service.sendTweet('test'),
      (e) => e.code === 'PUBLISH_OUTCOME_UNKNOWN',
    );
  } finally {
    await service.close();
  }
});
