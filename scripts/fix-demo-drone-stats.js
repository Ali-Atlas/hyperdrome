#!/usr/bin/env node
/**
 * One-shot fix for demo accounts seeded BEFORE seed-demo-player.js
 * switched to the production buildStats() algorithm. Those legacy seeds
 * used a `buildDemoStats` that:
 *   - Only randomized 4 primary stats (speed/turning/acceleration/
 *     durability) within [5, cap].
 *   - Hardcoded the other 5 secondary stats (nightVision, batteryCapacity,
 *     rainHandling, windResistance, consistency) to 1.
 *   - Trimmed-only-on-overflow, never filled to TSB — leaving demo
 *     drones with significantly under-allocated stat budgets.
 *
 * This script:
 *   1. Finds every drone owned by a PILOT_D* user.
 *   2. Looks up the demo profile for that drone's level (each demo
 *      account's 8 drones occupy unique levels: 3/5/7/12/14/16/17/18).
 *   3. Recomputes a full 9-stat allocation via buildStats(level, profile)
 *      — the same algorithm the production seeder uses for racing bots.
 *   4. Updates the drone row's 9 stat columns + total_stat_budget in place.
 *   5. Logs every update in the form:
 *      "VORTEX-X3 LV17 cornerer: SPD 26 TRN 86 ACC 26 DUR 52 NV 26 BAT 26
 *       RAIN 26 WIND 26 CST 52"
 *
 * Usage:
 *   node --env-file=.env.local scripts/fix-demo-drone-stats.js
 *
 * Connects to PROD_DATABASE_URL (or DATABASE_URL when ALLOW_LOCAL_SEED=1
 * is set, mirroring the seed-production fail-closed pattern).
 */

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { and, eq, like } from 'drizzle-orm';

import * as schema from '../lib/db/schema.js';

const { users, drones } = schema;

/* -------------------------------------------------------------------------- */
/* Stat-budget constants (mirror lib/db/seed.js + game-engine/economy.js) */
/* -------------------------------------------------------------------------- */

const TSB_BASE = 9;
const TSB_PER_LEVEL = 20;
const STAT_CAP_BASE = 10;
const STAT_CAP_PER_LEVEL = 4.5;

const ALL_STAT_KEYS = [
  'speed',
  'turning',
  'acceleration',
  'durability',
  'nightVision',
  'batteryCapacity',
  'rainHandling',
  'windResistance',
  'consistency',
];

/* Profile weight vectors duplicated from scripts/seed-production.js +
 * scripts/seed-demo-player.js. Indexes line up with ALL_STAT_KEYS. */
const BOT_PROFILES = {
  balanced:    [1, 1, 1, 1, 1, 1, 1, 1, 1],
  speedster:   [3, 1, 3, 1, 1, 1, 1, 3, 1],
  cornerer:    [1, 4, 1, 2, 1, 1, 1, 1, 2],
  tank:        [1, 1, 1, 4, 1, 2, 1, 1, 2],
  nightHunter: [2, 1, 1, 1, 4, 1, 1, 1, 1],
  rainRider:   [1, 2, 1, 1, 1, 1, 4, 1, 2],
  windWalker:  [2, 1, 2, 1, 1, 1, 1, 4, 1],
  marathoner:  [2, 1, 1, 2, 1, 4, 1, 1, 1],
  consistent:  [1, 2, 1, 1, 1, 1, 1, 1, 5],
  allrounder:  [2, 2, 2, 2, 1, 1, 1, 1, 2],
};

/* DEMO_DRONES roster from scripts/seed-demo-player.js. Each level appears
 * exactly once, so a single drone's level uniquely identifies its
 * archetype + profile. */
const LEVEL_TO_DEMO = {
  18: { archetype: 'STRIKER', profile: 'speedster' },
  3:  { archetype: 'RUNNER',  profile: 'balanced' },
  17: { archetype: 'VIPER',   profile: 'cornerer' },
  12: { archetype: 'SCOUT',   profile: 'allrounder' },
  7:  { archetype: 'BOLT',    profile: 'speedster' },
  16: { archetype: 'HAWK',    profile: 'nightHunter' },
  5:  { archetype: 'PHANTOM', profile: 'balanced' },
  14: { archetype: 'GHOST',   profile: 'tank' },
};

/* -------------------------------------------------------------------------- */
/* buildStats — exact mirror of scripts/seed-production.js#buildStats */
/* -------------------------------------------------------------------------- */

function buildStats(level, profileName) {
  const tsb = TSB_BASE + TSB_PER_LEVEL * level;
  const cap = Math.min(100, STAT_CAP_BASE + Math.floor(STAT_CAP_PER_LEVEL * level));
  const points = tsb - 9;
  const weights = BOT_PROFILES[profileName] ?? BOT_PROFILES.balanced;
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const stats = Object.fromEntries(ALL_STAT_KEYS.map((k) => [k, 1]));
  let assigned = 0;
  for (let i = 0; i < ALL_STAT_KEYS.length; i++) {
    const share = Math.floor((points * weights[i]) / totalWeight);
    stats[ALL_STAT_KEYS[i]] = Math.min(cap, 1 + share);
    assigned += stats[ALL_STAT_KEYS[i]] - 1;
  }
  let remaining = points - assigned;
  let guard = 0;
  while (remaining > 0 && guard < 100) {
    let placed = 0;
    for (let k = 0; k < ALL_STAT_KEYS.length && remaining > 0; k++) {
      if (stats[ALL_STAT_KEYS[k]] < cap) {
        stats[ALL_STAT_KEYS[k]] += 1;
        remaining -= 1;
        placed += 1;
      }
    }
    if (placed === 0) break;
    guard += 1;
  }
  return { stats, tsb };
}

/* -------------------------------------------------------------------------- */
/* Bootstrap                                                                  */
/* -------------------------------------------------------------------------- */

const RESOLVED_URL =
  process.env.PROD_DATABASE_URL ??
  (process.env.ALLOW_LOCAL_SEED === '1' ? process.env.DATABASE_URL : null);
if (!RESOLVED_URL) {
  console.error(
    'PROD_DATABASE_URL is not set. Add it to .env.local and re-run with `node --env-file=.env.local scripts/fix-demo-drone-stats.js` (or set ALLOW_LOCAL_SEED=1 to target the dev DB).',
  );
  process.exit(1);
}

const db = drizzle(neon(RESOLVED_URL), { schema });

async function main() {
  console.log('\nfix-demo-drone-stats: scanning prod drones table...\n');

  // 1. Pull every PILOT_D* drone.
  const targets = await db
    .select({
      droneId: drones.id,
      droneName: drones.name,
      level: drones.level,
      userName: users.name,
    })
    .from(drones)
    .innerJoin(users, eq(users.id, drones.userId))
    .where(and(like(users.name, 'PILOT_D%')));

  if (targets.length === 0) {
    console.log('No PILOT_D*-owned drones found. Nothing to do.\n');
    return;
  }
  console.log(
    `${targets.length} PILOT_D drone(s) to recalculate. Updating sequentially...\n`,
  );

  let updated = 0;
  let skipped = 0;
  for (const t of targets) {
    const meta = LEVEL_TO_DEMO[t.level];
    if (!meta) {
      // Level outside the demo roster - falls back to balanced rather
      // than skipping, so drones at non-roster levels still get a
      // proper 9-stat distribution. Logged so Captain can audit.
      const { stats, tsb } = buildStats(t.level, 'balanced');
      await db
        .update(drones)
        .set({ ...stats, totalStatBudget: tsb })
        .where(eq(drones.id, t.droneId));
      console.log(
        `${t.droneName} (${t.userName}) LV${t.level} balanced (off-roster level): ${formatStats(stats)}`,
      );
      updated += 1;
      continue;
    }

    const { stats, tsb } = buildStats(t.level, meta.profile);
    await db
      .update(drones)
      .set({ ...stats, totalStatBudget: tsb })
      .where(eq(drones.id, t.droneId));
    console.log(
      `${t.droneName} (${t.userName}) LV${t.level} ${meta.profile} [${meta.archetype}]: ${formatStats(stats)}`,
    );
    updated += 1;
  }

  console.log(
    `\nDone. Updated ${updated} drone(s) (${skipped} skipped) across PILOT_D* demo accounts.\n`,
  );
}

function formatStats(s) {
  return [
    `SPD ${s.speed}`,
    `TRN ${s.turning}`,
    `ACC ${s.acceleration}`,
    `DUR ${s.durability}`,
    `NV ${s.nightVision}`,
    `BAT ${s.batteryCapacity}`,
    `RAIN ${s.rainHandling}`,
    `WIND ${s.windResistance}`,
    `CST ${s.consistency}`,
  ].join(' ');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nfix-demo-drone-stats failed:\n', err);
    process.exit(1);
  });
