export interface Config {
  readBackend: 'oembed' | 'api' | 'twscrape';
  discoveryBackend: 'twscrape' | 'api';
  pythonPath?: string;
  accountsDb?: string;
  scrapeHttpBackend: 'httpx' | 'curl';
  enableWrite: boolean;
  timeoutMs: number;
  proxyUrl?: string;
  bearerToken?: string;
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  accessSecret?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const readBackend = env.TWITTER_READ_BACKEND || 'oembed';
  if (!['oembed', 'api', 'twscrape'].includes(readBackend)) {
    throw new Error('TWITTER_READ_BACKEND must be oembed, twscrape or api');
  }
  const discoveryBackend = env.TWITTER_DISCOVERY_BACKEND || 'twscrape';
  if (!['twscrape', 'api'].includes(discoveryBackend))
    throw new Error('TWITTER_DISCOVERY_BACKEND must be twscrape or api');
  const scrapeHttpBackend = env.TWSCRAPE_HTTP_BACKEND || 'httpx';
  if (!['httpx', 'curl'].includes(scrapeHttpBackend))
    throw new Error('TWSCRAPE_HTTP_BACKEND must be httpx or curl');
  if (env.TWITTER_ENABLE_WRITE && !['true', 'false'].includes(env.TWITTER_ENABLE_WRITE)) {
    throw new Error('TWITTER_ENABLE_WRITE must be true or false');
  }
  const timeoutMs = Number(env.REQUEST_TIMEOUT_MS || 20000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) {
    throw new Error('REQUEST_TIMEOUT_MS must be an integer between 100 and 120000');
  }
  const proxyUrl = env.PROXY_URL?.trim() || undefined;
  if (proxyUrl) {
    try {
      const url = new URL(proxyUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch {
      throw new Error('PROXY_URL must be a valid HTTP(S) proxy URL');
    }
  }
  const value = (key: string) => env[key]?.trim() || undefined;
  return {
    readBackend: readBackend as Config['readBackend'],
    discoveryBackend: discoveryBackend as Config['discoveryBackend'],
    pythonPath: value('TWSCRAPE_PYTHON'),
    accountsDb: value('TWSCRAPE_ACCOUNTS_DB'),
    scrapeHttpBackend: scrapeHttpBackend as Config['scrapeHttpBackend'],
    enableWrite: env.TWITTER_ENABLE_WRITE === 'true',
    timeoutMs,
    proxyUrl,
    bearerToken: value('TWITTER_BEARER_TOKEN'),
    apiKey: value('TWITTER_API_KEY'),
    apiSecret: value('TWITTER_API_SECRET_KEY'),
    accessToken: value('TWITTER_ACCESS_TOKEN'),
    accessSecret: value('TWITTER_ACCESS_TOKEN_SECRET'),
  };
}
