/**
 * One-off read-only diagnostic: bracket ELO distributions + top-20
 * shape under the current 1.0/1.3/1.7/2.0 weights, plus what alternate
 * weights would produce.
 *
 * Usage: node --env-file=.env.local scripts/query-leaderboard-current.js
 */

import { neon } from '@neondatabase/serverless';

const PROD_URL = process.env.PROD_DATABASE_URL;
if (!PROD_URL) { console.error('PROD_DATABASE_URL not set'); process.exit(1); }
const sql = neon(PROD_URL);

const pad = (s, w) => { s = String(s); return s.length >= w ? s : s + ' '.repeat(w - s.length); };
const padR = (s, w) => { s = String(s); return s.length >= w ? s : ' '.repeat(w - s.length) + s; };

// ELO distribution per bracket (non-bot drones)
const stats = await sql`
  SELECT
    (CASE
      WHEN level BETWEEN 1 AND 5 THEN 'T1'
      WHEN level BETWEEN 6 AND 10 THEN 'T2'
      WHEN level BETWEEN 11 AND 15 THEN 'T3'
      ELSE 'T4'
    END) AS bracket,
    COUNT(*)::int AS n,
    ROUND(AVG(elo_rating)::numeric, 0)::int AS avg_elo,
    MIN(elo_rating)::int AS min_elo,
    MAX(elo_rating)::int AS max_elo,
    ROUND(STDDEV(elo_rating)::numeric, 0)::int AS std_elo,
    ROUND(AVG(total_races)::numeric, 0)::int AS avg_races
  FROM drones
  WHERE is_bot = false
  GROUP BY bracket
  ORDER BY bracket
`;

console.log('\nBracket ELO distributions (non-bot drones):');
console.log(`  ${pad('br', 4)} ${pad('n', 5)} ${pad('avg_elo', 8)} ${pad('min', 5)} ${pad('max', 5)} ${pad('stddev', 7)} ${pad('avg_races', 9)}`);
for (const r of stats) {
  console.log(`  ${pad(r.bracket, 4)} ${padR(r.n, 5)} ${padR(r.avg_elo, 8)} ${padR(r.min_elo, 5)} ${padR(r.max_elo, 5)} ${padR(r.std_elo, 7)} ${padR(r.avg_races, 9)}`);
}

// Top-20 under several weight scenarios — count per bracket
const scenarios = [
  { label: 'CURRENT  (1.0 / 1.3 / 1.7 / 2.0)', w: [1.0, 1.3, 1.7, 2.0] },
  { label: 'STEEPER  (1.0 / 1.5 / 2.0 / 2.5)', w: [1.0, 1.5, 2.0, 2.5] },
  { label: 'FLATTOP  (1.0 / 1.5 / 2.0 / 2.0)', w: [1.0, 1.5, 2.0, 2.0] },
  { label: 'BOOST_T2 (1.0 / 1.8 / 2.0 / 2.0)', w: [1.0, 1.8, 2.0, 2.0] },
  { label: 'AGGR_MID (1.0 / 2.0 / 2.5 / 2.0)', w: [1.0, 2.0, 2.5, 2.0] },
];

async function topByWeights(w) {
  return await sql`
    SELECT
      d.name, d.level,
      (CASE
        WHEN d.level BETWEEN 1 AND 5 THEN 'T1'
        WHEN d.level BETWEEN 6 AND 10 THEN 'T2'
        WHEN d.level BETWEEN 11 AND 15 THEN 'T3'
        ELSE 'T4'
      END) AS bracket,
      d.elo_rating, d.total_races,
      ROUND(
        (d.elo_rating::float
          - AVG(d.elo_rating::float) OVER (PARTITION BY (CASE
              WHEN d.level BETWEEN 1 AND 5 THEN 1
              WHEN d.level BETWEEN 6 AND 10 THEN 2
              WHEN d.level BETWEEN 11 AND 15 THEN 3
              ELSE 4
            END)))
        * (1 + LOG(GREATEST(d.total_races, 1)::numeric) / 3)
        * (CASE
            WHEN d.level BETWEEN 1 AND 5 THEN ${w[0]}::float
            WHEN d.level BETWEEN 6 AND 10 THEN ${w[1]}::float
            WHEN d.level BETWEEN 11 AND 15 THEN ${w[2]}::float
            WHEN d.level BETWEEN 16 AND 20 THEN ${w[3]}::float
          END)
      )::int AS rating
    FROM drones d
    WHERE d.is_bot = false
    ORDER BY rating DESC NULLS LAST
    LIMIT 20
  `;
}

console.log('\nTop-20 bracket distribution under different weight scenarios:');
console.log(`  ${pad('scenario', 36)} ${pad('T1', 4)} ${pad('T2', 4)} ${pad('T3', 4)} ${pad('T4', 4)}`);

for (const s of scenarios) {
  const rows = await topByWeights(s.w);
  const c = { T1: 0, T2: 0, T3: 0, T4: 0 };
  for (const r of rows) c[r.bracket] += 1;
  console.log(`  ${pad(s.label, 36)} ${padR(c.T1, 4)} ${padR(c.T2, 4)} ${padR(c.T3, 4)} ${padR(c.T4, 4)}`);
}

// Print full top-20 under current
console.log('\nFull top-20 under CURRENT (1.0/1.3/1.7/2.0):');
const cur = await topByWeights([1.0, 1.3, 1.7, 2.0]);
console.log(`  ${pad('rank', 5)} ${pad('drone', 26)} ${pad('lvl', 4)} ${pad('br', 3)} ${pad('elo', 5)} ${pad('rating', 7)}`);
for (let i = 0; i < cur.length; i++) {
  const r = cur[i];
  console.log(`  ${padR(i + 1, 5)} ${pad(r.name, 26)} ${padR(r.level, 4)} ${pad(r.bracket, 3)} ${padR(r.elo_rating, 5)} ${padR(r.rating, 7)}`);
}
