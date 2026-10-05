import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseOptions, selectSessionCookies, browserCookies } from '../scripts/auth-browser.js';

const cookies = [
  { name: 'auth_token', value: 'fake-auth-secret', domain: '.x.com', path: '/' },
  { name: 'ct0', value: 'fake-csrf-secret', domain: '.x.com', path: '/' },
];
test('browser auth options select one profile and reject ambiguous options', () => {
  assert.deepEqual(
    parseOptions(['--browser', 'chrome', '--profile', 'Profile 2', '--label', 'my-x', '--replace']),
    { browser: 'chrome', profile: 'Profile 2', label: 'my-x', replace: true, check: false },
  );
  for (const args of [
    ['--browser', 'chrome,firefox'],
    ['--profile', ''],
    ['--browser', 'chrome', '--browser', 'edge'],
    ['--label', '\nsecret'],
    ['--cookie-file', 'cookies.json', '--profile', 'Default'],
    ['--browser', 'safari', '--profile', 'Default'],
    ['--auth-token', 'secret'],
  ])
    assert.throws(() => parseOptions(args));
  assert.equal(parseOptions(['--help']).help, true);
});
test('only unexpired unpartitioned x.com root session cookies are accepted', () => {
  const list = [
    ...cookies,
    { name: 'other_secret', value: 'private', domain: '.x.com' },
    { name: 'ct0', value: 'wrong', domain: 'not-x.com' },
    { name: 'ct0', value: 'old', domain: '.x.com', expires: 1 },
    {
      name: 'ct0',
      value: 'partitioned',
      domain: '.x.com',
      partitionKey: { topLevelSite: 'https://other.com' },
    },
    { name: 'ct0', value: 'wrong-path', domain: '.x.com', path: '/other' },
  ];
  assert.deepEqual(selectSessionCookies(list), {
    auth_token: 'fake-auth-secret',
    ct0: 'fake-csrf-secret',
  });
  assert.throws(() => selectSessionCookies([{ name: 'auth_token', value: 'secret' }]));
  assert.throws(
    () => selectSessionCookies([{ ...cookies[0], value: 'bad; header' }, cookies[1]]),
    (e) => !e.message.includes('header'),
  );
});
test('conflicting cookies and mixed profiles fail instead of silently merging sessions', () => {
  assert.throws(
    () => selectSessionCookies([...cookies, { ...cookies[0], value: 'another-auth' }]),
    /Conflicting/,
  );
  assert.throws(
    () =>
      selectSessionCookies(cookies.map((c, i) => ({ ...c, source: { profile: 'Profile ' + i } }))),
    /multiple profiles/,
  );
});
test('provider receives fixed host/name allowlists with no browser/profile fallback', async () => {
  let options;
  const selected = await browserCookies(parseOptions(['--profile', 'Work']), async (query) => {
    options = query;
    return { cookies, warnings: ['must not print secrets'] };
  });
  assert.equal(selected.auth_token, 'fake-auth-secret');
  assert.equal(options.url, 'https://x.com/');
  assert.deepEqual(options.names, ['auth_token', 'ct0']);
  assert.deepEqual(options.browsers, ['chrome']);
  assert.equal(options.chromeProfile, 'Work');
  assert.equal(options.chromiumBrowser, 'chrome');
  assert.equal(options.includeExpired, false);
  assert.equal(options.debug, false);
  await assert.rejects(
    () =>
      browserCookies(parseOptions([]), async () => {
        throw new Error('auth_token=secret');
      }),
    (e) => !e.message.includes('auth_token=secret'),
  );
});
test('pinned helper supports its inline API without reading a browser', async () => {
  const { getCookies } = await import('@steipete/sweet-cookie');
  const result = await getCookies({
    url: 'https://x.com/',
    names: ['auth_token', 'ct0'],
    browsers: ['chrome'],
    inlineCookiesJson: JSON.stringify(cookies),
  });
  assert.deepEqual(selectSessionCookies(result.cookies), {
    auth_token: 'fake-auth-secret',
    ct0: 'fake-csrf-secret',
  });
});
test('CLI imports through a private pipe, checks without changes and requires explicit replacement', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twitter-browser-auth-'));
  const input = join(dir, 'cookies.json'),
    db = join(dir, 'accounts.db');
  writeFileSync(input, JSON.stringify({ cookies }), { mode: 0o600 });
  const run = (args) =>
    spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../scripts/auth-browser.js', import.meta.url)),
        '--cookie-file',
        input,
        ...args,
      ],
      { env: { ...process.env, TWSCRAPE_ACCOUNTS_DB: db }, encoding: 'utf8', timeout: 20000 },
    );
  try {
    const checked = run(['--check']);
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(existsSync(db), false);
    const imported = run(['--label', 'test']);
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(existsSync(db), true);
    const collision = run(['--label', 'test']);
    assert.equal(collision.status, 1);
    assert.match(collision.stderr, /--replace/);
    const refresh = run(['--label', 'test', '--replace']);
    assert.equal(refresh.status, 0, refresh.stderr);
    for (const result of [checked, imported, collision, refresh])
      assert.doesNotMatch(result.stdout + result.stderr, /fake-auth-secret|fake-csrf-secret/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
