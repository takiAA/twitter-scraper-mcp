import { fetch as undiciFetch, ProxyAgent } from 'undici';
import type { Config } from './config.js';

export function createNetwork(config: Pick<Config, 'proxyUrl' | 'timeoutMs'>) {
  const dispatcher = config.proxyUrl ? new ProxyAgent(config.proxyUrl) : undefined;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return (await undiciFetch(input as Parameters<typeof undiciFetch>[0], {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)])
        : AbortSignal.timeout(config.timeoutMs),
    })) as unknown as Response;
  };
  return {
    fetch,
    close: async () => {
      await dispatcher?.destroy();
    },
  };
}
