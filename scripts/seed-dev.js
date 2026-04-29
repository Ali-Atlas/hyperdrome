/**
 * Local-DB seed wrapper. Truncates the same set of tables that a fresh
 * prod seed assumes empty, then runs the prod seed pipeline against the
 * local database (resolved from `DATABASE_URL` in `.env.local`).
 *
 *   npm run seed:dev
 *
 * Truncate scope mirrors what a from-scratch prod seed expects to write
 * into. Preserves `tracks`, `seasons`, and `admin_config` because those
 * are reference / config tables the prod seed upserts idempotently and
 * we don't want to lose any local admin tweaks across reseeds.
 *
 * The interactive YES confirmation in seed-production is skipped here
 * because the operator already opted in by running this dev script
 * against the dev URL (and ALLOW_LOCAL_SEED is required to even resolve
 * the URL — the prod seed still fails closed without
 * `PROD_DATABASE_URL` set).
 */

// Set the env flags BEFORE importing seed-production.js so its module-
// level URL resolver finds them. Dynamic import (below) preserves this
// ordering — a static `import` would hoist above these mutations.
process.env.ALLOW_LOCAL_SEED = '1';

if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL is not set. Add it to .env.local and re-run `npm run seed:dev`.',
  );
  process.exit(1);
}

const { sql } = await import('drizzle-orm');
const { db, runSeed } = await import('./seed-production.js');

const TRUNCATE_TABLES = [
  'races',
  'marketplace_listings',
  'drone_skins',
  'drone_mods',
  'drone_ownership_history',
  'drones',
  'skins',
  'mods',
  'accounts',
  'sessions',
  'verification_token',
  'users',
];

async function truncate() {
  const list = TRUNCATE_TABLES.map((t) => `"${t}"`).join(', ');
  console.log(`Truncating ${TRUNCATE_TABLES.length} tables (RESTART IDENTITY CASCADE)...`);
  // sql.raw is intentional here — the table list is hardcoded above, not
  // user input, so there's no injection vector. Drizzle's tagged sql`` only
  // parameterizes values, and TRUNCATE doesn't take values; it needs the
  // identifier list inline.
  await db.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`));
  console.log('Truncate complete.\n');
}

async function main() {
  const t0 = Date.now();
  console.log('Seeding LOCAL database (DATABASE_URL).');
  console.log('Preserving: tracks, seasons, admin_config.\n');
  await truncate();
  await runSeed({ skipConfirm: true });
  const dt = Math.round((Date.now() - t0) / 100) / 10;
  console.log(`\nseed:dev complete in ${dt}s.`);
}

main().catch((err) => {
  console.error('\nseed:dev failed:', err);
  process.exit(1);
});
