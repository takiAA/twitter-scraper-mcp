import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScrapeTransport } from '../dist/src/twscrape.js';
import { createTwitterService } from '../dist/src/twitter.js';
import { createServer } from '../dist/src/server.js';
import { loadConfig } from '../dist/src/config.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const post = {
  id: '2096765359282061544',
  text: '完整正文',
  url: 'https://x.com/test/status/2096765359282061544',
  source: 'twscrape',
  author: { name: 'Test', username: 'test' },
  publishedAt: '2026-10-05T00:00:00Z',
  metrics: { like_count: 1 },
  conversationId: '2096765359282061544',
  inReplyToId: null,
  quotedTweetId: null,
  retweetedTweetId: null,
  media: { photos: [] },
  links: [],
};

test('session reads route to twscrape and preserve rich fields over real MCP', async () => {
  const calls = [];
  const service = createTwitterService(loadConfig({ TWITTER_READ_BACKEND: 'twscrape' }), {
    fetch: async () => assert.fail('no public network'),
    createApi: () => assert.fail('no paid fallback'),
    createScrape: () => ({
      read: async (op, params) => {
        calls.push([op, params]);
        if (op === 'getTweetDetails')
          return { ...post, fetchedAt: '2026-10-05T00:00:00Z', twscrapeVersion: '0.20.1' };
        if (op === 'getUser')
          return {
            data: { id: '7', name: 'Test', username: 'test' },
            source: 'twscrape',
            fetchedAt: '2026-10-05T00:00:00Z',
            twscrapeVersion: '0.20.1',
          };
        return {
          tweets: [post],
          resultCount: 1,
          nextToken: null,
          partial: false,
          limitReached: false,
          coverage: 'bounded',
          source: 'twscrape',
          ...(op === 'searchTweets'
            ? { query: params.query, sortOrder: params.sortOrder }
            : { user: { id: '7', name: 'Test', username: 'test', description: 'profile' } }),
        };
      },
      close: async () => {},
    }),
  });
  const server = createServer(service);
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 27);
    for (const t of tools.filter((t) => !['sendTweet', 'deleteTweet'].includes(t.name)))
      assert.equal(t.annotations.readOnlyHint, true);
    for (const request of [
      { name: 'getTweet', arguments: { tweetId: post.id } },
      { name: 'searchTweets', arguments: { query: 'MCP' } },
      { name: 'getUserTweets', arguments: { username: '@test' } },
      { name: 'getUser', arguments: { username: '@test' } },
    ]) {
      const result = await client.callTool(request);
      assert.notEqual(result.isError, true);
      assert.equal(result.structuredContent.source, 'twscrape');
    }
    assert.equal(calls[3][1].username, 'test');
    for (const input of [
      { name: 'getUserFollowers', arguments: { userId: '1; rm -rf /' } },
      { name: 'getBookmarks', arguments: { limit: 101 } },
      { name: 'getTrends', arguments: { category: 'https://evil.test' } },
    ])
      assert.equal((await client.callTool(input)).isError, true);
    assert.equal(calls.length, 4);
  } finally {
    await client.close();
    await server.close();
    await service.close();
  }
});

test('public getTweet needs neither Python nor cookies; scraper failure never bills API', async () => {
  const service = createTwitterService(loadConfig({}), {
    fetch: async () =>
      Response.json({
        url: 'https://x.com/u/status/20',
        author_name: 'U',
        author_url: 'https://x.com/u',
        html: '<p>public</p>',
      }),
    createApi: () => assert.fail('no API fallback'),
    createScrape: () => {
      throw new Error('worker failed');
    },
  });
  assert.equal((await service.getTweet('20')).source, 'oembed');
  await assert.rejects(service.searchTweets({ query: 'MCP' }), (e) => e.code === 'NETWORK_ERROR');
  await assert.rejects(service.scrape('post', {}), (e) => e.code === 'INVALID_INPUT');
});

test('worker process handles UTF-8 chunks, malformed output, busy state, deadlines and shutdown', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'twscrape-worker-test-'));
  const db = join(dir, 'fake.db');
  writeFileSync(db, 'fake');
  const runner = join(dir, 'python-fixture');
  writeFileSync(
    runner,
    `#!${process.execPath}\nlet s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{const q=JSON.parse(s);if(q.operation==='hang')return setInterval(()=>{},1000);if(q.operation==='bad')return console.log('auth_token=secret');if(q.operation==='large')return console.log('x'.repeat(5*1024*1024));const b=Buffer.from(JSON.stringify({ok:true,data:{text:'中文',operation:q.operation}}));const i=b.indexOf(Buffer.from('中文'))+1;process.stdout.write(b.subarray(0,i));setTimeout(()=>process.stdout.end(b.subarray(i)),5)});`,
    { mode: 0o700 },
  );
  const transport = createScrapeTransport(
    loadConfig({ TWSCRAPE_PYTHON: runner, TWSCRAPE_ACCOUNTS_DB: db, REQUEST_TIMEOUT_MS: '100' }),
  );
  try {
    assert.equal((await transport.read('normal', {})).text, '中文');
    await assert.rejects(
      transport.read('bad', {}),
      (e) => e.code === 'UPSTREAM_FORMAT' && !e.message.includes('secret'),
    );
    await assert.rejects(transport.read('large', {}), (e) => e.code === 'UPSTREAM_FORMAT');
    const pending = transport.read('hang', {});
    const check = assert.rejects(pending, (e) => e.code === 'REQUEST_TIMEOUT');
    await assert.rejects(transport.read('normal', {}), (e) => e.code === 'SERVER_BUSY');
    await check;
    const last = transport.read('hang', {});
    const cancelled = assert.rejects(last, (e) => e.code === 'UPSTREAM_ERROR');
    await transport.close();
    await cancelled;
    await assert.rejects(transport.read('normal', {}), (e) => e.code === 'SERVER_CLOSED');
  } finally {
    await transport.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing database fails before spawning Python and config validates new backends', async () => {
  const transport = createScrapeTransport(
    loadConfig({
      TWSCRAPE_PYTHON: '/nonexistent/python',
      TWSCRAPE_ACCOUNTS_DB: '/nonexistent/session.db',
    }),
  );
  await assert.rejects(transport.read('getBookmarks', {}), (e) => e.code === 'AUTH_REQUIRED');
  assert.equal(loadConfig({}).discoveryBackend, 'twscrape');
  for (const env of [{ TWITTER_DISCOVERY_BACKEND: 'auto' }, { TWSCRAPE_HTTP_BACKEND: 'invalid' }])
    assert.throws(() => loadConfig(env));
});
