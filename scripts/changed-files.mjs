/**
 * File scope for the ratchet in ENGINEERING.md section 6.
 *
 * "Changed" files get the full standards: everything created or changed since the
 * `pre-hackathon` tag, plus everything under the always-in-scope directories.
 * "Grandfathered" files are baseline files still untouched since the tag.
 *
 * Used by `npm run format:check` (scripts/format.mjs), eslint.config.mjs and tests.
 * Run directly to print the changed-file list: `node scripts/changed-files.mjs`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE_REF = 'pre-hackathon';

/** Extensions Prettier checks. */
export const FORMAT_EXTENSIONS = ['.js', '.jsx', '.mjs', '.json', '.md', '.css'];

/** Extensions ESLint lints. */
export const LINT_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs'];

/** Directories that are always in full scope once they exist. */
export const ALWAYS_IN_SCOPE_DIRS = ['tests/', 'lib/near/', 'contracts/hyperdrome/'];

/**
 * Runs git at the repository root and returns its output as non-empty lines.
 * @param {string[]} args
 * @returns {string[]}
 */
function git(args) {
  return execFileSync('git', args, { cwd: repoRoot(), encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

/** @type {string | undefined} */
let cachedRoot;

/**
 * Absolute path of the repository root.
 * @returns {string}
 */
export function repoRoot() {
  cachedRoot ??= execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  return cachedRoot;
}

/**
 * Keeps paths that have one of the extensions and still exist on disk.
 * @param {Iterable<string>} paths repo-relative paths
 * @param {string[]} extensions
 * @returns {string[]} sorted, unique
 */
function existingWithExtension(paths, extensions) {
  const root = repoRoot();
  return [...new Set(paths)]
    .filter((p) => extensions.includes(extname(p)) && existsSync(join(root, p)))
    .sort();
}

/**
 * Files created or changed since the baseline tag. Committed changes come from
 * `git diff --name-only <base>...HEAD`. Staged, unstaged and untracked work is added so a
 * local run covers what the next commit will contain. Deleted files are left out.
 * @param {{ base?: string, extensions?: string[] }} [options]
 * @returns {string[]} repo-relative paths, sorted and unique
 */
export function listChangedFiles({ base = BASELINE_REF, extensions = FORMAT_EXTENSIONS } = {}) {
  return existingWithExtension(
    [
      ...git(['diff', '--name-only', '--diff-filter=d', `${base}...HEAD`]),
      ...git(['diff', '--name-only', '--diff-filter=d', 'HEAD']),
      ...git(['ls-files', '--others', '--exclude-standard']),
      ...git([
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        '--',
        ...ALWAYS_IN_SCOPE_DIRS,
      ]),
    ],
    extensions
  );
}

/**
 * Baseline files still untouched since the tag: present at `base` and not in the changed set.
 * @param {{ base?: string, extensions?: string[] }} [options]
 * @returns {string[]} repo-relative paths, sorted and unique
 */
export function listGrandfatheredFiles({ base = BASELINE_REF, extensions = LINT_EXTENSIONS } = {}) {
  const changed = new Set(listChangedFiles({ base, extensions }));
  return existingWithExtension(
    git(['ls-tree', '-r', '--name-only', base]).filter((p) => !changed.has(p)),
    extensions
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = listChangedFiles();
  process.stdout.write(files.length > 0 ? `${files.join('\n')}\n` : '');
}
