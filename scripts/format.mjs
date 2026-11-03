/**
 * Runs Prettier on the ratchet scope from scripts/changed-files.mjs.
 * Usage: `node scripts/format.mjs --check` or `node scripts/format.mjs --write`.
 * Files matched by .prettierignore are skipped by Prettier itself.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { listChangedFiles, repoRoot } from './changed-files.mjs';

const mode = process.argv[2];
if (mode !== '--check' && mode !== '--write') {
  console.error({ scope: 'format', msg: 'expected --check or --write', got: mode ?? null });
  process.exit(2);
}

const files = listChangedFiles();
if (files.length === 0) {
  process.stdout.write('format: no files in scope\n');
  process.exit(0);
}

const prettierBin = createRequire(import.meta.url).resolve('prettier/bin/prettier.cjs');
try {
  execFileSync(process.execPath, [prettierBin, mode, ...files], {
    cwd: repoRoot(),
    stdio: 'inherit',
  });
} catch {
  process.exit(1);
}
