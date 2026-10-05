import dotenv from 'dotenv';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const names = ['auth_token', 'ct0'];
const help = `Usage: npm run auth:browser -- [options]
  --browser chrome|edge|firefox|safari   One browser only (default: chrome)
  --profile "Default"                  One profile (Chrome/Edge default: Default)
  --label browser-session              Local account label
  --replace                            Refresh an existing label; preserve account locks
  --check                              Check extraction only; do not import
  --cookie-file /path/cookies.json      Import an explicit extension export instead of reading a browser
  --help                               Show help without reading credentials

Sign into x.com in the selected profile first. This reads only auth_token/ct0 for x.com.
macOS may ask for Keychain access. Windows App-Bound Encryption may require manual export.
Values are never printed or passed as command-line arguments. No network requests or posts are made.`;

export function parseOptions(args) {
  const options = { browser: 'chrome', label: 'browser-session', replace: false, check: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new Error('Duplicate option. Use --help for supported options.');
    seen.add(flag);
    if (flag === '--help') return { help: true };
    if (flag === '--replace' || flag === '--check') {
      options[flag.slice(2)] = true;
      continue;
    }
    const key = {
      '--browser': 'browser',
      '--profile': 'profile',
      '--label': 'label',
      '--cookie-file': 'cookieFile',
    }[flag];
    if (!key || !args[i + 1] || args[i + 1].startsWith('--'))
      throw new Error('Invalid option. Use --help for supported options.');
    if (/[\x00-\x1f\x7f]/.test(args[i + 1]))
      throw new Error('Option values cannot contain control characters.');
    options[key] = args[++i].trim();
  }
  if (!['chrome', 'edge', 'firefox', 'safari'].includes(options.browser))
    throw new Error('Select one supported browser: chrome, edge, firefox or safari.');
  if (!options.label || options.label.length > 80 || /[\x00-\x1f\x7f]/.test(options.label))
    throw new Error('The label must contain 1–80 characters without control characters.');
  if (options.profile === '' || options.cookieFile === '')
    throw new Error('Profile/file cannot be blank.');
  if (options.browser === 'safari' && options.profile)
    throw new Error('Safari does not support --profile.');
  if (options.cookieFile && (seen.has('--browser') || seen.has('--profile')))
    throw new Error('Use either a cookie file or browser/profile options.');
  return options;
}

export function selectSessionCookies(cookies, now = Date.now() / 1000) {
  if (!Array.isArray(cookies))
    throw new Error('Cookie input must be an array or { cookies: [...] }.');
  const selected = {};
  const profiles = new Set();
  for (const cookie of cookies) {
    if (!cookie || !names.includes(cookie.name)) continue;
    let domain =
      typeof cookie.domain === 'string' ? cookie.domain.replace(/^\./, '').toLowerCase() : '';
    if (!domain && typeof cookie.url === 'string') {
      try {
        domain = new URL(cookie.url).hostname.toLowerCase();
      } catch {
        continue;
      }
    }
    if (domain !== 'x.com' || (cookie.path && cookie.path !== '/')) continue;
    if (cookie.partitionKey || cookie.partitionKeyOpaque) continue;
    const expiry = cookie.expires ?? cookie.expirationDate;
    if (typeof expiry === 'number' && expiry > 0 && expiry <= now) continue;
    if (
      typeof cookie.value !== 'string' ||
      !cookie.value ||
      cookie.value.length > 2048 ||
      !/^[\x21-\x7e]+$/.test(cookie.value) ||
      /[;,]/.test(cookie.value)
    )
      throw new Error('Invalid session cookie format; values were not printed.');
    if (selected[cookie.name] && selected[cookie.name] !== cookie.value)
      throw new Error(
        'Conflicting X sessions found. Select one browser profile or export one cookie store.',
      );
    selected[cookie.name] = cookie.value;
    if (cookie.source?.profile) profiles.add(cookie.source.profile);
  }
  if (profiles.size > 1)
    throw new Error('Cookies came from multiple profiles. Select one profile.');
  if (names.some((name) => !selected[name]))
    throw new Error(
      'Both auth_token and ct0 are required. Sign into x.com in the selected profile, or use --cookie-file / manual npm run auth:import if OS decryption is unavailable.',
    );
  return selected;
}

export async function browserCookies(options, getCookies) {
  if (!getCookies) {
    try {
      ({ getCookies } = await import('@steipete/sweet-cookie'));
    } catch {
      throw new Error(
        'Browser helper unavailable. Run npm ci including dev dependencies on the host, or use npm run auth:import.',
      );
    }
  }
  const profile =
    options.profile || (options.browser === 'firefox' ? 'default-release' : 'Default');
  const query = {
    url: 'https://x.com/',
    names,
    browsers: [options.browser],
    mode: 'first',
    includeExpired: false,
    debug: false,
    timeoutMs: 20000,
    ...(options.browser === 'chrome' ? { chromiumBrowser: 'chrome', chromeProfile: profile } : {}),
    ...(options.browser === 'edge' ? { edgeProfile: profile } : {}),
    ...(options.browser === 'firefox' ? { firefoxProfile: profile } : {}),
  };
  try {
    const result = await getCookies(query);
    return selectSessionCookies(result.cookies);
  } catch (error) {
    // Provider errors/warnings may contain local data; don't forward them.
    if (error instanceof Error && error.message.startsWith('Both auth_token')) throw error;
    throw new Error(
      'Could not extract a single X session. Check browser/profile and OS access, or use manual import. Cookie values were not printed.',
    );
  }
}

export function importSession(label, cookies, replace, env = process.env) {
  const venv = resolve(
    root,
    process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
  );
  const python = env.TWSCRAPE_PYTHON || (existsSync(venv) ? venv : 'python3');
  const childEnv = { TWS_TELEMETRY: '0', PYTHONDONTWRITEBYTECODE: '1' };
  for (const key of ['PATH', 'HOME', 'SYSTEMROOT', 'LANG', 'TWSCRAPE_ACCOUNTS_DB'])
    if (env[key]) childEnv[key] = env[key];
  const result = spawnSync(python, [resolve(root, 'scripts/import-session.py'), '--from-stdin'], {
    cwd: root,
    env: childEnv,
    shell: false,
    input: JSON.stringify({ label, cookies, replace }),
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 65536,
  });
  let response;
  try {
    response = JSON.parse(result.stdout);
  } catch {
    /* Never forward process output. */
  }
  if (result.error || !response || !response.ok || result.status !== 0) {
    if (response?.error === 'ACCOUNT_EXISTS')
      throw new Error(
        'This label already exists. Use --replace to refresh it, or choose another --label.',
      );
    throw new Error(
      'Local import failed. Check Python dependencies/database permissions; run npm run setup:twscrape. No provider output was forwarded.',
    );
  }
  return { label: response.label, db: response.db };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(help);
    return;
  }
  dotenv.config({ path: resolve(root, '.env') });
  let cookies;
  if (options.cookieFile) {
    try {
      if (statSync(options.cookieFile).size > 1024 * 1024) throw new Error();
      const payload = JSON.parse(readFileSync(options.cookieFile, 'utf8'));
      cookies = selectSessionCookies(Array.isArray(payload) ? payload : payload.cookies);
    } catch {
      throw new Error(
        'Cannot use this cookie export. Expected at most 1 MiB of JSON with one x.com auth_token/ct0 pair. Values were not printed.',
      );
    }
  } else {
    console.log(
      'Reading only x.com auth_token and ct0 from the selected local browser profile. OS access prompts may appear.',
    );
    cookies = await browserCookies(options);
  }
  if (options.check) {
    console.log(
      'Both required cookies are readable. Values were not printed; no database was modified. This does not verify remote login validity.',
    );
    return;
  }
  const result = importSession(options.label, cookies, options.replace);
  console.log(
    `Session '${result.label}' imported into ${result.db}. Values were not printed. Restart MCP to use it. Write mode was not changed.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
