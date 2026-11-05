/**
 * The bot roster the world seed mints (SPEC.md 2.3): contract-owned drones that fill a bracket's
 * field. A bracket never needs more than `BOT_BRACKET_FILL` bots (one player drone is filled to
 * 6), so that many are minted per bracket, alternating between the bracket's two bot levels. The
 * 20+ bracket holds no drone while the level cap is 20, so it gets none. Pure: randomness is
 * injected.
 */
import { calculatePerStatCap, calculateTSB } from '../game-engine/economy.js';
import { BOT_BRACKET_FILL } from '../game-engine/matchmaking.js';
import { STAT_KEYS } from '../game-engine/templates.js';

/** @typedef {import('../game-engine/matchmaking.js').Bracket} Bracket */

/** Bots per bracket: the most `botsNeeded` ever asks for. */
export const BOTS_PER_BRACKET = BOT_BRACKET_FILL;

/** The two bot levels of each bracket that can hold a drone. */
export const BOT_BRACKET_LEVELS = /** @type {const} */ ({
  '1-5': [2, 4],
  '6-10': [7, 9],
  '11-15': [12, 14],
  '16-20': [17, 19],
});

/**
 * The level of bot number `slot` (0-based) of a bracket: the lower level on even slots, the higher
 * on odd ones, so 5 bots are 3 at the lower level and 2 at the higher.
 * @param {keyof typeof BOT_BRACKET_LEVELS} bracket
 * @param {number} slot
 * @returns {number}
 */
function botLevel(bracket, slot) {
  const levels = BOT_BRACKET_LEVELS[bracket];
  return levels[slot % levels.length];
}

/**
 * The whole roster: `BOTS_PER_BRACKET` bots for each bracket, 20 in total.
 * @returns {{ bracket: keyof typeof BOT_BRACKET_LEVELS, slot: number, level: number }[]}
 */
export function botRoster() {
  const brackets = /** @type {(keyof typeof BOT_BRACKET_LEVELS)[]} */ (
    Object.keys(BOT_BRACKET_LEVELS)
  );
  return brackets.flatMap((bracket) =>
    Array.from({ length: BOTS_PER_BRACKET }, (_, slot) => ({
      bracket,
      slot,
      level: botLevel(bracket, slot),
    }))
  );
}

/**
 * A stat line for a bot of `level` (SPEC.md 2.1): every stat starts at 1 and the rest of TSB(L) is
 * placed one point at a time on a random stat still under cap(L), so the line sums to TSB(L) and
 * no stat passes the cap.
 * @param {number} level
 * @param {(max: number) => number} randomInt uniform integer in [0, max)
 * @returns {number[]} the 9 stats in SPEC 2.1 order
 */
export function walkStats(level, randomInt) {
  const cap = calculatePerStatCap(level);
  const stats = STAT_KEYS.map(() => 1);
  let remaining = calculateTSB(level) - stats.length;
  while (remaining > 0) {
    const open = stats.flatMap((value, i) => (value < cap ? [i] : []));
    if (open.length === 0) break;
    stats[open[randomInt(open.length)]] += 1;
    remaining -= 1;
  }
  return stats;
}
