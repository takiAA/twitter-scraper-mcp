import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Config } from './config.js';
import { TwitterError } from './errors.js';

const root = fileURLToPath(
  new URL(import.meta.url.endsWith('.ts') ? '../' : '../../', import.meta.url),
);
const envelope = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.record(z.unknown()) }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);
export interface ScrapeTransport {
  read(operation: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

export function createScrapeTransport(config: Config): ScrapeTransport {
  let current: ChildProcess | undefined;
  let completion: Promise<Record<string, unknown>> | undefined;
  let closed = false;
  const venv = resolve(
    root,
    process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
  );
  const python = config.pythonPath || (existsSync(venv) ? venv : 'python3');
  const db = resolve(root, config.accountsDb || '.local/accounts.db');
  return {
    async read(operation, params) {
      if (closed) throw new TwitterError('SERVER_CLOSED', 'The server is shutting down.');
      if (current)
        throw new TwitterError(
          'SERVER_BUSY',
          'Another session operation is running. Wait for that operation to finish.',
        );
      if (!existsSync(db))
        throw new TwitterError(
          'AUTH_REQUIRED',
          'Import your X session locally with npm run auth:import, or configure TWSCRAPE_ACCOUNTS_DB.',
        );
      completion = new Promise((done, fail) => {
        const env: NodeJS.ProcessEnv = {};
        for (const key of ['PATH', 'HOME', 'SYSTEMROOT', 'LANG', 'SSL_CERT_FILE', 'SSL_CERT_DIR'])
          if (process.env[key]) env[key] = process.env[key];
        Object.assign(env, {
          TWS_TELEMETRY: '0',
          PYTHONUNBUFFERED: '1',
          TWS_HTTP_BACKEND: config.scrapeHttpBackend,
        });
        const child = spawn(python, [resolve(root, 'python/worker.py')], {
          env,
          stdio: ['pipe', 'pipe', 'ignore'],
          shell: false,
        });
        current = child;
        const chunks: Buffer[] = [];
        let bytes = 0;
        let settled = false;
        let failure: TwitterError | undefined;
        const finish = (error?: TwitterError, data?: Record<string, unknown>) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          current = undefined;
          if (error) fail(error);
          else done(data!);
        };
        // Python cancels gracefully first. Hard termination of writes has an unknown outcome.
        const timer = setTimeout(() => {
          failure = new TwitterError(
            'REQUEST_TIMEOUT',
            'The twscrape worker exceeded its deadline. Account locks may remain until expiry.',
          );
          child.kill('SIGKILL');
        }, config.timeoutMs + 3000);
        child.stdin.on('error', () => {});
        child.stdout.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 4 * 1024 * 1024) {
            failure = new TwitterError(
              'UPSTREAM_FORMAT',
              'twscrape returned an oversized response.',
            );
            child.kill('SIGKILL');
          } else chunks.push(chunk);
        });
        child.once('error', () =>
          finish(
            new TwitterError(
              'TWSCRAPE_UNAVAILABLE',
              'Python worker could not start. Run npm run setup:twscrape or configure TWSCRAPE_PYTHON.',
            ),
          ),
        );
        child.once('close', (code) => {
          if (failure) return finish(failure);
          if (code !== 0)
            return finish(
              new TwitterError(
                'UPSTREAM_ERROR',
                'twscrape worker stopped before returning a complete result.',
              ),
            );
          try {
            const result = envelope.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            if (!result.ok)
              return finish(new TwitterError(result.error.code, result.error.message));
            finish(undefined, result.data);
          } catch {
            finish(
              new TwitterError('UPSTREAM_FORMAT', 'twscrape returned an invalid bridge response.'),
            );
          }
        });
        child.stdin.end(
          JSON.stringify({
            operation,
            params,
            db,
            timeoutMs: config.timeoutMs,
            writeEnabled: config.enableWrite,
            writeAccount: config.writeAccount,
            ...(config.proxyUrl ? { proxy: config.proxyUrl } : {}),
          }),
        );
      });
      return completion;
    },
    async close() {
      closed = true;
      const child = current;
      if (child) {
        child.kill('SIGTERM');
        const force = setTimeout(() => child.kill('SIGKILL'), 1000);
        try {
          await completion;
        } catch {
          /* Pending request reports its own error. */
        }
        clearTimeout(force);
      }
    },
  };
}
