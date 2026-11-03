import { describe, expect, it } from 'vitest';
import { listChangedFiles } from '../scripts/changed-files.mjs';

describe('tooling smoke test', () => {
  it('runs the test runner', () => {
    expect(1 + 1).toBe(2);
  });

  it('lists changed files as an array of repo-relative paths', () => {
    const files = listChangedFiles();
    expect(Array.isArray(files)).toBe(true);
    for (const file of files) {
      expect(typeof file).toBe('string');
      expect(file.startsWith('/')).toBe(false);
    }
  });
});
