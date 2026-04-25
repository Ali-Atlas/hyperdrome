import { and, eq, asc, desc } from 'drizzle-orm';
import { db, schema } from '@/lib/db';

const { drones } = schema;

/**
 * Drone Manager - matchmaking.
 *
 * The race loop is organised in "brackets" by drone level. Within a bracket,
 * active drones are paired by ELO so stronger drones race stronger drones.
 *
 * Hard guarantee: after `ensureBotBackfill` runs, every non-empty bracket
 * has an EVEN number of active drones. There are never byes - every active
 * drone races every cycle.
 */

/**
 * Return the bracket string for a given drone level.
 * @param {number} level
 * @returns {'1-5'|'6-10'|'11-15'|'16-20'|'20+'}
 */
export function getLevelBracket(level) {
  if (level <= 5) return '1-5';
  if (level <= 10) return '6-10';
  if (level <= 15) return '11-15';
  if (level <= 20) return '16-20';
  return '20+';
}

/**
 * Fetch all active drones and group them by their bracket.
 * @returns {Promise<Record<string, Array<object>>>}
 */
export async function getActiveDronesByBracket() {
  const rows = await db
    .select()
    .from(drones)
    .where(eq(drones.active, true))
    .orderBy(desc(drones.eloRating));

  const buckets = { '1-5': [], '6-10': [], '11-15': [], '16-20': [], '20+': [] };
  for (const drone of rows) {
    buckets[getLevelBracket(drone.level)].push(drone);
  }
  return buckets;
}

/**
 * Pair every drone in a bracket. Sorted by ELO, paired adjacent.
 * Callers MUST pass an even-length array - `ensureBotBackfill` guarantees
 * this. If somehow an odd array arrives we defensively drop the last drone
 * to avoid a broken race, but this path should never fire in practice.
 * @param {Array<object>} bracketDrones
 * @returns {Array<[object, object]>}
 */
export function matchDronesInBracket(bracketDrones) {
  const sorted = [...bracketDrones].sort((a, b) => b.eloRating - a.eloRating);
  const evenLen = sorted.length - (sorted.length % 2);
  const pairs = [];
  for (let i = 0; i < evenLen; i += 2) {
    pairs.push([sorted[i], sorted[i + 1]]);
  }
  return pairs;
}

/**
 * Ensure a bracket has enough active drones to race AND that the count is even.
 *
 * Rules:
 *   1. Empty brackets (`currentCount === 0`) are skipped - nothing to race,
 *      no bots added.
 *   2. Target = `max(currentCount, minimum)` rounded UP to the nearest even
 *      number. So if minimum=4 and currentCount=3, target=4 (even).
 *      If minimum=4 and currentCount=5, target=6.
 *   3. The diff is filled first by activating inactive bots already at the
 *      right level. If that pool runs out, new bots are created on the fly
 *      at the middle of the bracket's level range.
 *
 * @param {string} bracket
 * @param {number} currentCount - active drones already in the bracket
 * @param {number} minimum - configured bot density minimum
 * @returns {Promise<number>} count of bots added to the bracket
 */
export async function ensureBotBackfill(bracket, currentCount, minimum) {
  if (currentCount === 0) return 0;

  let target = Math.max(currentCount, minimum);
  if (target % 2 !== 0) target += 1;

  const toAdd = target - currentCount;
  if (toAdd <= 0) return 0;

  const [minLvl, maxLvl] = bracketRange(bracket);

  // Step 1: activate inactive bots already seeded at the right level.
  const inactive = await db
    .select()
    .from(drones)
    .where(and(eq(drones.isBot, true), eq(drones.active, false)))
    .orderBy(asc(drones.level));

  const eligible = inactive.filter(
    (d) => d.level >= minLvl && d.level <= maxLvl,
  );

  let added = 0;
  for (let i = 0; i < eligible.length && added < toAdd; i++) {
    await db
      .update(drones)
      .set({ active: true })
      .where(eq(drones.id, eligible[i].id));
    added += 1;
  }

  // Step 2: if the inactive pool is exhausted but we still need more, mint
  // fresh bots directly into the active pool so the even-count guarantee
  // always holds, even with surprising player populations.
  while (added < toAdd) {
    const level = Math.floor((minLvl + Math.min(maxLvl, 20)) / 2);
    await createAutoBot(level);
    added += 1;
  }

  return added;
}

/**
 * Create a brand-new bot drone at the given level and mark it active.
 * Stats are spread evenly across all 9 traits, clamped to the per-level cap.
 * @param {number} level
 */
async function createAutoBot(level) {
  const tsb = 9 + 20 * level;
  const cap = Math.min(100, 10 + Math.floor(4.5 * level));
  const pts = tsb - 9;
  const base = Math.floor(pts / 9);
  const rem = pts % 9;

  const statList = [
    'speed',
    'turning',
    'acceleration',
    'durability',
    'nightVision',
    'batteryCapacity',
    'rainHandling',
    'windResistance',
    'consistency',
  ];

  const stats = {};
  for (let i = 0; i < statList.length; i++) {
    const extra = i < rem ? 1 : 0;
    stats[statList[i]] = Math.min(cap, 1 + base + extra);
  }

  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  await db.insert(drones).values({
    name: `AUTOBOT-${suffix}`,
    level,
    xp: 0,
    xpToNextLevel: 300 * level * level,
    totalStatBudget: tsb,
    ...stats,
    active: true,
    isBot: true,
    imageUrl: '/drones/default.png',
    eloRating: 1000,
  });
}

function bracketRange(bracket) {
  switch (bracket) {
    case '1-5':   return [1, 5];
    case '6-10':  return [6, 10];
    case '11-15': return [11, 15];
    case '16-20': return [16, 20];
    case '20+':   return [21, 999];
    default:      return [1, 999];
  }
}
