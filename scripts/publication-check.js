// Local packaging/document checks. Never inspect ignored credential files or print file contents.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
function run(command, args, input) {
  const result = spawnSync(command, args, {
    cwd: root,
    input,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
  });
  if (result.error || result.status !== 0)
    throw new Error(`Could not complete ${command} check; output withheld.`);
  return result.stdout;
}
function privatePath(path) {
  return (
    (/(^|\/)(?:\.env(?:\..*)?|\.local|\.venv|node_modules|__pycache__|browser-profile|\.auth|\.npmrc)(?:\/|$)/i.test(
      path,
    ) &&
      path !== '.env.example') ||
    /\.(?:db(?:-.*)?|sqlite3?(?:-.*)?|pyc|pyo|har|pem|key|p12|pfx)$/i.test(path) ||
    /(?:cookie|storage[-_]?state).*\.(?:json|txt)$/i.test(path) ||
    /(^|\/)Cookies(?:-.*)?$/.test(path)
  );
}
const tracked = run('git', ['ls-files', '-z']).split('\0').filter(Boolean);
for (const path of tracked)
  if (privatePath(path)) failures.push(`Tracked private artifact: ${path}`);
const cases = [
  '.env',
  '.env.production',
  '.local/accounts.db',
  '.venv/bin/python',
  'accounts.sqlite',
  'x-cookies.json',
  'request.har',
  'private.pem',
  'browser-profile/Default/Cookies',
  'storage-state.json',
];
const ignored = new Set(
  run('git', ['check-ignore', '--no-index', '--stdin'], cases.join('\n') + '\n')
    .trim()
    .split('\n'),
);
for (const path of cases) if (!ignored.has(path)) failures.push(`Ignore rule missing: ${path}`);
const paths = [
  ...new Set(
    run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
      .split('\0')
      .filter(Boolean),
  ),
].filter((p) => existsSync(resolve(root, p)));
for (const path of paths) {
  if (privatePath(path)) {
    failures.push(`Candidate private artifact: ${path}`);
    continue;
  }
  if (!/\.(?:md|ts|js|mjs|py|json|ya?ml|toml|svg)$/.test(path)) continue;
  const text = readFileSync(resolve(root, path), 'utf8');
  if (/(?:\/Users\/|\/home\/)[A-Za-z0-9._-]+\//.test(text))
    failures.push(`Local home directory in: ${path}`);
  if (
    /(?:auth_token|ct0)["']?\s*[:=]\s*["']?[a-f0-9]{32,256}\b/i.test(text) ||
    /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(
      text,
    )
  )
    failures.push(`Possible credential in: ${path} (value withheld)`);
  if (!path.endsWith('.md')) continue;
  const links = [
    ...text.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g),
    ...text.matchAll(/(?:src|href)="([^"\s]+)"/g),
  ];
  for (const match of links) {
    const url = match[1];
    if (/^(?:[a-z]+:|#|\/\/)/i.test(url)) continue;
    const target = url.split('#')[0].split('?')[0];
    if (target && !existsSync(resolve(dirname(resolve(root, path)), decodeURIComponent(target))))
      failures.push(`Broken local link in ${path}: ${target}`);
  }
}
const example = readFileSync(resolve(root, '.env.example'), 'utf8');
if (!/^TWITTER_ENABLE_WRITE=false$/m.test(example))
  failures.push('Example configuration must disable writes.');
for (const key of [
  'TWITTER_API_KEY',
  'TWITTER_API_SECRET_KEY',
  'TWITTER_ACCESS_TOKEN',
  'TWITTER_ACCESS_TOKEN_SECRET',
  'TWITTER_BEARER_TOKEN',
])
  if (!new RegExp(`^${key}=$`, 'm').test(example))
    failures.push(`Example credential must remain empty: ${key}`);
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
if (pkg.private !== true || !Array.isArray(pkg.files))
  failures.push('Private-package guard and explicit package file allowlist are required.');
const cache = mkdtempSync(resolve(tmpdir(), 'twitter-mcp-pack-check-'));
let packed = [];
try {
  const reports = JSON.parse(
    run(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
      'pack',
      '--dry-run',
      '--json',
      '--ignore-scripts',
      '--cache',
      cache,
    ]),
  );
  packed = reports[0].files.map((file) => file.path);
  for (const path of packed)
    if (privatePath(path) || /^(?:test|src|node_modules)\//.test(path))
      failures.push(`Unexpected package artifact: ${path}`);
} finally {
  rmSync(cache, { recursive: true, force: true });
}
if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else
  console.log(
    `Publication checks passed: ${tracked.length} tracked paths, ${paths.filter((p) => p.endsWith('.md')).length} Markdown files, ${packed.length} package files; private artifacts excluded. Full secret detection remains a separate Gitleaks scan.`,
  );
