#!/usr/bin/env node
/**
 * Seed marketplace listings for every image-backed skin currently
 * unowned in the vault, plus any image-backed skin already owned by
 * HELLO that doesn't have an active listing yet.
 *
 * Run from the repo root:  node scripts/seed-skin-listings.js
 *
 * Idempotent. The script's per-skin loop:
 *   1. If the skin is unowned (`user_id IS NULL`), assign ownership to
 *      HELLO. (Image-backed pool only - the WHERE clause filters out
 *      the 71 legacy placeholder rows by their non-`/skins/...webp`
 *      `image_url`.)
 *   2. If HELLO already has an active marketplace listing for this
 *      skin, skip. Otherwise insert a new listing with a price scaled
 *      to the skin's rarity.
 *
 * Re-running is a no-op once every image-backed skin is owned by HELLO
 * and listed. NEVER deletes or modifies the legacy 71 skin rows, their
 * listings, or any other existing data.
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

/** Inclusive integer in [lo, hi]. */
function randInt(lo, hi) {
  return Math.floor(lo + Math.random() * (hi - lo + 1));
}

/** Price band per rarity. */
const PRICE_BANDS = {
  common:    [100, 300],
  rare:      [400, 800],
  epic:      [1500, 3000],
  legendary: [5000, 15000],
};

function priceFor(rarity) {
  const band = PRICE_BANDS[rarity];
  if (!band) throw new Error(`Unknown rarity: ${rarity}`);
  return randInt(band[0], band[1]);
}

async function main() {
  // 1. Resolve the HELLO seller account.
  const [hello] = await sql`
    SELECT id, username FROM users WHERE username = 'HELLO' LIMIT 1
  `;
  if (!hello) {
    console.error('User HELLO not found. Aborting.');
    process.exit(1);
  }
  console.log(`seller -> ${hello.username} (${hello.id})`);

  // 2. Pull every image-backed skin (whether unowned or already
  // owned by HELLO from a prior partial run). Exclude legacy
  // placeholder skins via the path filter.
  const skinsRows = await sql`
    SELECT id, name, rarity, image_url, user_id
    FROM skins
    WHERE image_url LIKE '/skins/%'
      AND image_url LIKE '%.webp'
      AND (user_id IS NULL OR user_id = ${hello.id})
    ORDER BY rarity, name
  `;
  console.log(`scanned ${skinsRows.length} image-backed skins`);

  // 3. Fetch HELLO's existing active listings keyed by skinId so we
  // don't duplicate.
  const existingListings = await sql`
    SELECT skin_id FROM marketplace_listings
    WHERE seller_id = ${hello.id}
      AND item_type = 'skin'
      AND status = 'active'
  `;
  const alreadyListed = new Set(existingListings.map((l) => l.skin_id));

  let assigned = 0;
  let listed = 0;
  let skipped = 0;

  for (const skin of skinsRows) {
    // 3a. Assign ownership if unowned.
    if (skin.user_id === null) {
      await sql`
        UPDATE skins SET user_id = ${hello.id} WHERE id = ${skin.id}
      `;
      assigned += 1;
    }

    // 3b. Insert listing if HELLO doesn't have an active one.
    if (alreadyListed.has(skin.id)) {
      console.log(`  skip   ${skin.rarity.padEnd(10)} ${skin.name.padEnd(22)} (already listed)`);
      skipped += 1;
      continue;
    }
    const price = priceFor(skin.rarity);
    await sql`
      INSERT INTO marketplace_listings (seller_id, item_type, skin_id, price, status)
      VALUES (${hello.id}, 'skin', ${skin.id}, ${price}, 'active')
    `;
    console.log(
      `  list   ${skin.rarity.padEnd(10)} ${skin.name.padEnd(22)} ${price.toLocaleString()}V`,
    );
    listed += 1;
  }

  console.log(`done. assigned=${assigned} listed=${listed} skipped=${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
