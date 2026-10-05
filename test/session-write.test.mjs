import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTwitterService, TwitterError } from '../dist/src/twitter.js';
import { createServer } from '../dist/src/server.js';
import { loadConfig } from '../dist/src/config.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
const make = (env, read) =>
  createTwitterService(loadConfig(env), {
    fetch: async () => assert.fail('no public HTTP'),
    createApi: () => assert.fail('no API/account fallback'),
    createScrape: () => ({ read, close: async () => {} }),
  });
const env = {
  TWITTER_ENABLE_WRITE: 'true',
  TWITTER_WRITE_BACKEND: 'session',
  TWITTER_WRITE_ACCOUNT: 'test',
};
test('session write and deletion pass through MCP with named account receipts', async () => {
  const calls = [];
  const service = make(env, async (operation, params) => {
    calls.push({ operation, params });
    return {
      id: '123',
      source: 'x-session',
      account: 'test',
      status: operation === 'sendTweet' ? 'published' : 'deleted',
      ...(operation === 'sendTweet'
        ? { text: params.text, url: 'https://x.com/i/status/123' }
        : {}),
    };
  });
  const server = createServer(service),
    client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    for (const request of [
      { name: 'sendTweet', arguments: { text: 'test' } },
      { name: 'deleteTweet', arguments: { tweetId: 'https://x.com/test/status/123' } },
    ]) {
      const result = await client.callTool(request);
      assert.notEqual(result.isError, true);
      assert.equal(result.structuredContent.source, 'x-session');
    }
    assert.deepEqual(calls, [
      { operation: 'sendTweet', params: { text: 'test' } },
      { operation: 'deleteTweet', params: { tweetId: '123' } },
    ]);
  } finally {
    await client.close();
    await server.close();
    await service.close();
  }
});
test('write guards stop calls before any transport', async () => {
  for (const extra of [{ TWITTER_ENABLE_WRITE: 'false' }, { TWITTER_WRITE_ACCOUNT: '' }]) {
    const service = make({ ...env, ...extra }, () => assert.fail('no transport'));
    for (const action of [() => service.sendTweet('test'), () => service.deleteTweet('123')])
      await assert.rejects(action, (e) => ['WRITE_DISABLED', 'AUTH_REQUIRED'].includes(e.code));
  }
});
test('worker failure or malformed write receipt is unknown, never retried', async () => {
  for (const result of [
    new TwitterError('REQUEST_TIMEOUT', 'secret'),
    { id: '123', source: 'x-session', account: 'wrong', status: 'deleted' },
  ]) {
    let count = 0;
    const service = make(env, async () => {
      count++;
      if (result instanceof Error) throw result;
      return result;
    });
    await assert.rejects(
      () => service.sendTweet('test'),
      (e) => e.code === 'PUBLISH_OUTCOME_UNKNOWN' && !e.message.includes('secret'),
    );
    assert.equal(count, 1);
  }
});
test('invalid backend rejected at startup', () => {
  assert.throws(() => loadConfig({ TWITTER_WRITE_BACKEND: 'auto' }), /TWITTER_WRITE_BACKEND/);
});
