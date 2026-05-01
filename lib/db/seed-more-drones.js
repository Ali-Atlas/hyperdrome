// Top up marketplace inventory with 30 additional drones across all 4
// level brackets. Drones are owned by the existing MKT_ORBIT / MKT_PULSE /
// MKT_NEXUS seller accounts (created by seed-marketplace.js) and
// immediately listed. Stats stay within the TSB + per-stat cap for
// their level.
//
// Idempotent: checks by drone name (`MKT_X_NN`) before inserting.
//
// Run with: npm run seed:more-drones

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, inArray } from 'drizzle-orm';
import * as schema from './schema.js';
import { BOT_PROFILES, buildStats } from '../game-engine/drone-stats.js';

const { users, drones, marketplaceListings } = schema;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const db = drizzle(neon(connectionString), { schema });

const SELLER_EMAILS = [
  'mkt-orbit@seed.local',
  'mkt-pulse@seed.local',
  'mkt-nexus@seed.local',
];

/* Cycle profiles by drone index so the marketplace top-up has the
 * same archetype variety as the production bot pool. The shared
 * buildStats applies +-15% per-stat variance, so two drones that
 * land on the same profile still differ on the exact numbers. */
const PROFILE_CYCLE = Object.keys(BOT_PROFILES);
const profileForIndex = (i) => PROFILE_CYCLE[i % PROFILE_CYCLE.length];

/**
 * Price roughly scales with level so tier-4 drones anchor the top of
 * the listings grid and tier-1 anchors the bottom.
 * Level 1 -> ~100, Level 20 -> ~18,000.
 */
function priceFor(level) {
  return Math.round(80 + Math.pow(level, 2.2) * 38);
}

// 30 drones: 7 tier-1, 8 tier-2, 8 tier-3, 7 tier-4. Spread across
// individual levels so the filter controls in the UI have data to hit.
const LEVELS = [
  // tier-1 (L1-5): 7
  2, 3, 3, 4, 4, 5, 5,
  // tier-2 (L6-10): 8
  6, 7, 7, 8, 8, 9, 9, 10,
  // tier-3 (L11-15): 8
  11, 12, 12, 13, 13, 14, 15, 15,
  // tier-4 (L16-20): 7
  16, 17, 17, 18, 19, 19, 20,
];

function nameFor(level, index) {
  const kind =
    level <= 5  ? 'SCOUT' :
    level <= 10 ? 'SKIMMER' :
    level <= 15 ? 'ASCENT' :
                  'APEX';
  // Start after the existing MKT_*_01..12 names so we never collide
  // with the previous marketplace seed.
  return `MKT_${kind}_${String(index + 20).padStart(2, '0')}`;
}

async function main() {
  console.log('Seeding 30 additional marketplace drones...');

  const sellers = await db
    .select()
    .from(users)
    .where(inArray(users.email, SELLER_EMAILS));
  if (sellers.length === 0) {
    console.error(
      '  No MKT_ seller users found. Run `npm run seed:marketplace` first.',
    );
    process.exit(1);
  }
  console.log(`  sellers located (${sellers.length})`);

  let created = 0;
  let skipped = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    const level = LEVELS[i];
    const name = nameFor(level, i);

    const [existing] = await db
      .select({ id: drones.id })
      .from(drones)
      .where(eq(drones.name, name))
      .limit(1);
    if (existing) {
      skipped += 1;
      continue;
    }

    const { stats, tsb } = buildStats(level, profileForIndex(i));
    const seller = sellers[i % sellers.length];

    const [inserted] = await db
      .insert(drones)
      .values({
        userId: seller.id,
        name,
        level,
        totalStatBudget: tsb,
        ...stats,
        isBot: false,
        active: false,
      })
      .returning({ id: drones.id });

    await db.insert(marketplaceListings).values({
      sellerId: seller.id,
      itemType: 'drone',
      droneId: inserted.id,
      price: priceFor(level),
      status: 'active',
    });
    created += 1;
  }

  console.log(`  drones created: ${created}`);
  if (skipped > 0) console.log(`  drones skipped (already existed): ${skipped}`);
  console.log('done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
