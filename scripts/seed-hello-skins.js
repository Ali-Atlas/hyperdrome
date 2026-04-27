#!/usr/bin/env node
/**
 * Bind one image-backed skin to each of HELLO's top-3 drones by ELO:
 *   #1 ELO -> legendary skin
 *   #2 ELO -> rare skin
 *   #3 ELO -> common skin
 *
 * Run from the repo root:  node scripts/seed-hello-skins.js
 *
 * Idempotent. For each drone, picks the first image-backed skin of the
 * target rarity that's not already in any drone_skins row, prefers the
 * unowned vault (userId IS NULL), falls back to HELLO-owned. Skips the
 * pair when (drone_id, skin_id) already exists.
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

const RARITY_BY_RANK = ['legendary', 'rare', 'common'];

async function main() {
  const [hello] = await sql`SELECT id FROM users WHERE username = 'HELLO'`;
  if (!hello) {
    console.error('HELLO user not found');
    process.exit(1);
  }
  console.log(`HELLO user id: ${hello.id}`);

  const drones = await sql`
    SELECT id, name, level, elo_rating, applied_skin_id
    FROM drones
    WHERE user_id = ${hello.id}
    ORDER BY elo_rating DESC
    LIMIT 3
  `;
  if (drones.length < 3) {
    console.warn(`HELLO has only ${drones.length} drones; will seed what's available`);
  }

  for (let i = 0; i < drones.length; i += 1) {
    const drone = drones[i];
    const rarity = RARITY_BY_RANK[i];
    console.log(
      `\n[#${i + 1}] ${drone.name} (Lv ${drone.level}, ELO ${drone.elo_rating}) -> ${rarity}`,
    );

    // Pick a candidate skin of the target rarity that isn't bound to
    // any drone yet. Prefer unowned (vault), then HELLO-owned, then any.
    const candidates = await sql`
      SELECT s.id, s.name, s.user_id
      FROM skins s
      LEFT JOIN drone_skins ds ON ds.skin_id = s.id
      WHERE s.rarity = ${rarity}
        AND s.image_url LIKE '/skins/%'
        AND s.image_url LIKE '%.webp'
        AND ds.id IS NULL
      ORDER BY
        CASE
          WHEN s.user_id IS NULL THEN 0
          WHEN s.user_id = ${hello.id} THEN 1
          ELSE 2
        END,
        s.created_at ASC
      LIMIT 1
    `;

    if (candidates.length === 0) {
      console.warn(`  no available ${rarity} skin found; skipping`);
      continue;
    }
    const skin = candidates[0];
    console.log(`  picked skin: ${skin.name} (${skin.id})`);

    // Idempotency check: if this exact pairing already exists, skip.
    const existing = await sql`
      SELECT id FROM drone_skins
      WHERE drone_id = ${drone.id} AND skin_id = ${skin.id}
      LIMIT 1
    `;
    if (existing.length > 0) {
      console.log('  pair already bound, skipping');
      continue;
    }

    // (a) re-home skin ownership to HELLO
    await sql`UPDATE skins SET user_id = ${hello.id} WHERE id = ${skin.id}`;

    // (b) insert junction row, equipped
    await sql`
      INSERT INTO drone_skins (drone_id, skin_id, is_equipped)
      VALUES (${drone.id}, ${skin.id}, true)
      ON CONFLICT (drone_id, skin_id) DO NOTHING
    `;

    // (c) mirror to the denormalised pointer
    await sql`UPDATE drones SET applied_skin_id = ${skin.id} WHERE id = ${drone.id}`;

    console.log('  bound + equipped');
  }

  console.log('\nfinal HELLO drone state:');
  const after = await sql`
    SELECT d.name, d.elo_rating, s.name AS skin_name, s.rarity
    FROM drones d
    LEFT JOIN skins s ON s.id = d.applied_skin_id
    WHERE d.user_id = ${hello.id}
    ORDER BY d.elo_rating DESC
  `;
  for (const row of after) {
    console.log(
      `  ${row.name} (ELO ${row.elo_rating}) -> ${row.skin_name ?? '(no skin)'}${row.rarity ? ` [${row.rarity}]` : ''}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
