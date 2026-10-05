import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
test('publication guard rejects leaked cookies, broken links and force-tracked private files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twitter-mcp-publication-test-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    for (const file of ['scripts/publication-check.js', '.gitignore', '.env.example'])
      copyFileSync(join(root, file), join(dir, file));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'publication-guard-fixture',
        version: '0.0.0',
        type: 'module',
        private: true,
        files: ['scripts/publication-check.js'],
      }),
    );
    const git = (args) => {
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      assert.equal(result.status, 0, 'fixture Git operation must succeed');
    };
    const check = () =>
      spawnSync(process.execPath, ['scripts/publication-check.js'], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 20000,
      });
    git(['init', '--quiet']);
    assert.equal(check().status, 0);
    const secret = randomBytes(20).toString('hex');
    writeFileSync(join(dir, 'leak.js'), `const ct0="${secret}";`);
    const leak = check();
    assert.equal(leak.status, 1);
    assert.match(leak.stderr, /Possible credential/);
    assert.ok(!`${leak.stdout}${leak.stderr}`.includes(secret));
    rmSync(join(dir, 'leak.js'));
    writeFileSync(join(dir, 'broken.md'), '[bad](missing.md)');
    const broken = check();
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /Broken local link/);
    rmSync(join(dir, 'broken.md'));
    writeFileSync(join(dir, '.env'), 'FAKE=fixture');
    git(['add', '--force', '.env']);
    const privateFile = check();
    assert.equal(privateFile.status, 1);
    assert.match(privateFile.stderr, /Tracked private artifact/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
