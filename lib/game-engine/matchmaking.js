/**
 * Matchmaking (SPEC.md 2.3). The race loop pairs drones in level brackets; within a bracket,
 * drones are matched by ELO so stronger drones race stronger drones. Bots (contract-owned drones)
 * fill each non-empty bracket to `BOT_BRACKET_FILL`, rounded up to even. Pure: the scheduler
 * (services/batch.service.js) reads the candidates and bots and calls these functions.
 */

/** Bots fill each non-empty bracket to max(count, 5), rounded up to even (SPEC.md 2.3). */
export const BOT_BRACKET_FILL = 5;

/** @typedef {'1-5' | '6-10' | '11-15' | '16-20' | '20+'} Bracket */

/** The brackets in SPEC.md 2.3 order. @type {readonly Bracket[]} */
export const BRACKETS = Object.freeze(['1-5', '6-10', '11-15', '16-20', '20+']);

/**
 * Return the bracket string for a given drone level.
 * @param {number} level
 * @returns {Bracket}
 */
export function getLevelBracket(level) {
  if (level <= 5) return '1-5';
  if (level <= 10) return '6-10';
  if (level <= 15) return '11-15';
  if (level <= 20) return '16-20';
  return '20+';
}

/**
 * Group drones by bracket, every bracket present (empty arrays included).
 * @template {{ level: number }} T
 * @param {T[]} rows
 * @returns {Record<Bracket, T[]>}
 */
export function groupByBracket(rows) {
  const buckets = /** @type {Record<Bracket, T[]>} */ (
    /** @type {unknown} */ (Object.fromEntries(BRACKETS.map((b) => [b, []])))
  );
  for (const row of rows) buckets[getLevelBracket(row.level)].push(row);
  return buckets;
}

/**
 * Pair drones in a bracket. Sorted by ELO desc, then matched greedily
 * with one rule: two drones owned by the same human user CANNOT race
 * each other. If the next-closest-ELO partner is owned by the same
 * user, we skip ahead to the next valid candidate. Bot drones (null
 * userId) can pair with anyone, including each other.
 *
 * The greedy strategy preserves ELO closeness as much as possible
 * while honoring the same-owner constraint. If a drone has no valid
 * partner remaining (e.g. all the rest belong to the same owner),
 * it stays unpaired this cycle - bot backfill on the next cycle
 * usually fixes that.
 *
 * @template {{ eloRating: number, userId: string | null }} T
 * @param {T[]} bracketDrones
 * @returns {Array<[T, T]>}
 */
export function matchDronesInBracket(bracketDrones) {
  const sorted = [...bracketDrones].sort((a, b) => b.eloRating - a.eloRating);
  /** @type {Array<[T, T]>} */
  const pairs = [];
  const used = new Set();
  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;
      const a = sorted[i];
      const b = sorted[j];
      if (a.userId && b.userId && a.userId === b.userId) continue;
      pairs.push([a, b]);
      used.add(i);
      used.add(j);
      break;
    }
  }
  return pairs;
}

/**
 * How many bots a bracket needs (SPEC.md 2.3): an empty bracket gets none; otherwise the count is
 * filled to max(count, BOT_BRACKET_FILL) rounded up to even.
 * @param {number} currentCount active player drones in the bracket
 * @param {number} [minimum]
 * @returns {number}
 */
export function botsNeeded(currentCount, minimum = BOT_BRACKET_FILL) {
  if (currentCount === 0) return 0;
  let target = Math.max(currentCount, minimum);
  if (target % 2 !== 0) target += 1;
  return target - currentCount;
}
