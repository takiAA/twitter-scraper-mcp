#!/usr/bin/env node
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './src/config.js';
import { createNetwork } from './src/network.js';
import { createTwitterService } from './src/twitter.js';
import { createServer } from './src/server.js';

// Both source (tsx) and compiled entrypoints resolve .env from the project root.
const envFile = new URL(import.meta.url.endsWith('.ts') ? '.env' : '../.env', import.meta.url);
dotenv.config({ path: fileURLToPath(envFile) });

try {
  const config = loadConfig(process.env);
  const network = createNetwork(config);
  const service = createTwitterService(config, { fetch: network.fetch });
  const server = createServer(service);
  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    await server.close();
    await service.close();
    await network.close();
  }
  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
  process.stdin.once('end', () => {
    void shutdown();
  });
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Server startup failed');
  process.exitCode = 1;
}
