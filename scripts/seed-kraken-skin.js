#!/usr/bin/env node
/**
 * Seed the Kraken legendary skin row if it doesn't already exist.
 *   name        Kraken
 *   rarity      legendary
 *   image_url   /skins/legendary/kraken.webp
 *   user_id     NULL   (unowned, vault — pickable by packs / drops)
 *   description NULL
 *
 * Run from the repo root:  node scripts/seed-kraken-skin.js
 *
 * Idempotent. Skips insert when a `(name='Kraken' AND rarity='legendary')`
 * row already exists. Never modifies an existing Kraken row.
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

async function main() {
  const existing = await sql`
    SELECT id, name, rarity, image_url, user_id
    FROM skins
    WHERE name = 'Kraken' AND rarity = 'legendary'
    LIMIT 1
  `;

  if (existing.length > 0) {
    const k = existing[0];
    console.log(`Kraken legendary already exists; skipping insert.`);
    console.log(`  id=${k.id}  image_url=${k.image_url}  user_id=${k.user_id ?? 'NULL'}`);
    return;
  }

  const [inserted] = await sql`
    INSERT INTO skins (name, rarity, image_url, user_id, description)
    VALUES ('Kraken', 'legendary', '/skins/legendary/kraken.webp', NULL, NULL)
    RETURNING id, name, rarity, image_url, user_id
  `;
  console.log(`Inserted Kraken legendary:`);
  console.log(
    `  id=${inserted.id}  image_url=${inserted.image_url}  user_id=${inserted.user_id ?? 'NULL'}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
