#!/usr/bin/env node
/**
 * Seed 1 legendary-skinned drone (~180,000V) and 2 epic-skinned drones
 * (~40,000V each) to the marketplace, owned by the MKT_PULSE / MKT_NEXUS /
 * MKT_ORBIT bot sellers.
 *
 * The new marketplace sort (image-backed → rarity DESC → price DESC) lifts
 * legendary-skinned drones to the very top of the board and epic-skinned
 * drones right behind them, giving the listing grid an obvious "showpiece"
 * row when a fresh user lands on /marketplace.
 *
 * Idempotent: counts the MKT_-owned active drone listings whose drone has
 * a legendary / epic appliedSkin and only inserts the difference up to
 * targets (1 legendary, 2 epic). Re-runs are no-ops once targets are met.
 *
 * Source vault: image-backed legendary / epic skins (`image_url LIKE '/skins/%'
 * AND image_url LIKE '%.webp' AND user_id IS NULL`). The vault row stays in
 * place; we clone it as a new row owned by the bot before applying.
 *
 * DB target: PROD_DATABASE_URL if present in .env.local, else DATABASE_URL.
 * The chosen URL is announced before any write so a misconfiguration is
 * obvious in the run log.
 *
 * Run from repo root: node scripts/seed-marketplace-featured-drones.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Hand-rolled .env.local loader (mirrors seed-marketplace-fill.js).
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
console.log(`[featured-drones] target = ${targetLabel}`);

const sql = neon(databaseUrl);

const SELLER_NAMES = ['MKT_PULSE', 'MKT_NEXUS', 'MKT_ORBIT'];

const TARGETS = [
  { rarity: 'legendary', price: 180_000, count: 1, levelMin: 16, levelMax: 20 },
  { rarity: 'epic',      price:  40_000, count: 2, levelMin: 11, levelMax: 20 },
];

async function resolveSellers() {
  const rows = await sql`
    SELECT id, username FROM users
    WHERE username = ANY(${SELLER_NAMES})
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

/**
 * Count MKT_-owned active drone listings whose drone has an appliedSkin
 * of the given rarity. Image-backed only so re-runs against a half-filled
 * pool don't double-count placeholder-skinned showpieces.
 */
async function countExisting(sellerIds, rarity) {
  const [{ n }] = await sql`
    SELECT COUNT(*)::int AS n
    FROM marketplace_listings l
    JOIN drones d ON d.id = l.drone_id
    JOIN skins  s ON s.id = d.applied_skin_id
    WHERE l.status = 'active'
      AND l.item_type = 'drone'
      AND l.seller_id = ANY(${sellerIds})
      AND s.rarity = ${rarity}
      AND s.image_url LIKE '/skins/%'
      AND s.image_url LIKE '%.webp'
  `;
  return n;
}

/**
 * Pick `n` distinct image-backed vault skins of the given rarity. Distinct
 * by name so we don't equip the same skin design on every featured drone.
 */
async function pickVaultSkins(rarity, n) {
  const rows = await sql`
    SELECT * FROM skins
    WHERE rarity = ${rarity}
      AND user_id IS NULL
      AND image_url LIKE '/skins/%'
      AND image_url LIKE '%.webp'
    ORDER BY random()
  `;
  const seen = new Set();
  const out = [];
  for (const s of rows) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    out.push(s);
    if (out.length === n) break;
  }
  return out;
}

/**
 * Pick `n` MKT_-owned drones with NO applied skin in the requested level
 * band. Existing active listings are fine — we'll bump their price to
 * the showpiece tier in attachSkinAndList. Prefer higher-ELO drones so
 * the showpiece slots feel earned.
 */
async function pickEligibleDrones(sellerIds, levelMin, levelMax, n) {
  return sql`
    SELECT d.id, d.user_id, d.name, d.level
    FROM drones d
    WHERE d.user_id = ANY(${sellerIds})
      AND d.level >= ${levelMin}
      AND d.level <= ${levelMax}
      AND d.applied_skin_id IS NULL
    ORDER BY d.elo_rating DESC, d.id ASC
    LIMIT ${n}
  `;
}

async function cloneSkinForUser(template, userId) {
  const [row] = await sql`
    INSERT INTO skins (user_id, name, rarity, image_url, description)
    VALUES (
      ${userId},
      ${template.name},
      ${template.rarity},
      ${template.image_url},
      ${template.description}
    )
    RETURNING *
  `;
  return row;
}

async function attachSkinAndList({ drone, skin, sellerId, price }) {
  await sql`
    UPDATE drones SET applied_skin_id = ${skin.id} WHERE id = ${drone.id}
  `;
  await sql`
    INSERT INTO drone_skins (drone_id, skin_id, is_equipped)
    VALUES (${drone.id}, ${skin.id}, true)
    ON CONFLICT (drone_id, skin_id) DO UPDATE SET is_equipped = true
  `;
  // Drone may already be on the board from seed-marketplace-fill.js. If
  // so, bump the price to the showpiece tier and keep the original
  // sellerId. Otherwise create a fresh listing under the drone's owner.
  const existing = await sql`
    SELECT id FROM marketplace_listings
    WHERE drone_id = ${drone.id} AND status = 'active'
    LIMIT 1
  `;
  if (existing.length > 0) {
    await sql`
      UPDATE marketplace_listings
      SET price = ${price}
      WHERE id = ${existing[0].id}
    `;
  } else {
    await sql`
      INSERT INTO marketplace_listings (seller_id, item_type, drone_id, price, status)
      VALUES (${sellerId}, 'drone', ${drone.id}, ${price}, 'active')
    `;
  }
}

async function seedRarity({ rarity, price, count, levelMin, levelMax }, sellers) {
  const sellerIds = Object.values(sellers);
  const existing = await countExisting(sellerIds, rarity);
  const need = Math.max(0, count - existing);
  console.log(
    `[${rarity}] existing=${existing} target=${count} need=${need}`,
  );
  if (need === 0) return;

  const [skinTemplates, drones] = await Promise.all([
    pickVaultSkins(rarity, need),
    pickEligibleDrones(sellerIds, levelMin, levelMax, need),
  ]);
  if (skinTemplates.length === 0) {
    console.log(`  no ${rarity} vault skins available, skipping`);
    return;
  }
  if (drones.length === 0) {
    console.log(`  no eligible MKT_ drones in LV ${levelMin}-${levelMax}, skipping`);
    return;
  }

  const sellerCycle = SELLER_NAMES.map((k) => sellers[k]);
  const placed = Math.min(need, skinTemplates.length, drones.length);
  for (let i = 0; i < placed; i += 1) {
    const drone = drones[i];
    const template = skinTemplates[i];
    const sellerId = drone.user_id;
    const cloned = await cloneSkinForUser(template, sellerId);
    await attachSkinAndList({ drone, skin: cloned, sellerId, price });
    console.log(
      `  + listed ${drone.name} (LV${drone.level}) with ${cloned.name} ` +
        `at ${price.toLocaleString()}V`,
    );
    // Cycle marker to silence unused-var lint without changing behavior;
    // sellerCycle stays available for future round-robin tweaks.
    void sellerCycle;
  }
}

async function main() {
  const sellers = await resolveSellers();
  for (const target of TARGETS) {
    await seedRarity(target, sellers);
  }
  console.log('[featured-drones] done');
}

main().catch((err) => {
  console.error('[featured-drones] failed:', err);
  process.exit(1);
});
