/**
 * Throwaway read-only diagnostic. Pulls all tracks and active bot drones
 * from the dev DB, runs 100 simulated races between bracket-matched bot
 * pairs on random tracks, and reports lead-change distribution +
 * final-gap stats.
 *
 *   node --env-file=.env.local scripts/test-races.js
 *
 * No DB writes - SELECTs only. Deletes PROD_DATABASE_URL out of
 * process.env so a forgotten prod URL in .env.local can't accidentally
 * read prod.
 */

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { and, eq } from 'drizzle-orm';

import * as schema from '../lib/db/schema.js';
import {
  simulateRace,
  randomWeather,
  randomTimeOfDay,
} from '../lib/game-engine/race-simulator.js';

delete process.env.PROD_DATABASE_URL;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to .env.local and re-run.');
  process.exit(1);
}

const { tracks, drones } = schema;
const db = drizzle(neon(process.env.DATABASE_URL), { schema });

const TOTAL_RACES = 100;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function bracketOf(level) {
  if (level <= 5) return '1-5';
  if (level <= 10) return '6-10';
  if (level <= 15) return '11-15';
  return '16-20';
}

function groupByBracket(rows) {
  const groups = { '1-5': [], '6-10': [], '11-15': [], '16-20': [] };
  for (const d of rows) groups[bracketOf(d.level)].push(d);
  return groups;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickTwoDistinct(arr) {
  const a = pickRandom(arr);
  let b = pickRandom(arr);
  while (b.id === a.id) b = pickRandom(arr);
  return [a, b];
}

/**
 * Walk the per-segment race log, accumulating drone1Time - drone2Time
 * across every segment. A "lead change" is a sign flip in that running
 * sum (negative = drone1 leading, positive = drone2 leading). Both old
 * and new sign must be non-zero; brushing past 0 doesn't double-count.
 */
function countLeadChanges(raceLog) {
  let cum = 0;
  let lastSign = 0;
  let flips = 0;
  for (const seg of raceLog) {
    cum += seg.drone1Time - seg.drone2Time;
    const sign = Math.sign(cum);
    if (sign !== 0 && lastSign !== 0 && sign !== lastSign) flips += 1;
    if (sign !== 0) lastSign = sign;
  }
  return flips;
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

async function main() {
  const allTracks = await db.select().from(tracks);
  const botDrones = await db
    .select()
    .from(drones)
    .where(and(eq(drones.isBot, true), eq(drones.active, true)));

  if (allTracks.length === 0) {
    console.error('No tracks in DB.');
    process.exit(1);
  }
  if (botDrones.length === 0) {
    console.error('No active bot drones in DB.');
    process.exit(1);
  }

  const groups = groupByBracket(botDrones);
  const matchable = Object.entries(groups).filter(([, arr]) => arr.length >= 2);
  if (matchable.length === 0) {
    console.error(
      'No bracket has 2+ active bot drones. Cannot run bracket-matched races.',
    );
    process.exit(1);
  }

  console.log(
    `Pool: ${botDrones.length} active bot drones across ${matchable.length} matchable bracket(s).`,
  );
  console.log(
    `Brackets: ${matchable.map(([k, arr]) => `${k}=${arr.length}`).join(', ')}`,
  );
  console.log(`Tracks: ${allTracks.length}\n`);

  const buckets = { '0': 0, '1-2': 0, '3-5': 0, '6+': 0 };
  let totalFlips = 0;
  let totalGap = 0;
  let maxGap = -Infinity;
  let minGap = Infinity;

  for (let i = 0; i < TOTAL_RACES; i += 1) {
    const [, pool] = pickRandom(matchable);
    const [d1, d2] = pickTwoDistinct(pool);
    const track = pickRandom(allTracks);
    const result = simulateRace(
      d1,
      d2,
      track,
      randomWeather(),
      randomTimeOfDay(),
    );

    const flips = countLeadChanges(result.raceLog);
    totalFlips += flips;
    if (flips === 0) buckets['0'] += 1;
    else if (flips <= 2) buckets['1-2'] += 1;
    else if (flips <= 5) buckets['3-5'] += 1;
    else buckets['6+'] += 1;

    const gap = Math.abs(result.drone1Time - result.drone2Time);
    totalGap += gap;
    if (gap > maxGap) maxGap = gap;
    if (gap < minGap) minGap = gap;
  }

  console.log(`Total races:                    ${TOTAL_RACES}`);
  console.log(`Lead-change distribution:`);
  console.log(`  0 lead changes:               ${buckets['0']}`);
  console.log(`  1-2 lead changes:             ${buckets['1-2']}`);
  console.log(`  3-5 lead changes:             ${buckets['3-5']}`);
  console.log(`  6+ lead changes:              ${buckets['6+']}`);
  console.log(
    `Average lead changes per race:  ${(totalFlips / TOTAL_RACES).toFixed(2)}`,
  );
  console.log(
    `Final gap (s):  mean=${(totalGap / TOTAL_RACES).toFixed(2)}  max=${maxGap.toFixed(2)}  min=${minGap.toFixed(2)}`,
  );
}

main().catch((err) => {
  console.error('test-races failed:', err);
  process.exit(1);
});
