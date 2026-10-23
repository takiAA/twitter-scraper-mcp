#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// The server only needs its own configuration. Forward an allowlist so
// unrelated secrets in the developer shell never reach the child process,
// matching the env handling in src/twscrape.ts and scripts/auth-browser.js.
const passthrough = new Set([
  'PATH',
  'HOME',
  'SYSTEMROOT',
  'LANG',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'TMPDIR',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'PROXY_URL',
  'REQUEST_TIMEOUT_MS',
]);

export function buildServerEnv(source = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (passthrough.has(key) || key.startsWith('TWITTER_') || key.startsWith('TWSCRAPE_'))
      env[key] = value;
  }
  // Publishing is always disabled. --tweet is public; --search/--user use the configured discovery backend (twscrape by default).
  env.TWITTER_ENABLE_WRITE = 'false';
  env.TWITTER_READ_BACKEND = 'oembed';
  return env;
}

async function main() {
  const args = process.argv.slice(2);
  if (
    args.length &&
    (args.length !== 2 || !['--tweet', '--search', '--user'].includes(args[0]) || !args[1])
  ) {
    console.error(
      'Usage: node test-mcp-client.js [--tweet ID_OR_URL | --search QUERY | --user USERNAME]',
    );
    process.exitCode = 1;
    return;
  }
  const client = new Client({ name: 'twitter-mcp-smoke-test', version: '1.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('./dist/index.js', import.meta.url))],
    env: buildServerEnv(),
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.exitCode = 1;
  });
}
