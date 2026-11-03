import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import prettier from 'eslint-config-prettier/flat';
import { defineConfig, globalIgnores } from 'eslint/config';
import { listGrandfatheredFiles } from './scripts/changed-files.mjs';

/**
 * Rules the untouched baseline breaks at the `pre-hackathon` tag. They are switched off only
 * for grandfathered files (ENGINEERING.md section 6); a file a task touches leaves that list
 * and gets every rule as an error.
 */
const BASELINE_VIOLATIONS = [
  '@next/next/no-img-element',
  'jsx-a11y/role-supports-aria-props',
  'no-empty',
  'no-irregular-whitespace',
  'no-unused-vars',
  'react-hooks/exhaustive-deps',
  'react-hooks/preserve-manual-memoization',
  'react-hooks/set-state-in-effect',
];

/**
 * Raises every "warn" rule to "error", keeping its options.
 * @param {import('eslint').Linter.Config[]} configs
 * @returns {import('eslint').Linter.Config[]}
 */
function warningsAsErrors(configs) {
  return configs.map((config) => {
    if (!config.rules) return config;
    const rules = Object.fromEntries(
      Object.entries(config.rules).map(([name, entry]) => {
        const [severity, ...options] = Array.isArray(entry) ? entry : [entry];
        const raised = severity === 'warn' || severity === 1 ? 'error' : severity;
        return [name, options.length > 0 ? [raised, ...options] : raised];
      })
    );
    return { ...config, rules };
  });
}

/**
 * Escapes glob syntax so a literal path such as `app/drones/[droneId]/page.jsx` matches itself.
 * @param {string} path
 * @returns {string}
 */
function literalGlob(path) {
  return path.replace(/[\\*?[\]{}()!+@]/g, '\\$&');
}

const grandfathered = listGrandfatheredFiles().map(literalGlob);

export default defineConfig([
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
  ...warningsAsErrors([js.configs.recommended, ...nextVitals]),
  {
    // Core rules that misread TypeScript declarations (e.g. `declare namespace` merging);
    // typescript-eslint switches them off for TS files the same way.
    name: 'hyperdrome/typescript-declarations',
    files: ['**/*.ts', '**/*.tsx'],
    rules: { 'no-unused-vars': 'off', 'no-undef': 'off' },
  },
  ...(grandfathered.length > 0
    ? [
        {
          name: 'hyperdrome/grandfathered-baseline',
          files: grandfathered,
          // Baseline disable comments for the rules switched off below would read as unused.
          linterOptions: { reportUnusedDisableDirectives: 'off' },
          rules: Object.fromEntries(BASELINE_VIOLATIONS.map((rule) => [rule, 'off'])),
        },
      ]
    : []),
  prettier,
]);
