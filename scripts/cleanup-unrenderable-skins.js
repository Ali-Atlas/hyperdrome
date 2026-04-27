#!/usr/bin/env node
/**
 * Unequip skins whose applied-on-drone render doesn't exist for the
 * drone's current tier. The skins stay BOUND to the drone (the
 * drone_skins row is preserved) so the collection is intact - only the
 * is_equipped flag is flipped to false and drones.applied_skin_id is
 * cleared.
 *
 * Rule: a skin is equippable on a drone iff
 *   - skin.rarity === 'legendary' (legendary art IS the drone), OR
 *   - the skin slug + drone tier appears in APPLIED_RENDERS below.
 *
 * Keep this manifest in sync with `lib/utils.js`. The script is
 * one-off, so duplicating the manifest here is fine.
 *
 * Run from the repo root:  node scripts/cleanup-unrenderable-skins.js
 *
 * Idempotent.
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

const APPLIED_RENDERS = {
  ember: [1],
  chrome_fury: [4],
  crystal_phantom: [4],
  dragon_scale: [4],
  obsidian_core: [4],
};

function getDroneTier(level) {
  const lvl = Number(level) || 1;
  if (lvl <= 5) return 1;
  if (lvl <= 10) return 2;
  if (lvl <= 15) return 3;
  return 4;
}

function canEquip(skin, level) {
  if (!skin) return false;
  if (skin.rarity === 'legendary') return true;
  const url = skin.image_url;
  if (!url || !url.startsWith('/skins/')) return false;
  const parts = url.split('/');
  if (parts.length < 4) return false;
  const slug = parts[3].replace(/\.webp$/, '');
  const tiers = APPLIED_RENDERS[slug];
  if (!tiers) return false;
  return tiers.includes(getDroneTier(level));
}

async function main() {
  const equipped = await sql`
    SELECT
      d.id AS drone_id,
      d.name AS drone_name,
      d.level,
      s.id AS skin_id,
      s.name AS skin_name,
      s.rarity,
      s.image_url
    FROM drones d
    INNER JOIN skins s ON s.id = d.applied_skin_id
    WHERE d.applied_skin_id IS NOT NULL
  `;
  console.log(`drones with an equipped skin: ${equipped.length}`);

  let unequipped = 0;
  for (const row of equipped) {
    const skin = { rarity: row.rarity, image_url: row.image_url };
    if (canEquip(skin, row.level)) {
      console.log(
        `  KEEP   ${row.drone_name} (Lv ${row.level}) -> ${row.skin_name} [${row.rarity}]`,
      );
      continue;
    }
    console.log(
      `  UNEQUIP ${row.drone_name} (Lv ${row.level}) -> ${row.skin_name} [${row.rarity}] - no render available`,
    );

    await sql`
      UPDATE drone_skins
      SET is_equipped = false
      WHERE drone_id = ${row.drone_id} AND skin_id = ${row.skin_id}
    `;
    await sql`
      UPDATE drones
      SET applied_skin_id = NULL
      WHERE id = ${row.drone_id}
    `;
    unequipped += 1;
  }

  console.log(`\nunequipped=${unequipped} kept=${equipped.length - unequipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
