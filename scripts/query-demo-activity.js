/**
 * Read-only: per-claimed-demo-user activity report.
 *
 * Identifies the 13 claimed pre-seeds (email rewritten from
 * pilot_dXX@demo.hyperdrome.gg to claimed_*@demo.hyperdrome.gg) and
 * counts post-claim activity that is distinguishable from the seed
 * baseline.
 *
 * Activity signals chosen because they survive the seed-vs-live filter:
 *   - drones owned beyond baseline 8 (NPC buys, marketplace buys, pack opens)
 *   - drones with totalPointsInvested > 0 (stat upgrades; seed never writes this)
 *   - sum of points invested across the user's drones
 *   - marketplace listings authored (sellerId = user.id)
 *   - marketplace listings sold (sold rows where sellerId = user.id)
 *   - marketplace listings bought (buyerId = user.id)
 *   - volts delta from 110,000 (seed pins balance at exactly that)
 *   - active drone count != 3 (seed pins to 3; deviation = toggle activity)
 *   - drone ownership history rows (creation + transfer audit; > 8 = post-claim asset moves)
 *
 * Usage: node --env-file=.env.local scripts/query-demo-activity.js
 */

import { neon } from '@neondatabase/serverless';

const url = process.env.PROD_DATABASE_URL;
if (!url) { console.error('PROD_DATABASE_URL not set'); process.exit(1); }
const sql = neon(url);

const STARTING_VOLTS = 110_000;
const SEED_DRONES = 8;
const SEED_ACTIVE = 3;

/* -------------------------------------------------------------------------- */
/* Exploration: what transaction types + listing statuses actually exist?     */
/* -------------------------------------------------------------------------- */

const txTypes = await sql`
  SELECT transaction_type, COUNT(*)::int AS n
  FROM drone_ownership_history
  GROUP BY transaction_type
  ORDER BY n DESC
`;
const listingStatuses = await sql`
  SELECT status, COUNT(*)::int AS n
  FROM marketplace_listings
  GROUP BY status
  ORDER BY n DESC
`;

/* -------------------------------------------------------------------------- */
/* Per-claimed-user rollup                                                    */
/* -------------------------------------------------------------------------- */

const rows = await sql`
  WITH claimed AS (
    SELECT id, username, email, points
    FROM users
    WHERE email LIKE 'claimed_%@demo.hyperdrome.gg'
  ),
  drone_agg AS (
    SELECT
      user_id,
      COUNT(*)::int AS drones_owned,
      SUM(total_points_invested)::int AS total_invested,
      COUNT(*) FILTER (WHERE total_points_invested > 0)::int AS drones_upgraded,
      COUNT(*) FILTER (WHERE active = true)::int AS active_drones
    FROM drones
    WHERE user_id IN (SELECT id FROM claimed)
    GROUP BY user_id
  ),
  listings_authored AS (
    SELECT seller_id AS user_id, COUNT(*)::int AS n
    FROM marketplace_listings
    WHERE seller_id IN (SELECT id FROM claimed)
    GROUP BY seller_id
  ),
  listings_sold AS (
    SELECT seller_id AS user_id, COUNT(*)::int AS n
    FROM marketplace_listings
    WHERE seller_id IN (SELECT id FROM claimed) AND status = 'sold'
    GROUP BY seller_id
  ),
  listings_bought AS (
    SELECT buyer_id AS user_id, COUNT(*)::int AS n
    FROM marketplace_listings
    WHERE buyer_id IN (SELECT id FROM claimed) AND status = 'sold'
    GROUP BY buyer_id
  ),
  ownership_rows AS (
    SELECT owner_user_id AS user_id, COUNT(*)::int AS n
    FROM drone_ownership_history
    WHERE owner_user_id IN (SELECT id FROM claimed)
    GROUP BY owner_user_id
  )
  SELECT
    c.username,
    c.points                                   AS volts,
    (c.points - ${STARTING_VOLTS})::int        AS volts_delta,
    COALESCE(d.drones_owned, 0)                AS drones_owned,
    COALESCE(d.drones_upgraded, 0)             AS drones_upgraded,
    COALESCE(d.total_invested, 0)              AS total_invested,
    COALESCE(d.active_drones, 0)               AS active_drones,
    COALESCE(la.n, 0)                          AS listings_authored,
    COALESCE(ls.n, 0)                          AS listings_sold,
    COALESCE(lb.n, 0)                          AS listings_bought,
    COALESCE(oh.n, 0)                          AS ownership_rows
  FROM claimed c
  LEFT JOIN drone_agg d         ON d.user_id  = c.id
  LEFT JOIN listings_authored la ON la.user_id = c.id
  LEFT JOIN listings_sold ls    ON ls.user_id = c.id
  LEFT JOIN listings_bought lb  ON lb.user_id = c.id
  LEFT JOIN ownership_rows oh   ON oh.user_id = c.id
  ORDER BY
    /* rough activity score: weight rare actions higher */
    (COALESCE(d.drones_upgraded, 0) * 4
     + COALESCE(la.n, 0) * 3
     + COALESCE(ls.n, 0) * 5
     + COALESCE(lb.n, 0) * 5
     + (COALESCE(d.drones_owned, 0) - ${SEED_DRONES}) * 4
     + ABS(COALESCE(d.active_drones, 0) - ${SEED_ACTIVE}) * 1
     + (COALESCE(oh.n, 0) - ${SEED_DRONES}) * 2
    ) DESC,
    c.username ASC
`;

/* -------------------------------------------------------------------------- */
/* Render                                                                     */
/* -------------------------------------------------------------------------- */

console.log('# transaction types in drone_ownership_history');
for (const t of txTypes) console.log(`  ${String(t.transaction_type).padEnd(12)} ${t.n}`);
console.log();
console.log('# marketplace_listings statuses');
for (const s of listingStatuses) console.log(`  ${String(s.status).padEnd(12)} ${s.n}`);
console.log();

const cols = [
  ['username',          14],
  ['volts',              7],
  ['Δ_volts',            8],
  ['drones',             6],
  ['+drones',            7],   // drones_owned - 8
  ['upgraded',           8],   // drones_upgraded
  ['volts_invested',    14],   // total_invested
  ['active',             6],   // active_drones
  ['Δ_active',           8],   // active_drones - 3
  ['listed',             6],
  ['sold',               4],
  ['bought',             6],
  ['+history',           8],   // ownership_rows - 8
];

const head = cols.map(([n, w]) => String(n).padEnd(w)).join(' ');
console.log(head);
console.log('-'.repeat(head.length));
for (const r of rows) {
  const cells = [
    String(r.username).slice(0, 14).padEnd(14),
    String(r.volts).padStart(7),
    String(r.volts_delta).padStart(8),
    String(r.drones_owned).padStart(6),
    String(r.drones_owned - SEED_DRONES).padStart(7),
    String(r.drones_upgraded).padStart(8),
    String(r.total_invested).padStart(14),
    String(r.active_drones).padStart(6),
    String(r.active_drones - SEED_ACTIVE).padStart(8),
    String(r.listings_authored).padStart(6),
    String(r.listings_sold).padStart(4),
    String(r.listings_bought).padStart(6),
    String(r.ownership_rows - SEED_DRONES).padStart(8),
  ];
  console.log(cells.join(' '));
}

console.log();
console.log('legend:');
console.log('  Δ_volts        = current balance - 110,000 (seed pins balance)');
console.log('  +drones        = drones owned beyond seed baseline of 8');
console.log('  upgraded       = # of drones with any points invested (seed writes 0)');
console.log('  volts_invested = sum of total_points_invested across owned drones');
console.log('  active / Δ_active = current active count, deviation from seed baseline of 3');
console.log('  listed         = marketplace listings authored');
console.log('  sold           = listings sold (seller side)');
console.log('  bought         = listings bought (buyer side)');
console.log('  +history       = drone_ownership_history rows beyond seed baseline of 8');
