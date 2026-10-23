import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServerEnv } from '../test-mcp-client.js';

test('diagnostic client forwards only the env the server needs', () => {
  const env = buildServerEnv({
    PATH: '/usr/bin',
    HOME: '/home/test',
    TWITTER_BEARER_TOKEN: 'token',
    TWSCRAPE_ACCOUNTS_DB: '.local/accounts.db',
    PROXY_URL: 'http://127.0.0.1:7890',
    REQUEST_TIMEOUT_MS: '20000',
    UNRELATED_SECRET: 'drop-me',
    AWS_SECRET_ACCESS_KEY: 'drop-me',
    GITHUB_TOKEN: 'drop-me',
  });
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/home/test');
  assert.equal(env.TWITTER_BEARER_TOKEN, 'token');
  assert.equal(env.TWSCRAPE_ACCOUNTS_DB, '.local/accounts.db');
  assert.equal(env.PROXY_URL, 'http://127.0.0.1:7890');
  assert.equal(env.REQUEST_TIMEOUT_MS, '20000');
  assert.equal(env.UNRELATED_SECRET, undefined);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.TWITTER_ENABLE_WRITE, 'false');
  assert.equal(env.TWITTER_READ_BACKEND, 'oembed');
});

test('diagnostic client env cannot enable writes from the shell', () => {
  const env = buildServerEnv({ TWITTER_ENABLE_WRITE: 'true', TWITTER_READ_BACKEND: 'api' });
  assert.equal(env.TWITTER_ENABLE_WRITE, 'false');
  assert.equal(env.TWITTER_READ_BACKEND, 'oembed');
});
