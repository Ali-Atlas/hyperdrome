/**
 * Drone stat allocation - the single source of truth for turning a
 * (level, profile) tuple into a stat block. Used by every seeder /
 * fix script that mints drones:
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
 * Profile -> 9-element weight vector. Order matches STAT_KEYS:
 * speed, turning, acceleration, durability, nightVision,
 * batteryCapacity, rainHandling, windResistance, consistency.
 *
 * Every weight is >= 1 so no stat is starved entirely - the variance
 * pass relies on having a positive value to nudge.
 */
export const BOT_PROFILES = {
  balanced:    [1, 1, 1, 1, 1, 1, 1, 1, 1],
  speedster:   [3, 1, 3, 1, 1, 1, 1, 3, 1],
  cornerer:    [1, 4, 1, 2, 1, 1, 1, 1, 2],
  tank:        [1, 1, 1, 4, 1, 2, 1, 1, 2],
  nightHunter: [2, 1, 1, 1, 4, 1, 1, 1, 1],
  rainRider:   [1, 2, 1, 1, 1, 1, 4, 1, 2],
  windWalker:  [2, 1, 2, 1, 1, 1, 1, 4, 1],
  marathoner:  [2, 1, 1, 2, 1, 4, 1, 1, 1],
  consistent:  [1, 2, 1, 1, 1, 1, 1, 1, 5],
  allrounder:  [2, 2, 2, 2, 1, 1, 1, 1, 2],
};

/**
 * Compute a stat allocation for a drone at `level` using the named
 * profile. Returns `{ stats, tsb }` where `stats` is keyed by the 9
 * STAT_KEYS and sums to exactly `tsb`.
 *
 * Algorithm:
 *   1. Distribute the TSB - 9 spendable points across the 9 stats by
 *      profile weight (floor + spillover loop), capped per stat.
 *   2. Apply +-15% per-stat random variance so two same-level same-
 *      profile drones share the archetype shape but differ on exact
 *      numbers.
 *   3. Rebalance back to TSB. When over, trim the highest stat (>1).
 *      When under, fill the lowest stat (<cap). Re-sorting each pass
 *      keeps the most-extreme stat absorbing the correction so the
 *      archetype silhouette survives.
 *
 * @param {number} level
 * @param {string} profileName  - key into BOT_PROFILES; falls back to 'balanced'.
 * @returns {{ stats: Record<string, number>, tsb: number }}
 */
export function buildStats(level, profileName) {
  const tsb = TSB_BASE + TSB_PER_LEVEL * level;
  const cap = Math.min(100, STAT_CAP_BASE + Math.floor(STAT_CAP_PER_LEVEL * level));
  const points = tsb - 9;
  const weights = BOT_PROFILES[profileName] ?? BOT_PROFILES.balanced;
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const stats = Object.fromEntries(STAT_KEYS.map((k) => [k, 1]));
  let assigned = 0;
  for (let i = 0; i < STAT_KEYS.length; i++) {
    const share = Math.floor((points * weights[i]) / totalWeight);
    stats[STAT_KEYS[i]] = Math.min(cap, 1 + share);
    assigned += stats[STAT_KEYS[i]] - 1;
  }
  let remaining = points - assigned;
  let guard = 0;
  while (remaining > 0 && guard < 100) {
    let placed = 0;
    for (let k = 0; k < STAT_KEYS.length && remaining > 0; k++) {
      if (stats[STAT_KEYS[k]] < cap) {
        stats[STAT_KEYS[k]] += 1;
        remaining -= 1;
        placed += 1;
      }
    }
    if (placed === 0) break;
    guard += 1;
  }

  for (const k of STAT_KEYS) {
    const v = stats[k];
    const delta = Math.round(v * (Math.random() * 0.3 - 0.15));
    stats[k] = Math.max(1, Math.min(cap, v + delta));
  }

  const sumStats = () => STAT_KEYS.reduce((a, k) => a + stats[k], 0);
  let safety = 1000;
  while (sumStats() !== tsb && safety > 0) {
    safety -= 1;
    if (sumStats() > tsb) {
      const k = [...STAT_KEYS]
        .sort((a, b) => stats[b] - stats[a])
        .find((key) => stats[key] > 1);
      if (!k) break;
      stats[k] -= 1;
    } else {
      const k = [...STAT_KEYS]
        .sort((a, b) => stats[a] - stats[b])
        .find((key) => stats[key] < cap);
      if (!k) break;
      stats[k] += 1;
    }
  }

  return { stats, tsb };
}
