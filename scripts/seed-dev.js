/**
 * Dev-DB wrapper that runs the production seed pipeline 1:1 against the
 * local database resolved from `DATABASE_URL` in `.env.local`.
 *
 *   npm run seed:dev                 (idempotent additive seed)
 *   npm run seed:dev -- --fresh      (TRUNCATE first, then seed)
 *
 * Behavior matches `seed-production.js` exactly - same YES confirmation
 * gate, same `--fresh` semantics, same body. The only difference is
 * which URL the resolver picks.
 *
 * Mechanics: prod's URL resolver is
 *
 *   process.env.PROD_DATABASE_URL ??
 *     (process.env.ALLOW_LOCAL_SEED === '1' ? process.env.DATABASE_URL : null)
 *
 * Both URLs live in `.env.local` (loaded by `node --env-file`), so the
 * `??` would pick prod first even with the flag set. We set
 * ALLOW_LOCAL_SEED=1 to engage the local branch AND `delete` the prod
 * URL out of process.env so the resolver falls through cleanly.
 */

process.env.ALLOW_LOCAL_SEED = '1';
delete process.env.PROD_DATABASE_URL;

if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL is not set. Add it to .env.local and re-run `npm run seed:dev`.',
  );
  process.exit(1);
}

const { runSeed } = await import('./seed-production.js');

const fresh = process.argv.includes('--fresh');

runSeed({ fresh }).catch((err) => {
  console.error('\nseed:dev failed:', err);
  process.exit(1);
});
