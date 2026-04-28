#!/usr/bin/env node
/**
 * One-shot: bump `race_interval_seconds` in admin_config to 180 so the
 * cron tick lines up with the new vercel.json `*​/3 * * * *` schedule.
 *
 * Run from the repo root:  node scripts/update-race-interval-180.js
 *
 * Idempotent. Reads .env.local for DATABASE_URL the same way the other
 * scripts in this directory do. Prints before/after. Safe to re-run.
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

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = neon(url);
const TARGET_KEY = 'race_interval_seconds';
const TARGET_VALUE = '180';

const before = await sql`SELECT key, value FROM admin_config WHERE key = ${TARGET_KEY}`;
console.log('before:', before[0] ?? '(no row)');

await sql`
  INSERT INTO admin_config (key, value, updated_at)
  VALUES (${TARGET_KEY}, ${TARGET_VALUE}, NOW())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = NOW()
`;

const after = await sql`SELECT key, value FROM admin_config WHERE key = ${TARGET_KEY}`;
console.log('after: ', after[0]);
