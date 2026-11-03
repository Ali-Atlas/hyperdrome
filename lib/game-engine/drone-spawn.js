/**
 * Helpers for provisioning brand-new player drones outside the magic-link
 * starter flow: the NPC vendor purchase and the XP-milestone free spawn.
 *
 * Pure JS, no DB access - callers handle persistence.
 *
 * Drone-name generation lives in `./drone-names.js`; importers should
 * pull `randomDroneName` / `generateUniqueDroneName` from there
 * directly.
 */

import { STAT_KEYS, calculateTSB, calculatePerStatCap } from './economy.js';

/**
 * Distribute TSB across the 9 stats, each capped at the level's per-stat
 * cap. Starts every stat at 1 and randomly walks the remaining (TSB - 9)
 * points across eligible stats. Produces a varied roster — some stats
 * heavy, some near 1 — which is what XP-milestone spawns get.
 * @param {number} level
 */
export function buildLevelDistributedStats(level) {
  const cap = calculatePerStatCap(level);
  const tsb = calculateTSB(level);
  const stats = Object.fromEntries(STAT_KEYS.map((k) => [k, 1]));
  let remaining = tsb - STAT_KEYS.length;
  let guard = 0;
  while (remaining > 0 && guard < 1000) {
    const eligible = STAT_KEYS.filter((k) => stats[k] < cap);
    if (eligible.length === 0) break;
    const k = eligible[Math.floor(Math.random() * eligible.length)];
    stats[k] += 1;
    remaining -= 1;
    guard += 1;
  }
  return stats;
}

/**
 * Roll each stat uniformly in [1, maxRoll] then trim to TSB. Lower ceiling
 * than buildLevelDistributedStats so vendor-bought LV1 drones feel
 * deliberately mid-tier compared to drones earned via play.
 * @param {number} level
 * @param {number} [maxRoll]
 */
export function buildLowRangeStats(level, maxRoll = 5) {
  const tsb = calculateTSB(level);
  const stats = Object.fromEntries(STAT_KEYS.map((k) => [k, 1]));
  for (const k of STAT_KEYS) {
    stats[k] = 1 + Math.floor(Math.random() * maxRoll);
  }
  let total = Object.values(stats).reduce((a, b) => a + b, 0);
  let guard = 0;
  while (total > tsb && guard < 1000) {
    const reducible = STAT_KEYS.filter((k) => stats[k] > 1);
    if (reducible.length === 0) break;
    const k = reducible[Math.floor(Math.random() * reducible.length)];
    stats[k] -= 1;
    total -= 1;
    guard += 1;
  }
  return stats;
}
