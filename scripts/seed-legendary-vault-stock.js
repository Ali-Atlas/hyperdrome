#!/usr/bin/env node
/**
 * Refill the unowned-vault stock of every legendary skin to 3 copies
 * each so the pack-open system has supply to draw from. For each of:
 *   Apex Predator, Celestial, Diamond Hand, Gilded Throne,
 *   Necromancer, Samurai, Valiant, Kraken
 * count current rows where `user_id IS NULL` and insert as many fresh
 * unowned rows as needed to reach 3. Each insert mirrors the canonical
 * row's `image_url` + `description` so the new rows pass the pack
 * open's image-backed filter (`image_url LIKE '/skins/%' AND '%.webp'`).
 *
 * Run from the repo root:  node scripts/seed-legendary-vault-stock.js
 *
 * Idempotent. Re-runs are no-ops once every legendary has >= 3 unowned
 * rows. Never modifies existing rows. Never affects ownership.
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

const LEGENDARY_NAMES = [
  'Apex Predator',
  'Celestial',
  'Diamond Hand',
  'Gilded Throne',
  'Necromancer',
  'Samurai',
  'Valiant',
  'Kraken',
];

const TARGET_UNOWNED = 3;

async function main() {
  console.log(
    `target: ${TARGET_UNOWNED} unowned image-backed copies per legendary\n`,
  );

  let totalInserted = 0;

  for (const name of LEGENDARY_NAMES) {
    // Pick a canonical row to source image_url + description from. Prefer
    // an image-backed row so the inserts pass pack filters.
    const [canonical] = await sql`
      SELECT id, image_url, description
      FROM skins
      WHERE name = ${name}
        AND rarity = 'legendary'
        AND image_url LIKE '/skins/%'
        AND image_url LIKE '%.webp'
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `;

    if (!canonical) {
      console.warn(
        `  ${name.padEnd(16)}  no canonical image-backed row found — skipping`,
      );
      continue;
    }

    const [{ unowned }] = await sql`
      SELECT COUNT(*)::int AS unowned
      FROM skins
      WHERE name = ${name}
        AND rarity = 'legendary'
        AND user_id IS NULL
        AND image_url LIKE '/skins/%'
        AND image_url LIKE '%.webp'
    `;

    const need = Math.max(0, TARGET_UNOWNED - unowned);
    if (need === 0) {
      console.log(
        `  ${name.padEnd(16)}  unowned=${unowned} >= ${TARGET_UNOWNED}; no inserts`,
      );
      continue;
    }

    for (let i = 0; i < need; i += 1) {
      await sql`
        INSERT INTO skins (name, rarity, image_url, user_id, description)
        VALUES (
          ${name},
          'legendary',
          ${canonical.image_url},
          NULL,
          ${canonical.description}
        )
      `;
    }
    totalInserted += need;
    console.log(
      `  ${name.padEnd(16)}  unowned=${unowned} -> ${unowned + need}  (inserted ${need}, image_url=${canonical.image_url})`,
    );
  }

  console.log(`\nTotal inserts: ${totalInserted}`);

  // Final tally for sanity.
  console.log('\n--- final unowned counts (image-backed legendaries) ---');
  const tally = await sql`
    SELECT name, COUNT(*)::int AS unowned
    FROM skins
    WHERE rarity = 'legendary'
      AND user_id IS NULL
      AND image_url LIKE '/skins/%'
      AND image_url LIKE '%.webp'
    GROUP BY name
    ORDER BY name ASC
  `;
  for (const row of tally) {
    console.log(`  ${row.name.padEnd(16)}  ${row.unowned}`);
  }
  const grandTotal = tally.reduce((a, r) => a + r.unowned, 0);
  console.log(`\nVault total: ${grandTotal} unowned image-backed legendary rows`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
