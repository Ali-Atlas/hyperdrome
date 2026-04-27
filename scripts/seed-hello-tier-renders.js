#!/usr/bin/env node
/**
 * Bind named skins (those with applied-tier renders available) to
 * HELLO's drones at the matching tier. Each skin must land on a
 * SEPARATE drone of the right tier:
 *
 *   Ember           -> tier 1 (LV 1-5)
 *   Chrome Fury     -> tier 4 (LV 16-20)
 *   Crystal Phantom -> tier 4
 *   Dragon Scale    -> tier 4
 *   Obsidian Core   -> tier 4
 *
 * Run from the repo root:  node scripts/seed-hello-tier-renders.js
 *
 * Idempotent. Skips a skin if it already has a drone_skins row on any
 * HELLO drone. Skips and reports if no eligible drone is available.
 * Picks the first HELLO drone at the target tier that has no equipped
 * skin AND hasn't been claimed by an earlier binding in this run.
 *
 * Does NOT touch the existing Apex Predator binding on HELLO_SCOUT_2.
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

const ASSIGNMENTS = [
  { skinName: 'Ember', tier: 1 },
  { skinName: 'Chrome Fury', tier: 4 },
  { skinName: 'Crystal Phantom', tier: 4 },
  { skinName: 'Dragon Scale', tier: 4 },
  { skinName: 'Obsidian Core', tier: 4 },
];

function tierBracket(tier) {
  if (tier === 1) return [1, 5];
  if (tier === 2) return [6, 10];
  if (tier === 3) return [11, 15];
  return [16, 20];
}

async function main() {
  const [hello] = await sql`SELECT id FROM users WHERE username = 'HELLO'`;
  if (!hello) {
    console.error('HELLO user not found');
    process.exit(1);
  }
  console.log(`HELLO user id: ${hello.id}\n`);

  // Track which drones we've claimed in this run so two skins can't
  // land on the same drone.
  const claimedDroneIds = new Set();

  for (const { skinName, tier } of ASSIGNMENTS) {
    const [lo, hi] = tierBracket(tier);
    console.log(`[${skinName}] target tier ${tier} (LV ${lo}-${hi})`);

    const [skin] = await sql`
      SELECT id, name, rarity, image_url FROM skins WHERE name = ${skinName} LIMIT 1
    `;
    if (!skin) {
      console.warn(`  skin "${skinName}" not found in DB, skipping`);
      continue;
    }

    // Idempotency: if this skin is already on any HELLO drone, skip.
    const existing = await sql`
      SELECT d.id, d.name FROM drone_skins ds
      JOIN drones d ON d.id = ds.drone_id
      WHERE ds.skin_id = ${skin.id} AND d.user_id = ${hello.id}
      LIMIT 1
    `;
    if (existing.length > 0) {
      console.log(`  already bound on HELLO drone ${existing[0].name}, skipping`);
      claimedDroneIds.add(existing[0].id);
      continue;
    }

    // Find an eligible HELLO drone: in the target bracket, no equipped
    // skin, not yet claimed in this run.
    const candidates = await sql`
      SELECT id, name, level FROM drones
      WHERE user_id = ${hello.id}
        AND level >= ${lo}
        AND level <= ${hi}
        AND applied_skin_id IS NULL
      ORDER BY level ASC, name ASC
    `;
    const drone = candidates.find((d) => !claimedDroneIds.has(d.id));
    if (!drone) {
      console.warn(`  no eligible HELLO drone at tier ${tier}, skipping`);
      continue;
    }
    console.log(`  picked drone: ${drone.name} (Lv ${drone.level})`);

    await sql`UPDATE skins SET user_id = ${hello.id} WHERE id = ${skin.id}`;
    await sql`
      INSERT INTO drone_skins (drone_id, skin_id, is_equipped)
      VALUES (${drone.id}, ${skin.id}, true)
      ON CONFLICT (drone_id, skin_id) DO NOTHING
    `;
    await sql`UPDATE drones SET applied_skin_id = ${skin.id} WHERE id = ${drone.id}`;
    claimedDroneIds.add(drone.id);
    console.log('  bound + equipped\n');
  }

  console.log('final HELLO drone state:');
  const after = await sql`
    SELECT d.name, d.level, s.name AS skin_name, s.rarity
    FROM drones d
    LEFT JOIN skins s ON s.id = d.applied_skin_id
    WHERE d.user_id = ${hello.id}
    ORDER BY d.level ASC
  `;
  for (const row of after) {
    console.log(
      `  Lv ${String(row.level).padStart(2)} ${row.name.padEnd(18)} -> ${row.skin_name ?? '(no skin)'}${row.rarity ? ` [${row.rarity}]` : ''}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
