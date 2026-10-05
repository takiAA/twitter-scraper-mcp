import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../dist/src/server.js';
import { createTwitterService } from '../dist/src/twitter.js';
import { loadConfig } from '../dist/src/config.js';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url));
test('compiled stdio server starts from another cwd with safe defaults', async () => {
  const client = new Client({ name: 'test', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    cwd: '/tmp',
    env: { TWITTER_ENABLE_WRITE: 'false', TWITTER_READ_BACKEND: 'oembed' },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport, { timeout: 5000 });
    const tools = (await client.listTools()).tools;
    assert.deepEqual(
      tools.slice(0, 4).map((t) => t.name),
      ['getTweet', 'sendTweet', 'searchTweets', 'getUserTweets'],
    );
    assert.equal(tools[0].annotations.readOnlyHint, true);
    assert.ok(tools[0].outputSchema);
    assert.equal(tools[1].annotations.idempotentHint, false);
    const invalid = await client.callTool({ name: 'getTweet', arguments: { tweetId: 'invalid' } });
    assert.equal(invalid.isError, true);
    assert.equal(JSON.parse(invalid.content[0].text).error, 'INVALID_INPUT');
    const publish = await client.callTool({ name: 'sendTweet', arguments: { text: 'never sent' } });
    assert.equal(publish.isError, true);
    assert.equal(JSON.parse(publish.content[0].text).error, 'WRITE_DISABLED');
  } finally {
    await client.close();
  }
});
test('full MCP calls serialize real service results as valid structured content', async () => {
  let posts = 0;
  const service = createTwitterService(
    { ...loadConfig({ TWITTER_DISCOVERY_BACKEND: 'api' }), enableWrite: true },
    {
      fetch: async () =>
        Response.json({
          url: 'https://x.com/user/status/123',
          author_name: 'User',
          author_url: 'https://x.com/user',
          html: '<p>hello &amp; world</p>',
        }),
      createApi: () => ({
        search: async () => ({
          data: [{ id: '123', text: 'search result' }],
          meta: { result_count: 1, next_token: 'cursor' },
        }),
        user: async () => ({ data: { id: '7', name: 'Go', username: 'golang' } }),
        userTweets: async () => ({ meta: { result_count: 0 } }),
        post: async (text) => {
          posts++;
          return { data: { id: '456', text } };
        },
        close() {},
      }),
    },
  );
  const server = createServer(service);
  const client = new Client({ name: 'test', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const read = await client.callTool({ name: 'getTweet', arguments: { tweetId: '123' } });
    assert.notEqual(read.isError, true);
    assert.equal(read.structuredContent.text, 'hello & world');
    assert.deepEqual(JSON.parse(read.content[0].text), read.structuredContent);
    const write = await client.callTool({ name: 'sendTweet', arguments: { text: 'mock write' } });
    assert.notEqual(write.isError, true);
    assert.equal(write.structuredContent.status, 'published');
    assert.equal(posts, 1);
    const search = await client.callTool({ name: 'searchTweets', arguments: { query: 'MCP' } });
    assert.notEqual(search.isError, true);
    assert.equal(search.structuredContent.tweets[0].text, 'search result');
    assert.equal(search.structuredContent.nextToken, 'cursor');
    const timeline = await client.callTool({
      name: 'getUserTweets',
      arguments: { username: 'golang' },
    });
    assert.notEqual(timeline.isError, true);
    assert.equal(timeline.structuredContent.user.username, 'golang');
    assert.deepEqual(timeline.structuredContent.tweets, []);
    const invalidSearch = await client.callTool({
      name: 'searchTweets',
      arguments: { query: 'MCP', maxResults: 1 },
    });
    assert.equal(invalidSearch.isError, true);
  } finally {
    await client.close();
    await server.close();
    await service.close();
  }
});
test('diagnostic client returns nonzero for invalid input and never sends a tweet', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../test-mcp-client.js', import.meta.url)), '--tweet', 'invalid'],
    { encoding: 'utf8', timeout: 10000 },
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /INVALID_INPUT/);
});

test('discovery CLI modes route to tools and fail clearly without API credentials', () => {
  const env = {
    ...process.env,
    TWITTER_BEARER_TOKEN: '',
    TWITTER_API_KEY: '',
    TWITTER_API_SECRET_KEY: '',
    TWITTER_ACCESS_TOKEN: '',
    TWITTER_ACCESS_TOKEN_SECRET: '',
    PROXY_URL: '',
    TWITTER_DISCOVERY_BACKEND: 'api',
  };
  for (const args of [
    ['--search', 'MCP'],
    ['--user', 'golang'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../test-mcp-client.js', import.meta.url)), ...args],
      { env, encoding: 'utf8', timeout: 10000 },
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /AUTH_REQUIRED/);
    assert.doesNotMatch(result.stderr, /Usage:/);
  }
});
