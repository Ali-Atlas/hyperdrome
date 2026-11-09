import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Same `@/` root as jsconfig.json, so services under test resolve their imports.
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL('./', import.meta.url)) }],
  },
  test: {
    include: ['tests/**/*.test.js'],
    // The database-backed files share one Postgres, and a tick settles every committed batch below
    // its slot, including another file's. Files run one at a time so a tick sees only its own.
    fileParallelism: false,
  },
});
