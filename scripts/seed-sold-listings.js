/**
 * One-shot script: seed 100 sold marketplace listings into prod
 * (or a local DB if ALLOW_LOCAL_SEED=1) without re-running the full
 * production seed pipeline.
 *
 * Run:
 *   node --env-file=.env.local scripts/seed-sold-listings.js
 *
 * Reads PROD_DATABASE_URL out of .env.local (same resolution as
 * scripts/seed-production.js) and calls `seedSoldListings` against
 * the existing MKT_* sellers and PILOT_D## demo buyers. Both groups
 * must already exist (run `npm run seed:prod` first if they don't).
 *
 * Idempotent: the underlying helper bails out once at least
 * `SOLD_LISTING_FLOOR` (90) MKT_*-owned sold listings exist, so
 * re-running is safe.
 */

import { db, getBotUserMap, seedSoldListings } from './seed-production.js';

async function main() {
  console.log('Seeding sold marketplace listings...');
  const botUserMap = await getBotUserMap();
  const missing = ['MKT_PULSE', 'MKT_NEXUS', 'MKT_ORBIT'].filter(
    (name) => !botUserMap[name],
  );
  if (missing.length > 0) {
    console.error(
      `\nMissing market-maker bot users: ${missing.join(', ')}.\n` +
        'Run `npm run seed:prod` first to create the MKT_* sellers + ' +
        'PILOT_D## demo buyers, then re-run this script.',
    );
    process.exit(1);
  }
  const result = await seedSoldListings(botUserMap);
  console.log('  Result:', result);
  if (result.skins === 0 && result.mods === 0 && result.drones === 0) {
    console.log(
      '\nNo new sold listings inserted. Either the floor was already met or vault stock / demo buyers are unavailable.',
    );
  }
}

main()
  .then(() => {
    // Drizzle's neon-http driver uses HTTP fetch and doesn't require an
    // explicit close; let the script exit on its own.
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nSeed failed:', err);
    process.exit(1);
  });

// `db` is exported by seed-production.js and initialized at import
// time; this re-export is intentionally a no-op marker so future
// readers can grep this file for the DB handle source.
void db;
