#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (
  args.length &&
  (args.length !== 2 || !['--tweet', '--search', '--user'].includes(args[0]) || !args[1])
) {
  console.error(
    'Usage: node test-mcp-client.js [--tweet ID_OR_URL | --search QUERY | --user USERNAME]',
  );
  process.exitCode = 1;
} else {
  const client = new Client({ name: 'twitter-mcp-smoke-test', version: '1.1.0' });
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined),
  );
  // Publishing is always disabled. --tweet is public; --search/--user use the configured discovery backend (twscrape by default).
  env.TWITTER_ENABLE_WRITE = 'false';
  env.TWITTER_READ_BACKEND = 'oembed';
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('./dist/index.js', import.meta.url))],
    env,
    stderr: 'inherit',
  });
  try {
    await client.connect(transport, { timeout: 10000 });
    console.log(
      JSON.stringify(
        {
          server: client.getServerVersion(),
          tools: (await client.listTools()).tools.map((tool) => tool.name),
        },
        null,
        2,
      ),
    );
    if (args.length) {
      const request =
        args[0] === '--search'
          ? { name: 'searchTweets', arguments: { query: args[1] } }
          : args[0] === '--user'
            ? { name: 'getUserTweets', arguments: { username: args[1] } }
            : { name: 'getTweet', arguments: { tweetId: args[1] } };
      const result = await client.callTool(request, undefined, {
        timeout: args[0] === '--user' ? 250000 : 130000,
      });
      console.log(JSON.stringify(result, null, 2));
      if (result.isError) process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'MCP connection failed');
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}
