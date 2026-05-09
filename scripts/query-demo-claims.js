/**
 * Read-only: count demo accounts that have been taken + show which
 * pilot_dNN slots are still unclaimed (in claim order).
 *
 * Signals:
 *   - Pre-seeded pool: 50 rows with email pilot_dXX@demo.hyperdrome.gg.
 *     When claimed via /api/auth/demo, the email is rewritten to
 *     claimed_<ts>_<rand>@demo.hyperdrome.gg.
 *   - The claim flow orders by email asc, so unclaimed slots are taken
 *     in pilot_d01, pilot_d02, ... order. The lowest unclaimed number
 *     is the next slot a fresh demo press would receive.
 *
 * Usage: node --env-file=.env.local scripts/query-demo-claims.js
 */

import { neon } from '@neondatabase/serverless';

const url = process.env.PROD_DATABASE_URL;
if (!url) { console.error('PROD_DATABASE_URL not set'); process.exit(1); }
const sql = neon(url);

const [{ claimed_preseed }] = await sql`
  SELECT COUNT(*)::int AS claimed_preseed
  FROM users
  WHERE email LIKE 'claimed_%@demo.hyperdrome.gg'
`;

const unclaimedRows = await sql`
  SELECT email
  FROM users
  WHERE email ~ '^pilot_d[0-9]{2}@demo\\.hyperdrome\\.gg$'
  ORDER BY email ASC
`;

const [{ fresh_create }] = await sql`
  SELECT COUNT(*)::int AS fresh_create
  FROM users
  WHERE name LIKE 'PILOT_%'
    AND name NOT LIKE 'PILOT_D%'
`;

console.log('claimed pre-seed (email rewritten):', claimed_preseed);
console.log('fresh-create fallback (PILOT_<4chars>):', fresh_create);
console.log('TOTAL TAKEN:', claimed_preseed + fresh_create);
console.log('---');
console.log('unclaimed slots, in order they will be assigned next:');
for (const r of unclaimedRows) {
  const m = r.email.match(/pilot_d(\d{2})/);
  console.log('  pilot_d' + m[1]);
}
console.log('---');
const nextNum = unclaimedRows[0].email.match(/pilot_d(\d{2})/)[1];
console.log('NEXT PILOT TO BE CLAIMED: pilot_d' + nextNum);
