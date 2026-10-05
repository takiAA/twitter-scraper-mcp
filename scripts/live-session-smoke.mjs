// Explicit opt-in live READS. Does not call bookmarks or any write tool.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { writeFile, mkdir } from 'node:fs/promises';
const flags = process.argv.slice(2);
if (flags.some((flag) => flag !== '--extended')) {
  console.error('Usage: npm run test:session [-- --extended]');
  process.exit(1);
}
const extended = flags.includes('--extended');
const root = fileURLToPath(new URL('../', import.meta.url));
const client = new Client({ name: 'session-live-smoke', version: '1' });
const env = {
  ...process.env,
  TWITTER_ENABLE_WRITE: 'false',
  TWITTER_READ_BACKEND: 'oembed',
  TWITTER_DISCOVERY_BACKEND: 'twscrape',
};
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [root + 'dist/index.js'],
  env,
  stderr: 'inherit',
});
const report = { testedAt: new Date().toISOString(), results: [] };
let ownerId, newestId;
async function call(name, args) {
  const start = Date.now();
  try {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 125000 });
    const data = result.structuredContent || JSON.parse(result.content[0].text);
    const row = {
      name,
      args,
      ok: !result.isError,
      seconds: (Date.now() - start) / 1000,
      ...(result.isError
        ? { error: data.error, message: data.message }
        : {
            source: data.source,
            resultCount: data.resultCount,
            id: data.id || data.data?.id,
            partial: data.partial,
          }),
    };
    if (data.tweets?.length)
      row.sample = data.tweets.slice(0, 2).map((t) => ({
        id: t.id,
        text: t.text.slice(0, 220),
        url: t.url,
        publishedAt: t.publishedAt,
      }));
    if (typeof data.text === 'string') row.text = data.text.slice(0, 220);
    report.results.push(row);
    console.log(JSON.stringify(row));
    if (result.isError) process.exitCode = 1;
    return result.isError ? null : data;
  } catch (e) {
    const row = {
      name,
      args,
      ok: false,
      seconds: (Date.now() - start) / 1000,
      error: 'PROTOCOL_ERROR',
      message: e.message,
    };
    report.results.push(row);
    console.log(JSON.stringify(row));
    process.exitCode = 1;
    return null;
  }
}
try {
  await client.connect(transport);
  const owner = await call('getUser', { username: 'golang' });
  ownerId = owner?.data.id;
  const search = await call('searchTweets', { query: 'from:golang', maxResults: 10 });
  newestId = search?.tweets?.[0]?.id;
  await call('getUserTweets', { username: 'golang', maxResults: 5, excludeReplies: true });
  for (const tweetId of [
    '20',
    '1897009050392379653',
    '2096765359282061544',
    ...(newestId ? [newestId] : []),
  ])
    await call('getTweet', { tweetId });
  await call('getTweetDetails', { tweetId: '1897009050392379653' });
  await call('searchUsers', { query: 'golang', limit: 3 });
  if (ownerId) {
    if (extended) await call('getUserById', { userId: ownerId });
    await call('getUserMedia', { userId: ownerId, limit: 3 });
    await call('getUserFollowers', { userId: ownerId, limit: 3 });
    await call('getUserFollowing', { userId: ownerId, limit: 3 });
  }
  await call('getUserAbout', { username: 'golang' });
  await call('getTweetReplies', { tweetId: newestId || '1897009050392379653', limit: 3 });
  await call('getTweetThread', { tweetId: newestId || '1897009050392379653', limit: 3 });
  if (extended) await call('getTrends', { category: 'news', limit: 3 });
} finally {
  await client.close();
  await mkdir(root + '.local', { recursive: true, mode: 0o700 });
  await writeFile(root + '.local/live-session-report.json', JSON.stringify(report, null, 2), {
    mode: 0o600,
  });
}
