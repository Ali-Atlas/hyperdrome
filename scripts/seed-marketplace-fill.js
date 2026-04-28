#!/usr/bin/env node
/**
 * Top-up marketplace seed: keeps the live demo board feeling busy by
 * filling out the listings to fixed targets and ensuring matchmaking has
 * enough racing bots in every level bracket.
 *
 *   Drone listings target:  38 active   (= 8 from earlier seed + 30 more)
 *   Skin listings target:   30 active   (= 10 from earlier seed + 20 more)
 *   Mod listings target:    24 active   (= 9 from earlier seed + 15 more)
 *   Active racing bots:     >= 5 per bracket (20 total minimum) where
 *                           bracket = LV 1-5 / 6-10 / 11-15 / 16-20.
 *
 * Listings come from MKT_PULSE / MKT_NEXUS / MKT_ORBIT bot sellers.
 *
 * Idempotent. The script counts current state and only inserts the
 * difference up to each target. Re-runs are no-ops once targets are met.
 *
 *   Skin listings draw from the legacy placeholder pool (`image_url` NOT
 *   matching /skins/%/.webp) so the rendered cards show the SVG prism
 *   fallback, leaving the photographic skin pool untouched for packs.
 *
 *   Drone listings come from MKT_*-owned drones that aren't already
 *   listed. If the seller pool is exhausted at a tier, the script logs
 *   "no candidates" and moves on.
 *
 *   Active-bot top-up creates `is_bot=true; user_id=NULL; active=true`
 *   drones with random stats inside the LV cap, mirroring the
 *   `lib/game-engine/matchmaking.js#createSeedBot` pattern.
 *
 * Run from the repo root:  node scripts/seed-marketplace-fill.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const TARGET_DRONE_LISTINGS = 38;
const TARGET_SKIN_LISTINGS = 30;
const TARGET_MOD_LISTINGS = 24;
const MIN_BOTS_PER_BRACKET = 5;

const SELLER_NAMES = ['MKT_PULSE', 'MKT_NEXUS', 'MKT_ORBIT'];

const TIER_BRACKETS = [
  { tier: 1, levelMin: 1,  levelMax: 5  },
  { tier: 2, levelMin: 6,  levelMax: 10 },
  { tier: 3, levelMin: 11, levelMax: 15 },
  { tier: 4, levelMin: 16, levelMax: 20 },
];

// Drone listing price bands per tier (uniform random in [lo, hi]).
const DRONE_PRICE_BANDS = {
  1: [ 1_000,  3_000],
  2: [ 3_000,  8_000],
  3: [ 8_000, 18_000],
  4: [18_000, 35_000],
};

// Skin listing price bands per rarity.
const SKIN_PRICE_BANDS = {
  common: [   500,  1_500],
  rare:   [ 3_000,  8_000],
  epic:   [15_000, 25_000],
};

// Mod listing price bands per rarity.
const MOD_PRICE_BANDS = {
  common: [   200,    700],
  rare:   [ 1_500,  4_000],
  epic:   [ 8_000, 15_000],
};

const STAT_COLUMNS = [
  'speed', 'turning', 'acceleration', 'durability',
  'night_vision', 'battery_capacity', 'rain_handling',
  'wind_resistance', 'consistency',
];

function randInt(lo, hi) {
  return Math.floor(lo + Math.random() * (hi - lo + 1));
}

function randomBotStats(level) {
  // Per-stat cap = min(100, 10 + floor(4.5 * level)). TSB = 9 + 20 * level.
  const cap = Math.min(100, 10 + Math.floor(4.5 * level));
  const tsb = 9 + 20 * level;
  // Uniformly sample each stat, then scale down if the sum exceeds TSB.
  const lo = Math.max(1, Math.floor(cap * 0.25));
  const hi = Math.floor(cap * 0.75);
  const stats = {};
  for (const col of STAT_COLUMNS) {
    stats[col] = randInt(lo, hi);
  }
  let sum = STAT_COLUMNS.reduce((a, k) => a + stats[k], 0);
  if (sum > tsb) {
    const scale = tsb / sum;
    for (const col of STAT_COLUMNS) {
      stats[col] = Math.max(1, Math.floor(stats[col] * scale));
    }
  }
  return { stats, cap, tsb };
}

async function resolveSellers() {
  const rows = await sql`
    SELECT id, username FROM users
    WHERE username IN ('MKT_PULSE', 'MKT_NEXUS', 'MKT_ORBIT')
  `;
  const map = Object.fromEntries(rows.map((r) => [r.username, r.id]));
  for (const k of SELLER_NAMES) {
    if (!map[k]) {
      console.error(`Seller ${k} not found in users — bail.`);
      process.exit(1);
    }
  }
  return map;
}

/* -------------------------------------------------------------------------- */
/* Drone listings                                                             */
/* -------------------------------------------------------------------------- */

async function topUpDroneListings(sellers) {
  const sellerIds = Object.values(sellers);

  const [{ active }] = await sql`
    SELECT COUNT(*)::int AS active FROM marketplace_listings
    WHERE item_type = 'drone' AND status = 'active'
  `;
  const need = Math.max(0, TARGET_DRONE_LISTINGS - active);
  console.log(
    `\n--- drone listings ---\n` +
      `current=${active} target=${TARGET_DRONE_LISTINGS} need=${need}`,
  );
  if (need === 0) return;

  // Distribute the needed listings across the 4 tiers in roughly equal
  // proportion. Floor + remainder so totals add up.
  const perTier = Math.floor(need / TIER_BRACKETS.length);
  const remainder = need - perTier * TIER_BRACKETS.length;

  const sellerCycle = [...SELLER_NAMES];
  let cycleIdx = 0;
  let placed = 0;

  for (let t = 0; t < TIER_BRACKETS.length; t += 1) {
    const tier = TIER_BRACKETS[t];
    const want = perTier + (t < remainder ? 1 : 0);
    if (want === 0) continue;

    // Pool: bot-owned drones in this level range that aren't already
    // ACTIVE-listed. Prefer drones with no applied skin so we don't
    // pull legendary-equipped showpieces back onto the board.
    const pool = await sql`
      SELECT d.id, d.name, d.level, d.elo_rating, d.user_id
      FROM drones d
      WHERE d.user_id = ANY(${sellerIds})
        AND d.level >= ${tier.levelMin}
        AND d.level <= ${tier.levelMax}
        AND d.applied_skin_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM marketplace_listings l
          WHERE l.drone_id = d.id AND l.status = 'active'
        )
      ORDER BY d.elo_rating DESC, d.id ASC
      LIMIT ${want}
    `;

    if (pool.length === 0) {
      console.log(`  tier ${tier.tier}: no eligible drones, skipping`);
      continue;
    }

    for (const drone of pool) {
      const [lo, hi] = DRONE_PRICE_BANDS[tier.tier];
      const price = randInt(lo, hi);
      // Round to nearest 100 for visual cleanliness.
      const rounded = Math.round(price / 100) * 100;
      const sellerKey = sellerCycle[cycleIdx % sellerCycle.length];
      cycleIdx += 1;
      const sellerId = sellers[sellerKey];

      // The drone's actual current owner is its existing user_id (MKT_*);
      // the seller record on the listing is whichever bot we cycle to,
      // matching whoever currently holds the drone. We re-home the
      // drone's owner to that bot to keep listing seller and drone owner
      // consistent (the marketplace API expects matching owner/seller).
      await sql`UPDATE drones SET user_id = ${sellerId} WHERE id = ${drone.id}`;
      await sql`
        INSERT INTO marketplace_listings (seller_id, item_type, drone_id, price, status)
        VALUES (${sellerId}, 'drone', ${drone.id}, ${rounded}, 'active')
      `;
      console.log(
        `  list  tier ${tier.tier}  ${drone.name.padEnd(28)}  Lv ${String(drone.level).padStart(2)}  ELO ${String(drone.elo_rating).padStart(4)}  ${rounded.toLocaleString().padStart(7)}V  by ${sellerKey}`,
      );
      placed += 1;
    }
  }

  console.log(`drone listings placed: ${placed}`);
}

/* -------------------------------------------------------------------------- */
/* Skin listings (legacy placeholder pool)                                    */
/* -------------------------------------------------------------------------- */

async function topUpSkinListings(sellers) {
  const [{ active }] = await sql`
    SELECT COUNT(*)::int AS active FROM marketplace_listings
    WHERE item_type = 'skin' AND status = 'active'
  `;
  const need = Math.max(0, TARGET_SKIN_LISTINGS - active);
  console.log(
    `\n--- skin listings ---\n` +
      `current=${active} target=${TARGET_SKIN_LISTINGS} need=${need}`,
  );
  if (need === 0) return;

  const sellerCycle = [...SELLER_NAMES];
  let cycleIdx = 0;
  let placed = 0;

  // Three-pass distribution: ~5 epic, ~7 rare, ~8 common (roughly,
  // remainder absorbed). All from the legacy placeholder pool — those
  // skins render as SVG prisms in the UI since they have no .webp.
  const RARITY_TARGETS = [
    { rarity: 'epic',   take: Math.round(need * 0.25) },
    { rarity: 'rare',   take: Math.round(need * 0.35) },
    { rarity: 'common', take: Math.round(need * 0.40) },
  ];
  // Adjust last bucket so the totals match exactly.
  const sumAssigned = RARITY_TARGETS.reduce((a, r) => a + r.take, 0);
  RARITY_TARGETS[RARITY_TARGETS.length - 1].take += need - sumAssigned;

  for (const { rarity, take } of RARITY_TARGETS) {
    if (take <= 0) continue;
    // Legacy placeholder pool: not /skins/...webp AND currently unbound
    // (no drone_skins row). Pick deterministically by id for re-run
    // stability.
    const pool = await sql`
      SELECT s.id, s.name
      FROM skins s
      LEFT JOIN drone_skins ds ON ds.skin_id = s.id
      WHERE s.rarity = ${rarity}
        AND ds.id IS NULL
        AND NOT (s.image_url LIKE '/skins/%' AND s.image_url LIKE '%.webp')
        AND NOT EXISTS (
          SELECT 1 FROM marketplace_listings l
          WHERE l.skin_id = s.id AND l.status = 'active'
        )
      ORDER BY s.id ASC
      LIMIT ${take}
    `;
    if (pool.length === 0) {
      console.log(`  ${rarity}: no candidates in legacy pool`);
      continue;
    }
    for (const skin of pool) {
      const [lo, hi] = SKIN_PRICE_BANDS[rarity];
      const price = Math.round(randInt(lo, hi) / 50) * 50;
      const sellerKey = sellerCycle[cycleIdx % sellerCycle.length];
      cycleIdx += 1;
      const sellerId = sellers[sellerKey];
      await sql`UPDATE skins SET user_id = ${sellerId} WHERE id = ${skin.id}`;
      await sql`
        INSERT INTO marketplace_listings (seller_id, item_type, skin_id, price, status)
        VALUES (${sellerId}, 'skin', ${skin.id}, ${price}, 'active')
      `;
      console.log(
        `  list  ${rarity.padEnd(7)}  ${skin.name.padEnd(28)}  ${price.toLocaleString().padStart(7)}V  by ${sellerKey}`,
      );
      placed += 1;
    }
  }

  console.log(`skin listings placed: ${placed}`);
}

/* -------------------------------------------------------------------------- */
/* Mod listings                                                                */
/* -------------------------------------------------------------------------- */

async function topUpModListings(sellers) {
  const [{ active }] = await sql`
    SELECT COUNT(*)::int AS active FROM marketplace_listings
    WHERE item_type = 'mod' AND status = 'active'
  `;
  const need = Math.max(0, TARGET_MOD_LISTINGS - active);
  console.log(
    `\n--- mod listings ---\n` +
      `current=${active} target=${TARGET_MOD_LISTINGS} need=${need}`,
  );
  if (need === 0) return;

  const sellerCycle = [...SELLER_NAMES];
  let cycleIdx = 0;
  let placed = 0;

  const RARITY_TARGETS = [
    { rarity: 'epic',   take: Math.round(need * 0.20) },
    { rarity: 'rare',   take: Math.round(need * 0.40) },
    { rarity: 'common', take: Math.round(need * 0.40) },
  ];
  const sumAssigned = RARITY_TARGETS.reduce((a, r) => a + r.take, 0);
  RARITY_TARGETS[RARITY_TARGETS.length - 1].take += need - sumAssigned;

  for (const { rarity, take } of RARITY_TARGETS) {
    if (take <= 0) continue;
    const pool = await sql`
      SELECT m.id, m.name
      FROM mods m
      LEFT JOIN drone_mods dm ON dm.mod_id = m.id
      WHERE m.rarity = ${rarity}
        AND dm.id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM marketplace_listings l
          WHERE l.mod_id = m.id AND l.status = 'active'
        )
      ORDER BY m.id ASC
      LIMIT ${take}
    `;
    if (pool.length === 0) {
      console.log(`  ${rarity}: no unbound mods available`);
      continue;
    }
    for (const mod of pool) {
      const [lo, hi] = MOD_PRICE_BANDS[rarity];
      const price = Math.round(randInt(lo, hi) / 50) * 50;
      const sellerKey = sellerCycle[cycleIdx % sellerCycle.length];
      cycleIdx += 1;
      const sellerId = sellers[sellerKey];
      await sql`UPDATE mods SET user_id = ${sellerId} WHERE id = ${mod.id}`;
      await sql`
        INSERT INTO marketplace_listings (seller_id, item_type, mod_id, price, status)
        VALUES (${sellerId}, 'mod', ${mod.id}, ${price}, 'active')
      `;
      console.log(
        `  list  ${rarity.padEnd(7)}  ${mod.name.padEnd(28)}  ${price.toLocaleString().padStart(7)}V  by ${sellerKey}`,
      );
      placed += 1;
    }
  }

  console.log(`mod listings placed: ${placed}`);
}

/* -------------------------------------------------------------------------- */
/* Active racing bots (matchmaking pool)                                      */
/* -------------------------------------------------------------------------- */

async function topUpRacingBots() {
  console.log(`\n--- active racing bots (matchmaking pool) ---`);
  let totalCreated = 0;
  for (const tier of TIER_BRACKETS) {
    const [{ active }] = await sql`
      SELECT COUNT(*)::int AS active FROM drones
      WHERE is_bot = true
        AND active = true
        AND level >= ${tier.levelMin}
        AND level <= ${tier.levelMax}
        AND NOT EXISTS (
          SELECT 1 FROM marketplace_listings l
          WHERE l.drone_id = drones.id AND l.status = 'active'
        )
    `;
    const need = Math.max(0, MIN_BOTS_PER_BRACKET - active);
    if (need === 0) {
      console.log(
        `  tier ${tier.tier} (LV ${tier.levelMin}-${tier.levelMax}): active=${active} >= ${MIN_BOTS_PER_BRACKET}; ok`,
      );
      continue;
    }
    for (let i = 0; i < need; i += 1) {
      const level = randInt(tier.levelMin, tier.levelMax);
      const { stats, tsb } = randomBotStats(level);
      const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
      await sql`
        INSERT INTO drones (
          name, level, xp, xp_to_next_level,
          total_stat_budget,
          speed, turning, acceleration, durability,
          night_vision, battery_capacity, rain_handling,
          wind_resistance, consistency,
          active, elo_rating, is_bot, image_url
        )
        VALUES (
          ${`AUTOBOT-${suffix}`}, ${level}, 0, ${200 * level * level},
          ${tsb},
          ${stats.speed}, ${stats.turning}, ${stats.acceleration}, ${stats.durability},
          ${stats.night_vision}, ${stats.battery_capacity}, ${stats.rain_handling},
          ${stats.wind_resistance}, ${stats.consistency},
          true, 1000, true, '/drones/default.png'
        )
      `;
      totalCreated += 1;
    }
    console.log(
      `  tier ${tier.tier} (LV ${tier.levelMin}-${tier.levelMax}): active=${active} -> ${active + need} (created ${need})`,
    );
  }
  console.log(`racing bots created: ${totalCreated}`);
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

async function main() {
  const sellers = await resolveSellers();
  console.log('sellers:');
  for (const k of Object.keys(sellers)) console.log(`  ${k} -> ${sellers[k]}`);

  await topUpDroneListings(sellers);
  await topUpSkinListings(sellers);
  await topUpModListings(sellers);
  await topUpRacingBots();

  // Final tally
  const [counts] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE item_type = 'drone' AND status = 'active')::int AS drones,
      COUNT(*) FILTER (WHERE item_type = 'skin'  AND status = 'active')::int AS skins,
      COUNT(*) FILTER (WHERE item_type = 'mod'   AND status = 'active')::int AS mods,
      COUNT(*) FILTER (WHERE status = 'active')::int AS total
    FROM marketplace_listings
  `;
  console.log(
    `\nfinal active listings: drones=${counts.drones} skins=${counts.skins} mods=${counts.mods} total=${counts.total}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
