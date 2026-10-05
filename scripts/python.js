import dotenv from 'dotenv';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({ path: resolve(root, '.env') });
const venv = resolve(
  root,
  process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
);
function run(command, args) {
  const r = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  if (r.error) {
    console.error('Could not start Python. Install Python 3.11+ or set TWSCRAPE_PYTHON.');
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status || 1);
}
if (process.argv[2] === 'setup') {
  if (!existsSync(venv)) run(process.env.TWSCRAPE_PYTHON || 'python3', ['-m', 'venv', '.venv']);
  run(venv, ['-m', 'pip', 'install', '-r', 'requirements.txt']);
} else if (process.argv[2] === 'import') {
  run(process.env.TWSCRAPE_PYTHON || venv, [resolve(root, 'scripts/import-session.py')]);
} else if (process.argv[2] === 'test') {
  run(process.env.TWSCRAPE_PYTHON || (existsSync(venv) ? venv : 'python3'), [
    '-m',
    'unittest',
    'discover',
    '-s',
    'test/python',
    '-v',
  ]);
} else process.exit(1);
