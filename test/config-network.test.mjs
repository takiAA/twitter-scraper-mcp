import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { loadConfig } from '../dist/src/config.js';
import { createNetwork } from '../dist/src/network.js';

test('configuration is read-only by default and rejects malformed options', () => {
  const config = loadConfig({});
  assert.equal(config.readBackend, 'oembed');
  assert.equal(config.enableWrite, false);
  for (const env of [
    { REQUEST_TIMEOUT_MS: 'NaN' },
    { REQUEST_TIMEOUT_MS: '0' },
    { REQUEST_TIMEOUT_MS: '2.5' },
    { TWITTER_READ_BACKEND: 'scraper' },
    { TWITTER_ENABLE_WRITE: 'yes' },
    { PROXY_URL: 'socks://proxy' },
    { PROXY_URL: 'bad' },
  ])
    assert.throws(() => loadConfig(env));
  assert.equal(
    loadConfig({ TWITTER_ENABLE_WRITE: 'true', PROXY_URL: 'http://localhost:7890' }).enableWrite,
    true,
  );
});
test('network wrapper applies request timeout and honors external cancellation', async () => {
  const previous = getGlobalDispatcher();
  const mock = new MockAgent();
  mock.disableNetConnect();
  setGlobalDispatcher(mock);
  const network = createNetwork({ timeoutMs: 100 });
  try {
    mock
      .get('https://publish.twitter.com')
      .intercept({ path: '/slow' })
      .reply(200, 'ok')
      .delay(500);
    await assert.rejects(
      () => network.fetch('https://publish.twitter.com/slow'),
      (e) => e.name === 'TimeoutError',
    );
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(
      () => network.fetch('https://publish.twitter.com/cancel', { signal: abort.signal }),
      (e) => e.name === 'AbortError',
    );
  } finally {
    setGlobalDispatcher(previous);
    await network.close();
    await mock.close();
  }
});
