import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import prettier from 'eslint-config-prettier/flat';
import { defineConfig, globalIgnores } from 'eslint/config';
import { listGrandfatheredFiles } from './scripts/changed-files.mjs';

/**
 * Rules the untouched baseline breaks, including rules added by later linter upgrades. They are
 * switched off only for grandfathered files (ENGINEERING.md section 6); a file a task touches
 * leaves that list and gets every rule as an error.
 */
const BASELINE_VIOLATIONS = [
  '@next/next/no-img-element',
  // Added in eslint-config-next 16.4; the baseline dashboard page breaks it.
  '@next/next/no-location-assign-relative-destination',
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
  {
    // The race engine is pure and replayable from its seed (ENGINEERING.md 2, SPEC.md 5). The
    // baseline generators in lib/game-engine (drone-names, drone-spawn, drone-stats, matchmaking)
    // are not race simulation and stay outside this rule until their replacements land.
    name: 'hyperdrome/pure-engine',
    files: [
      'lib/game-engine/economy.js',
      'lib/game-engine/mods.js',
      'lib/game-engine/prng.js',
      'lib/game-engine/race-simulator.js',
      'lib/game-engine/sha256.js',
      'lib/game-engine/stats-hash.js',
      'lib/game-engine/templates.js',
    ],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use the race PRNG (lib/game-engine/prng.js).',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'The engine takes time as input, never reads it.',
        },
      ],
    },
  },
  {
    // All chain access goes through lib/near (AGENTS.md, ENGINEERING.md 2).
    name: 'hyperdrome/near-boundary',
    files: ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'],
    ignores: ['lib/near/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'near-api-js', message: 'Import the chain adapter from @/lib/near instead.' },
          ],
          patterns: [
            {
              group: ['near-api-js/*'],
              message: 'Import the chain adapter from @/lib/near instead.',
            },
          ],
        },
      ],
    },
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
