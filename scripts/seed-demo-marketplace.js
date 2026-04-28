#!/usr/bin/env node
/**
 * Demo marketplace reseed. Wipes ALL marketplace_listings rows (clean
 * slate per Captain) and re-creates a curated set of bot-seller listings
 * at fixed prices for the demo.
 *
 *   Skin listings (legendary 2 + epic 2 + rare 3 + common 3)
 *     Celestial   135,000V  by MKT_PULSE
 *     Valiant     142,000V  by MKT_ORBIT
 *     epic 1      18,000V
 *     epic 2      22,000V
 *     rare 1       4,000V
 *     rare 2       5,500V
 *     rare 3       7,000V
 *     common 1       800V
 *     common 2     1,000V
 *     common 3     1,200V
 *
 *   Mod listings (legendary 1 + epic 2 + rare 3 + common 3)
 *     legendary  65,000V
 *     epic 1     10,000V
 *     epic 2     13,000V
 *     rare 1      2,000V
 *     rare 2      3,000V
 *     rare 3      3,500V
 *     common 1      300V
 *     common 2      500V
 *     common 3      600V
 *
 *   Drone listings (2 each per tier; bot-owned, no skin equipped)
 *     Tier 4 (level 16-20): 25,000V, 28,000V
 *     Tier 3 (level 11-15): 12,000V, 16,000V
 *     Tier 2 (level 6-10):   5,000V,  7,000V
 *     Tier 1 (level 1-5):    1,500V,  2,000V
 *
 * Run from the repo root:  node scripts/seed-demo-marketplace.js
 *
 * Idempotent. Re-runs always produce the same end state because the
 * script wipes existing listings up-front. Celestial / Valiant
 * ownership is forced to the chosen bot; their drone_skins rows are
 * cleared and applied_skin_id is unset wherever they were equipped.
 * Other skin/mod selections come from the unbound pool, ordered by
 * (rarity, name, id) so re-runs pick the same items where possible.
 *
 * For skins/mods being listed: the script sets `user_id` to the chosen
 * bot seller before inserting the listing (the marketplace API expects
 * the seller to own the item). For drones it lists drones already owned
 * by bots — never moves drone ownership.
 *
 * Does NOT touch the legacy 71 placeholder skin rows (filters by
 * image_url LIKE '/skins/%' AND '%.webp').
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

/* -------------------------------------------------------------------------- */
/* Listing specs                                                              */
/* -------------------------------------------------------------------------- */

// Skin listings beyond the two named legendaries.
const SKIN_LISTING_SPEC = [
  { rarity: 'epic',   price: 18_000, sellerKey: 'MKT_NEXUS' },
  { rarity: 'epic',   price: 22_000, sellerKey: 'MKT_PULSE' },
  { rarity: 'rare',   price:  4_000, sellerKey: 'MKT_ORBIT' },
  { rarity: 'rare',   price:  5_500, sellerKey: 'MKT_NEXUS' },
  { rarity: 'rare',   price:  7_000, sellerKey: 'MKT_PULSE' },
  { rarity: 'common', price:    800, sellerKey: 'MKT_PULSE' },
  { rarity: 'common', price:  1_000, sellerKey: 'MKT_NEXUS' },
  { rarity: 'common', price:  1_200, sellerKey: 'MKT_ORBIT' },
];

const MOD_LISTING_SPEC = [
  { rarity: 'legendary', price: 65_000, sellerKey: 'MKT_NEXUS' },
  { rarity: 'epic',      price: 10_000, sellerKey: 'MKT_PULSE' },
  { rarity: 'epic',      price: 13_000, sellerKey: 'MKT_ORBIT' },
  { rarity: 'rare',      price:  2_000, sellerKey: 'MKT_NEXUS' },
  { rarity: 'rare',      price:  3_000, sellerKey: 'MKT_PULSE' },
  { rarity: 'rare',      price:  3_500, sellerKey: 'MKT_ORBIT' },
  { rarity: 'common',    price:    300, sellerKey: 'MKT_PULSE' },
  { rarity: 'common',    price:    500, sellerKey: 'MKT_NEXUS' },
  { rarity: 'common',    price:    600, sellerKey: 'MKT_ORBIT' },
];

// Tier ranges per lib/utils.js#getLevelTier.
const DRONE_LISTING_SPEC = [
  { tier: 4, levelMin: 16, levelMax: 20, prices: [25_000, 28_000] },
  { tier: 3, levelMin: 11, levelMax: 15, prices: [12_000, 16_000] },
  { tier: 2, levelMin:  6, levelMax: 10, prices: [ 5_000,  7_000] },
  { tier: 1, levelMin:  1, levelMax:  5, prices: [ 1_500,  2_000] },
];

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

async function main() {
  // ---------- Resolve bot sellers ----------
  const sellerRows = await sql`
    SELECT id, username FROM users
    WHERE username IN ('MKT_PULSE', 'MKT_NEXUS', 'MKT_ORBIT')
  `;
  const sellers = Object.fromEntries(sellerRows.map((s) => [s.username, s.id]));
  for (const key of ['MKT_PULSE', 'MKT_NEXUS', 'MKT_ORBIT']) {
    if (!sellers[key]) {
      console.error(`Seller ${key} not found in users — bail.`);
      process.exit(1);
    }
  }
  console.log('sellers:');
  for (const k of Object.keys(sellers)) console.log(`  ${k} -> ${sellers[k]}`);

  // ---------- Wipe all existing listings ----------
  const wiped = await sql`DELETE FROM marketplace_listings RETURNING id`;
  console.log(`\nwiped ${wiped.length} existing marketplace_listings row(s)`);

  /* -------------------------------------------------------------------- */
  /* Skin listings                                                        */
  /* -------------------------------------------------------------------- */

  console.log('\n--- skin listings ---');

  // Force Celestial + Valiant into the unbound, bot-owned state.
  for (const named of [
    { skinName: 'Celestial', sellerKey: 'MKT_PULSE', price: 135_000 },
    { skinName: 'Valiant',   sellerKey: 'MKT_ORBIT', price: 142_000 },
  ]) {
    const [skin] = await sql`
      SELECT id, name, rarity FROM skins
      WHERE name = ${named.skinName}
        AND rarity = 'legendary'
        AND image_url LIKE '/skins/%'
        AND image_url LIKE '%.webp'
      LIMIT 1
    `;
    if (!skin) {
      console.error(`  ${named.skinName} skin not found — bail.`);
      process.exit(1);
    }
    // Drop any drone_skins junction rows so the skin is unbound.
    const releasedPairs = await sql`
      DELETE FROM drone_skins WHERE skin_id = ${skin.id} RETURNING drone_id
    `;
    // Clear applied_skin_id on any drone that had this as its equipped skin.
    const clearedApplied = await sql`
      UPDATE drones SET applied_skin_id = NULL
      WHERE applied_skin_id = ${skin.id}
      RETURNING id, name
    `;
    // Re-home ownership to the chosen bot.
    await sql`
      UPDATE skins SET user_id = ${sellers[named.sellerKey]} WHERE id = ${skin.id}
    `;
    // List it.
    const [listing] = await sql`
      INSERT INTO marketplace_listings (seller_id, item_type, skin_id, price, status)
      VALUES (${sellers[named.sellerKey]}, 'skin', ${skin.id}, ${named.price}, 'active')
      RETURNING id
    `;
    console.log(
      `  list  legendary  ${skin.name.padEnd(18)}  ${named.price.toLocaleString().padStart(9)}V  by ${named.sellerKey}` +
        (releasedPairs.length > 0 ? `  (released ${releasedPairs.length} bind)` : '') +
        (clearedApplied.length > 0 ? `  (unequipped from ${clearedApplied.map((d) => d.name).join(', ')})` : ''),
    );
  }

  // Pull the unbound, image-backed pool, ordered for stable selection.
  const unboundSkins = await sql`
    SELECT s.id, s.name, s.rarity
    FROM skins s
    LEFT JOIN drone_skins ds ON ds.skin_id = s.id
    WHERE s.image_url LIKE '/skins/%'
      AND s.image_url LIKE '%.webp'
      AND ds.id IS NULL
      AND s.name NOT IN ('Celestial', 'Valiant')
    ORDER BY s.rarity ASC, s.name ASC, s.id ASC
  `;
  // Group by rarity.
  const byRarity = { common: [], rare: [], epic: [], legendary: [] };
  for (const s of unboundSkins) {
    if (byRarity[s.rarity]) byRarity[s.rarity].push(s);
  }

  // Take spec[i] worth of each rarity, in deterministic order.
  const cursors = { common: 0, rare: 0, epic: 0, legendary: 0 };
  for (const spec of SKIN_LISTING_SPEC) {
    const pool = byRarity[spec.rarity] ?? [];
    const skin = pool[cursors[spec.rarity]];
    cursors[spec.rarity] += 1;
    if (!skin) {
      console.warn(
        `  WARN: not enough unbound ${spec.rarity} skins — wanted ${SKIN_LISTING_SPEC.filter((s) => s.rarity === spec.rarity).length}, have ${pool.length}; skipping ${spec.price.toLocaleString()}V slot`,
      );
      continue;
    }
    await sql`UPDATE skins SET user_id = ${sellers[spec.sellerKey]} WHERE id = ${skin.id}`;
    await sql`
      INSERT INTO marketplace_listings (seller_id, item_type, skin_id, price, status)
      VALUES (${sellers[spec.sellerKey]}, 'skin', ${skin.id}, ${spec.price}, 'active')
    `;
    console.log(
      `  list  ${spec.rarity.padEnd(9)}  ${skin.name.padEnd(18)}  ${spec.price.toLocaleString().padStart(9)}V  by ${spec.sellerKey}`,
    );
  }

  /* -------------------------------------------------------------------- */
  /* Mod listings                                                         */
  /* -------------------------------------------------------------------- */

  console.log('\n--- mod listings ---');

  const unboundMods = await sql`
    SELECT m.id, m.name, m.rarity
    FROM mods m
    LEFT JOIN drone_mods dm ON dm.mod_id = m.id
    WHERE dm.id IS NULL
    ORDER BY m.rarity ASC, m.name ASC, m.id ASC
  `;
  const modByRarity = { common: [], rare: [], epic: [], legendary: [] };
  for (const m of unboundMods) {
    if (modByRarity[m.rarity]) modByRarity[m.rarity].push(m);
  }

  const modCursors = { common: 0, rare: 0, epic: 0, legendary: 0 };
  for (const spec of MOD_LISTING_SPEC) {
    const pool = modByRarity[spec.rarity] ?? [];
    const mod = pool[modCursors[spec.rarity]];
    modCursors[spec.rarity] += 1;
    if (!mod) {
      console.warn(
        `  WARN: not enough unbound ${spec.rarity} mods — wanted ${MOD_LISTING_SPEC.filter((m) => m.rarity === spec.rarity).length}, have ${pool.length}; skipping ${spec.price.toLocaleString()}V slot`,
      );
      continue;
    }
    await sql`UPDATE mods SET user_id = ${sellers[spec.sellerKey]} WHERE id = ${mod.id}`;
    await sql`
      INSERT INTO marketplace_listings (seller_id, item_type, mod_id, price, status)
      VALUES (${sellers[spec.sellerKey]}, 'mod', ${mod.id}, ${spec.price}, 'active')
    `;
    console.log(
      `  list  ${spec.rarity.padEnd(9)}  ${mod.name.padEnd(28)}  ${spec.price.toLocaleString().padStart(9)}V  by ${spec.sellerKey}`,
    );
  }

  /* -------------------------------------------------------------------- */
  /* Drone listings                                                       */
  /* -------------------------------------------------------------------- */

  console.log('\n--- drone listings ---');

  const sellerIds = Object.values(sellers);
  for (const tier of DRONE_LISTING_SPEC) {
    // Bot-seller-owned, no skin equipped, in the tier's level range.
    const pool = await sql`
      SELECT d.id, d.name, d.level, d.elo_rating, d.user_id
      FROM drones d
      WHERE d.user_id = ANY(${sellerIds})
        AND d.applied_skin_id IS NULL
        AND d.level >= ${tier.levelMin}
        AND d.level <= ${tier.levelMax}
      ORDER BY d.elo_rating DESC, d.id ASC
    `;
    let placed = 0;
    for (let i = 0; i < tier.prices.length; i += 1) {
      const drone = pool[i];
      if (!drone) {
        console.warn(
          `  WARN: tier ${tier.tier}: only ${pool.length} bot-owned, no-skin drone(s) in level range ${tier.levelMin}-${tier.levelMax}; skipping ${tier.prices[i].toLocaleString()}V slot`,
        );
        continue;
      }
      const sellerKey =
        Object.keys(sellers).find((k) => sellers[k] === drone.user_id) ??
        '(unknown)';
      await sql`
        INSERT INTO marketplace_listings (seller_id, item_type, drone_id, price, status)
        VALUES (${drone.user_id}, 'drone', ${drone.id}, ${tier.prices[i]}, 'active')
      `;
      console.log(
        `  list  tier ${tier.tier}     ${drone.name.padEnd(28)}  Lv ${String(drone.level).padStart(2)}  ELO ${String(drone.elo_rating).padStart(4)}  ${tier.prices[i].toLocaleString().padStart(9)}V  by ${sellerKey}`,
      );
      placed += 1;
    }
    if (placed === 0) {
      console.warn(`  tier ${tier.tier}: no drones placed`);
    }
  }

  /* -------------------------------------------------------------------- */
  /* Final count                                                           */
  /* -------------------------------------------------------------------- */

  const [{ active }] = await sql`
    SELECT COUNT(*)::int AS active FROM marketplace_listings WHERE status = 'active'
  `;
  console.log(`\nfinal: ${active} active listing(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
