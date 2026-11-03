/**
 * Drone stat allocation - the single source of truth for turning a
 * level into a stat block. Used by every seeder / fix script that
 * mints drones:
 *   - scripts/seed-production.js (racing bots, marketplace mints)
 *   - scripts/seed-demo-player.js (PILOT_D demo accounts + on-demand
 *     fresh-create demos)
 *   - scripts/fix-demo-drone-stats.js (one-shot repair script)
 *   - scripts/fix-marketplace-featured.js (one-shot featured-row swap)
 *   - lib/db/seed-more-drones.js (marketplace top-up seeder)
 *
 * Plain JS, no Next.js or DB imports - safe to import from any of the
 * above script entry points.
 */

import { STAT_KEYS } from './economy.js';

/** TSB (Total Stat Budget) = TSB_BASE + TSB_PER_LEVEL * level. */
export const TSB_BASE = 9;
export const TSB_PER_LEVEL = 20;

/** Per-stat cap = min(100, STAT_CAP_BASE + floor(STAT_CAP_PER_LEVEL * level)). */
export const STAT_CAP_BASE = 10;
export const STAT_CAP_PER_LEVEL = 4.5;

/**
 * Uniform integer in [min, max].
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Compute a stat allocation for a drone at `level`. Returns
 * `{ stats, tsb }` where `stats` is keyed by the 9 STAT_KEYS and sums
 * to exactly `tsb` (or as close as the per-stat cap permits).
 *
 * Pure-random allocation: every drone is a unique build. Two drones
 * at the same level share the same TSB but their stat distribution
 * is independently rolled - no profile, no archetype shape.
 *
 * Algorithm:
 *   1. Seed every stat at 1 (guarantees no zero values + fixes the
 *      9 stats * 1 floor). Spendable points = TSB - 9.
 *   2. Roll loop: pick a random stat that still has cap headroom,
 *      add randInt(1, min(remaining, room)) to it, subtract from
 *      remaining, evict the stat from the eligible pool if it hit
 *      cap.
 *   3. When exactly one eligible stat remains, dump the rest of the
 *      remaining points into it (clamped to its cap headroom).
 *
 * @param {number} level
 * @returns {{ stats: Record<string, number>, tsb: number }}
 */
export function buildStats(level) {
  const tsb = TSB_BASE + TSB_PER_LEVEL * level;
  const cap = Math.min(100, STAT_CAP_BASE + Math.floor(STAT_CAP_PER_LEVEL * level));

  const stats = Object.fromEntries(STAT_KEYS.map((k) => [k, 1]));
  let remaining = tsb - STAT_KEYS.length;
  let eligible = STAT_KEYS.filter((k) => stats[k] < cap);

  while (remaining > 0 && eligible.length > 0) {
    if (eligible.length === 1) {
      const k = eligible[0];
      const room = cap - stats[k];
      const dump = Math.min(remaining, room);
      stats[k] += dump;
      remaining -= dump;
      break;
    }
    const k = eligible[Math.floor(Math.random() * eligible.length)];
    const room = cap - stats[k];
    if (room <= 0) {
      eligible = eligible.filter((x) => x !== k);
      continue;
    }
    const add = randInt(1, Math.min(remaining, room));
    stats[k] += add;
    remaining -= add;
    if (stats[k] >= cap) {
      eligible = eligible.filter((x) => x !== k);
    }
  }

  return { stats, tsb };
}
