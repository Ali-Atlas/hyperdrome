#!/usr/bin/env node
/**
 * Insert image-backed skin rows for files in public/skins/{rarity}/.
 *
 * Run from the repo root:  node scripts/seed-skin-images.js
 *
 * Idempotent. For every swatch webp under public/skins/{rarity}/ (files
 * with no `_tierN` suffix), check if a row with that (name, rarity) pair
 * already exists. Skip if so; otherwise insert with userId NULL so the
 * skin lives in the unowned pool until awarded by a pack drop.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPath = path.join(__dirname, '..', '.env.local');
const envText = fs.readFileSync(envPath, 'utf8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const sql = neon(process.env.DATABASE_URL);

const RARITIES = ['common', 'rare', 'epic', 'legendary'];
const SKINS_ROOT = path.join(__dirname, '..', 'public', 'skins');

/**
 * Title-case a slug. `chrome_fury` -> `Chrome Fury`.
 * @param {string} slug
 * @returns {string}
 */
function toDisplayName(slug) {
  return slug
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

async function main() {
  const candidates = [];
  for (const rarity of RARITIES) {
    const dir = path.join(SKINS_ROOT, rarity);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.webp')) continue;
      const slug = file.slice(0, -'.webp'.length);
      // Skip applied tier renders. Only swatches become DB rows.
      if (/_tier\d+$/.test(slug)) continue;
      candidates.push({
        rarity,
        slug,
        name: toDisplayName(slug),
        imageUrl: `/skins/${rarity}/${file}`,
      });
    }
  }

  console.log(`scanned ${candidates.length} swatch files`);

  let inserted = 0;
  let skipped = 0;
  for (const c of candidates) {
    const existing = await sql`
      SELECT id FROM skins WHERE name = ${c.name} AND rarity = ${c.rarity} LIMIT 1
    `;
    if (existing.length > 0) {
      console.log(`  skip   ${c.rarity.padEnd(10)} ${c.name}`);
      skipped += 1;
      continue;
    }
    await sql`
      INSERT INTO skins (user_id, name, rarity, image_url, description)
      VALUES (NULL, ${c.name}, ${c.rarity}, ${c.imageUrl}, ${`${c.rarity} skin - ${c.name}`})
    `;
    console.log(`  insert ${c.rarity.padEnd(10)} ${c.name.padEnd(22)} ${c.imageUrl}`);
    inserted += 1;
  }

  console.log(`done. inserted=${inserted} skipped=${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
