#!/usr/bin/env node
/**
 * One-shot: replace the legacy 3-drone FEATURED_* marketplace block
 * (FEATURED_VOLT_ORACLE / FEATURED_APEX_HUNTER / FEATURED_TIDAL_REIGN,
 * which used Diamond Hands / Apex Predator / Kraken legendaries) with
 * the new mix:
 *
 *   - 1 tier-4 drone with the Valiant legendary skin, priced 175k V
 *   - 2 tier-4 drones with epic skins that have applied tier-4 renders
 *     in lib/utils.js#APPLIED_RENDERS (Dragon Scale, Crystal Phantom),
 *     priced 18-22k V — only one legendary on the board at a time, the
 *     epics fill out the cosmetic-listing slot.
 *
 * All three use the standard `MARKET_<lvl>_<6char>` random name pattern
 * so they don't visually stand out from the rest of the marketplace
 * board — the bound skin is the only differentiator.
 *
 * Skin sourcing: pulls a vault row (user_id IS NULL) and transfers it
 * to the seller, mirroring the seed-production.js pattern. Deleted
 * FEATURED_* drones return their formerly-bound skins to the vault
 * (user_id back to NULL), so vault count stays consistent.
 *
 * Idempotent: re-running deletes the (already-absent) FEATURED_* set
 * as a no-op, then skips the insert phase if MKT_* sellers already
 * have enough active drone listings with applied skins.
 *
 * Run: node --env-file=.env.local scripts/fix-marketplace-featured.js
 *      (uses PROD_DATABASE_URL when set, else DATABASE_URL)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { randomDroneName } from '../lib/game-engine/drone-names.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Hand-rolled .env.local loader for users invoking the file directly
// without `node --env-file=`. No-op when env vars are already set.
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

const databaseUrl = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Neither PROD_DATABASE_URL nor DATABASE_URL is set.');
  process.exit(1);
}
const targetLabel = process.env.PROD_DATABASE_URL ? 'PROD' : 'DEV';
console.log(`[fix-featured] target = ${targetLabel}`);

const sql = neon(databaseUrl);

/* -------------------------------------------------------------------------- */
/* Plan                                                                       */
/* -------------------------------------------------------------------------- */

const SELLER_NAMES = ['MKT_PULSE', 'MKT_NEXUS', 'MKT_ORBIT'];

const LEGACY_FEATURED_NAMES = [
  'FEATURED_VOLT_ORACLE',
  'FEATURED_APEX_HUNTER',
  'FEATURED_TIDAL_REIGN',
];

/**
 * Mirror of DRONE_LISTINGS_WITH_SKINS in scripts/seed-production.js —
 * if you change one, change both. Prices come as `priceRange: [lo, hi]`
 * so each run picks a value uniformly from the band.
 *
 *   Valiant      LV19 legendary  T4 + legendary      550-650K
 *   Dragon Scale LV17 epic       T4 + epic premium   400-500K
 *   Crystal Phantom LV12 epic    T3 + epic premium   180-220K
 */
const NEW_LISTINGS = [
  // One legendary anchor at the top of the board.
  { level: 19, profile: 'speedster',  priceRange: [550_000, 650_000], skinName: 'Valiant',         skinRarity: 'legendary' },
  // Two epic-skinned drones — Dragon Scale at the top of T4, Crystal
  // Phantom mid-T3 so the showcase doesn't cluster everything in T4.
  { level: 17, profile: 'cornerer',   priceRange: [400_000, 500_000], skinName: 'Dragon Scale',    skinRarity: 'epic'      },
  { level: 12, profile: 'allrounder', priceRange: [180_000, 220_000], skinName: 'Crystal Phantom', skinRarity: 'epic'      },
];

// Inclusive on both ends. Standalone here because this script doesn't
// share helpers with seed-production.js; the math is small and the
// duplication is intentional (script is a one-shot fix).
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

/* -------------------------------------------------------------------------- */
/* Stat helpers (mirrored from scripts/seed-production.js)                    */
/* -------------------------------------------------------------------------- */

const STAT_KEYS = [
  'speed', 'turning', 'acceleration', 'durability',
  'nightVision', 'batteryCapacity', 'rainHandling', 'windResistance', 'consistency',
];

const PROFILES = {
  speedster:  [3, 1, 3, 1, 1, 1, 1, 3, 1],
  cornerer:   [1, 4, 1, 2, 1, 1, 1, 1, 2],
  allrounder: [2, 2, 2, 2, 1, 1, 1, 1, 2],
};

function buildStats(level, profile) {
  const tsb = 9 + 20 * level;
  const cap = Math.min(100, 10 + Math.floor(4.5 * level));
  const points = tsb - 9;
  const weights = PROFILES[profile] ?? PROFILES.allrounder;
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const stats = Object.fromEntries(STAT_KEYS.map((k) => [k, 1]));
  let assigned = 0;
  for (let i = 0; i < STAT_KEYS.length; i++) {
    const share = Math.floor((points * weights[i]) / totalWeight);
    stats[STAT_KEYS[i]] = Math.min(cap, 1 + share);
    assigned += stats[STAT_KEYS[i]] - 1;
  }
  let remaining = points - assigned;
  let guard = 0;
  while (remaining > 0 && guard < 100) {
    let placed = 0;
    for (let k = 0; k < STAT_KEYS.length && remaining > 0; k++) {
      if (stats[STAT_KEYS[k]] < cap) {
        stats[STAT_KEYS[k]] += 1;
        remaining -= 1;
        placed += 1;
      }
    }
    if (placed === 0) break;
    guard += 1;
  }
  return { stats, tsb };
}

/**
 * Raw-SQL variant of the drone-names helper. This script uses neon's
 * tag-template `sql` directly (not Drizzle), so the shared
 * `generateUniqueDroneName` helper - which expects a Drizzle db + table
 * schema - can't be reused as-is. Same retry pattern, same fallback.
 */
async function generateUniqueDroneNameSql() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = randomDroneName();
    const rows = await sql`SELECT id FROM drones WHERE name = ${candidate} LIMIT 1`;
    if (rows.length === 0) return candidate;
  }
  const base = randomDroneName();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${base}-${suffix}`;
}

/* -------------------------------------------------------------------------- */
/* Phase 1 — delete legacy FEATURED_* drones                                  */
/* -------------------------------------------------------------------------- */

async function deleteLegacyFeatured() {
  const targets = await sql`
    SELECT id, name, applied_skin_id
    FROM drones
    WHERE name = ANY(${LEGACY_FEATURED_NAMES})
  `;
  console.log(`\n[delete] FEATURED_* drones found: ${targets.length}`);
  if (targets.length === 0) return;

  const droneIds = targets.map((d) => d.id);
  const formerSkinIds = targets
    .map((d) => d.applied_skin_id)
    .filter(Boolean);

  // Order matters: drop FK-dependents first, then drones themselves.
  const listings = await sql`
    DELETE FROM marketplace_listings
    WHERE drone_id = ANY(${droneIds})
    RETURNING id
  `;
  console.log(`[delete]   listings:           ${listings.length}`);

  const skinBindings = await sql`
    DELETE FROM drone_skins
    WHERE drone_id = ANY(${droneIds})
    RETURNING id
  `;
  console.log(`[delete]   drone_skins rows:   ${skinBindings.length}`);

  const modBindings = await sql`
    DELETE FROM drone_mods
    WHERE drone_id = ANY(${droneIds})
    RETURNING id
  `;
  console.log(`[delete]   drone_mods rows:    ${modBindings.length}`);

  const ownership = await sql`
    DELETE FROM drone_ownership_history
    WHERE drone_id = ANY(${droneIds})
    RETURNING id
  `;
  console.log(`[delete]   ownership history:  ${ownership.length}`);

  // Race rows reference drones via FK; clear them so the drone delete
  // succeeds. (FEATURED_* drones never raced in practice — they were
  // marketplace-only — but the safety net is cheap.)
  const races = await sql`
    DELETE FROM races
    WHERE drone1_id = ANY(${droneIds}) OR drone2_id = ANY(${droneIds})
    RETURNING id
  `;
  console.log(`[delete]   race rows:          ${races.length}`);

  const deletedDrones = await sql`
    DELETE FROM drones
    WHERE id = ANY(${droneIds})
    RETURNING id
  `;
  console.log(`[delete]   drones:             ${deletedDrones.length}`);

  // Return the formerly-bound legendary skins to vault stock so vault
  // counts stay consistent and a future seed re-run finds them.
  if (formerSkinIds.length > 0) {
    const restored = await sql`
      UPDATE skins SET user_id = NULL
      WHERE id = ANY(${formerSkinIds})
      RETURNING id
    `;
    console.log(`[delete]   skins -> vault:     ${restored.length}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Phase 2 — insert new skinned drone listings                                */
/* -------------------------------------------------------------------------- */

async function getSellerIds() {
  const rows = await sql`
    SELECT id, username FROM users
    WHERE username = ANY(${SELLER_NAMES})
  `;
  if (rows.length !== SELLER_NAMES.length) {
    console.error(
      `Expected ${SELLER_NAMES.length} MKT_* users, found ${rows.length}.`,
    );
    process.exit(1);
  }
  return rows.map((r) => r.id);
}

/**
 * Idempotency anchor: count MKT_-owned active drone listings whose drone
 * has any applied skin. If the count already meets target, the script
 * has already run — skip Phase 2.
 */
async function alreadySeeded(sellerIds) {
  const [{ n }] = await sql`
    SELECT COUNT(*)::int AS n
    FROM marketplace_listings l
    JOIN drones d ON d.id = l.drone_id
    WHERE l.status = 'active'
      AND l.seller_id = ANY(${sellerIds})
      AND d.applied_skin_id IS NOT NULL
  `;
  return n >= NEW_LISTINGS.length;
}

async function pickVaultSkin(name) {
  const [row] = await sql`
    SELECT * FROM skins
    WHERE name = ${name} AND user_id IS NULL
    ORDER BY random()
    LIMIT 1
  `;
  return row ?? null;
}

async function insertSkinnedListing({ def, sellerId }) {
  const skin = await pickVaultSkin(def.skinName);
  if (!skin) {
    console.log(`  ! ${def.skinName} not in vault, skipping`);
    return false;
  }

  // Transfer the vault skin to the seller.
  await sql`UPDATE skins SET user_id = ${sellerId} WHERE id = ${skin.id}`;

  const { stats, tsb } = buildStats(def.level, def.profile);
  const name = await generateUniqueDroneNameSql();

  const [drone] = await sql`
    INSERT INTO drones (
      user_id, name, level, xp, xp_to_next_level, total_stat_budget,
      speed, turning, acceleration, durability,
      night_vision, battery_capacity, rain_handling, wind_resistance, consistency,
      active, is_bot, elo_rating, image_url
    ) VALUES (
      ${sellerId}, ${name}, ${def.level}, 0, ${300 * def.level * def.level}, ${tsb},
      ${stats.speed}, ${stats.turning}, ${stats.acceleration}, ${stats.durability},
      ${stats.nightVision}, ${stats.batteryCapacity}, ${stats.rainHandling}, ${stats.windResistance}, ${stats.consistency},
      false, false, 1000, '/drones/default.png'
    )
    RETURNING *
  `;

  await sql`
    INSERT INTO drone_skins (drone_id, skin_id, is_equipped)
    VALUES (${drone.id}, ${skin.id}, true)
  `;
  await sql`
    UPDATE drones SET applied_skin_id = ${skin.id} WHERE id = ${drone.id}
  `;
  const price = randInt(def.priceRange[0], def.priceRange[1]);
  await sql`
    INSERT INTO marketplace_listings (seller_id, item_type, drone_id, price, status)
    VALUES (${sellerId}, 'drone', ${drone.id}, ${price}, 'active')
  `;

  console.log(
    `  + ${name} (LV${def.level}, ${def.skinRarity} ${def.skinName}) @ ${price.toLocaleString()}V`,
  );
  return true;
}

async function seedNewListings(sellerIds) {
  console.log('\n[insert] new skinned drone listings');
  let inserted = 0;
  for (let i = 0; i < NEW_LISTINGS.length; i++) {
    const def = NEW_LISTINGS[i];
    const sellerId = sellerIds[i % sellerIds.length];
    if (await insertSkinnedListing({ def, sellerId })) inserted += 1;
  }
  console.log(`[insert] created ${inserted} drone listings`);
}

/* -------------------------------------------------------------------------- */

async function main() {
  await deleteLegacyFeatured();
  const sellerIds = await getSellerIds();
  if (await alreadySeeded(sellerIds)) {
    console.log(
      '\n[insert] skipped — MKT_* sellers already have enough skinned drone listings',
    );
  } else {
    await seedNewListings(sellerIds);
  }
  console.log('\n[fix-featured] done');
}

main().catch((err) => {
  console.error('\n[fix-featured] failed:', err);
  process.exit(1);
});
