#!/usr/bin/env node
/**
 * For every image-backed legendary skin that is NOT currently equipped
 * (appliedSkinId) on any drone AND is not "Valiant", create a brand-new
 * HELLO drone (HELLO_LEG_<N>) and equip the legendary on it. Existing
 * legendary assignments are NEVER modified — Apex Predator stays on
 * HELLO_SCOUT_2 as-is, and any drone_skins rows currently sitting at
 * is_equipped = false are left exactly as they are.
 *
 * Valiant is intentionally left fully unbound for the manual-bind QA
 * flow; it is hard-skipped by name regardless of state.
 *
 * New drone defaults:
 *   level = 10, xp = 0, xpToNextLevel = 200 * 10^2 = 20000
 *   totalStatBudget = 9 + 20*10 = 209
 *   eloRating = 1000, active = false, isBot = false
 *   stats: each random in [10, 30], capped at the LV10 per-stat cap (55),
 *          rescaled if total exceeds the LV10 TSB (209).
 *
 * Run from repo root:
 *   node scripts/equip-hello-legendaries-on-new-drones.js
 *
 * Idempotent. The gate for creation is "no drone has this skin as its
 * appliedSkinId". If a previous run partially completed (drone created,
 * but appliedSkinId not yet set), the script reuses the existing
 * HELLO_LEG_* drone tied to the skin via drone_skins instead of making
 * a duplicate.
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

const SKIP_BY_NAME = new Set(['Valiant']);

const STAT_COLUMNS = [
  'speed',
  'turning',
  'acceleration',
  'durability',
  'night_vision',
  'battery_capacity',
  'rain_handling',
  'wind_resistance',
  'consistency',
];

const LV10_PER_STAT_CAP = 55;
const LV10_TSB = 209;
const LV10_XP_TO_NEXT = 200 * 10 * 10;

function randomLv10Stats() {
  const stats = {};
  for (const col of STAT_COLUMNS) {
    stats[col] = 10 + Math.floor(Math.random() * 21); // 10..30
  }
  // Per-stat cap (no-op for 10..30, defensive in case bounds change).
  for (const col of STAT_COLUMNS) {
    if (stats[col] > LV10_PER_STAT_CAP) stats[col] = LV10_PER_STAT_CAP;
  }
  // Rescale if total stat budget overshoots.
  let sum = STAT_COLUMNS.reduce((a, k) => a + stats[k], 0);
  if (sum > LV10_TSB) {
    const scale = LV10_TSB / sum;
    for (const col of STAT_COLUMNS) {
      stats[col] = Math.max(1, Math.floor(stats[col] * scale));
    }
  }
  return stats;
}

async function main() {
  const [hello] = await sql`SELECT id FROM users WHERE username = 'HELLO'`;
  if (!hello) {
    console.error('HELLO user not found');
    process.exit(1);
  }
  console.log(`HELLO user id: ${hello.id}`);

  // ----- Snapshot current legendary state -----

  const equipped = await sql`
    SELECT s.id, s.name, d.id AS drone_id, d.name AS drone_name
    FROM skins s
    JOIN drones d ON d.applied_skin_id = s.id
    WHERE s.rarity = 'legendary'
      AND s.image_url LIKE '/skins/%'
      AND s.image_url LIKE '%.webp'
      AND d.user_id = ${hello.id}
    ORDER BY s.name ASC
  `;

  const boundNotEquipped = await sql`
    SELECT s.id, s.name, d.id AS drone_id, d.name AS drone_name
    FROM skins s
    JOIN drone_skins ds ON ds.skin_id = s.id
    JOIN drones d ON d.id = ds.drone_id
    WHERE s.rarity = 'legendary'
      AND s.image_url LIKE '/skins/%'
      AND s.image_url LIKE '%.webp'
      AND d.user_id = ${hello.id}
      AND (d.applied_skin_id IS NULL OR d.applied_skin_id <> s.id)
      AND NOT EXISTS (
        SELECT 1 FROM drones d2
        WHERE d2.applied_skin_id = s.id
          AND d2.user_id = ${hello.id}
      )
    ORDER BY s.name ASC
  `;

  const unbound = await sql`
    SELECT s.id, s.name
    FROM skins s
    LEFT JOIN drone_skins ds ON ds.skin_id = s.id
    WHERE s.rarity = 'legendary'
      AND s.image_url LIKE '/skins/%'
      AND s.image_url LIKE '%.webp'
      AND ds.id IS NULL
    ORDER BY s.name ASC
  `;

  console.log('\n--- before ---');
  console.log(`equipped (${equipped.length}):`);
  for (const r of equipped) console.log(`  ${r.name} -> ${r.drone_name}`);
  console.log(`bound but not equipped (${boundNotEquipped.length}):`);
  for (const r of boundNotEquipped) console.log(`  ${r.name} -> ${r.drone_name}`);
  console.log(`unbound (${unbound.length}):`);
  for (const r of unbound) console.log(`  ${r.name}`);

  // ----- Build candidate list -----
  // Candidates: every image-backed legendary that is NOT currently
  // appliedSkinId on any drone AND is not Valiant.
  const equippedSkinIds = new Set(equipped.map((r) => r.id));
  const allLegendaries = await sql`
    SELECT id, name
    FROM skins
    WHERE rarity = 'legendary'
      AND image_url LIKE '/skins/%'
      AND image_url LIKE '%.webp'
    ORDER BY created_at ASC, id ASC
  `;
  const candidates = allLegendaries.filter(
    (s) => !equippedSkinIds.has(s.id) && !SKIP_BY_NAME.has(s.name),
  );
  console.log(`\ncandidates needing a new HELLO_LEG drone (${candidates.length}):`);
  for (const c of candidates) console.log(`  ${c.name} (${c.id})`);

  // ----- Resolve next HELLO_LEG_<N> suffix -----
  const existingLegDrones = await sql`
    SELECT name FROM drones
    WHERE user_id = ${hello.id}
      AND name LIKE 'HELLO_LEG_%'
  `;
  let maxSuffix = 0;
  for (const r of existingLegDrones) {
    const m = r.name.match(/^HELLO_LEG_(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      if (n > maxSuffix) maxSuffix = n;
    }
  }
  let nextSuffix = maxSuffix + 1;

  // ----- Process each candidate -----
  let created = 0;
  let recovered = 0;

  for (const skin of candidates) {
    // Recovery path: was a HELLO_LEG_* drone for this skin already created
    // by a prior partial run (drone_skins row exists, but applied_skin_id
    // never got set)? If yes, finish the work on that drone instead of
    // creating a duplicate.
    const [existingPaired] = await sql`
      SELECT d.id, d.name, d.applied_skin_id
      FROM drones d
      JOIN drone_skins ds ON ds.drone_id = d.id
      WHERE d.user_id = ${hello.id}
        AND ds.skin_id = ${skin.id}
        AND d.name LIKE 'HELLO_LEG_%'
      LIMIT 1
    `;

    let droneId;
    let droneName;
    if (existingPaired) {
      droneId = existingPaired.id;
      droneName = existingPaired.name;
      console.log(
        `\n[recover] ${skin.name} -> reusing existing ${droneName} (${droneId})`,
      );
      recovered += 1;
    } else {
      const stats = randomLv10Stats();
      droneName = `HELLO_LEG_${nextSuffix}`;
      nextSuffix += 1;

      const [newDrone] = await sql`
        INSERT INTO drones (
          user_id, name, level, xp, xp_to_next_level,
          total_stat_budget,
          speed, turning, acceleration, durability,
          night_vision, battery_capacity, rain_handling,
          wind_resistance, consistency,
          active, elo_rating, is_bot
        )
        VALUES (
          ${hello.id}, ${droneName}, 10, 0, ${LV10_XP_TO_NEXT},
          ${LV10_TSB},
          ${stats.speed}, ${stats.turning}, ${stats.acceleration}, ${stats.durability},
          ${stats.night_vision}, ${stats.battery_capacity}, ${stats.rain_handling},
          ${stats.wind_resistance}, ${stats.consistency},
          false, 1000, false
        )
        RETURNING id
      `;
      droneId = newDrone.id;
      console.log(`\n[create] ${skin.name} -> new drone ${droneName} (${droneId})`);
      console.log(
        `  stats: ${STAT_COLUMNS.map((c) => `${c}=${stats[c]}`).join(' ')} (sum=${STAT_COLUMNS.reduce((a, c) => a + stats[c], 0)})`,
      );
      created += 1;
    }

    // Idempotent re-home + bind + equip.
    await sql`UPDATE skins SET user_id = ${hello.id} WHERE id = ${skin.id}`;
    await sql`
      INSERT INTO drone_skins (drone_id, skin_id, is_equipped)
      VALUES (${droneId}, ${skin.id}, true)
      ON CONFLICT (drone_id, skin_id) DO UPDATE SET is_equipped = true
    `;
    await sql`UPDATE drones SET applied_skin_id = ${skin.id} WHERE id = ${droneId}`;
    console.log(`  bound + equipped + ownership re-homed`);
  }

  // ----- Final report -----

  const equippedAfter = await sql`
    SELECT s.name AS skin_name, d.name AS drone_name, d.level AS drone_level
    FROM skins s
    JOIN drones d ON d.applied_skin_id = s.id
    WHERE s.rarity = 'legendary'
      AND s.image_url LIKE '/skins/%'
      AND s.image_url LIKE '%.webp'
      AND d.user_id = ${hello.id}
    ORDER BY s.name ASC
  `;
  const boundUnequippedAfter = await sql`
    SELECT s.name AS skin_name, d.name AS drone_name
    FROM skins s
    JOIN drone_skins ds ON ds.skin_id = s.id
    JOIN drones d ON d.id = ds.drone_id
    WHERE s.rarity = 'legendary'
      AND s.image_url LIKE '/skins/%'
      AND s.image_url LIKE '%.webp'
      AND d.user_id = ${hello.id}
      AND (d.applied_skin_id IS NULL OR d.applied_skin_id <> s.id)
    ORDER BY s.name ASC, d.name ASC
  `;
  const unboundAfter = await sql`
    SELECT s.name, s.user_id
    FROM skins s
    LEFT JOIN drone_skins ds ON ds.skin_id = s.id
    WHERE s.rarity = 'legendary'
      AND s.image_url LIKE '/skins/%'
      AND s.image_url LIKE '%.webp'
      AND ds.id IS NULL
    ORDER BY s.name ASC
  `;

  console.log(`\n--- after (created=${created}, recovered=${recovered}) ---`);
  console.log(`equipped (${equippedAfter.length}):`);
  for (const r of equippedAfter) {
    console.log(`  ${r.skin_name} -> ${r.drone_name} (Lv ${r.drone_level})`);
  }
  console.log(`bound but not equipped (${boundUnequippedAfter.length}):`);
  for (const r of boundUnequippedAfter) {
    console.log(`  ${r.skin_name} -> ${r.drone_name}`);
  }
  console.log(`unbound (${unboundAfter.length}):`);
  for (const r of unboundAfter) {
    console.log(
      `  ${r.name}${r.user_id ? ` [WARN: skins.user_id=${r.user_id}]` : ''}`,
    );
  }

  const valiantStillUnbound = unboundAfter.some((r) => r.name === 'Valiant');
  console.log(
    `\nValiant unbound check: ${valiantStillUnbound ? 'OK — Valiant is fully unbound' : 'WARN — Valiant is no longer unbound'}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
