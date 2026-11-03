/**
 * Pure game economy functions (SPEC.md 2.1 to 2.3). Side-effect free, so the same math runs on the
 * server and in the browser. Settlement constants mirror the contract (`constants/mod.rs`).
 */

/** Volts every new player starts with (SPEC.md 2.2; both signup paths use this). */
export const STARTER_VOLTS = 1000;

/** XP needed per level is XP_PER_LEVEL_SQUARED * L * L (SPEC.md 2.1). */
export const XP_PER_LEVEL_SQUARED = 200;

/** camelCase stat keys in SPEC.md 2.1 order; one table, defined in templates.js. */
export { STAT_KEYS } from './templates.js';
import { STAT_KEYS } from './templates.js';

/** @type {Record<string, string>} */
const SNAKE_TO_CAMEL = {
  speed: 'speed',
  turning: 'turning',
  acceleration: 'acceleration',
  durability: 'durability',
  night_vision: 'nightVision',
  battery_capacity: 'batteryCapacity',
  rain_handling: 'rainHandling',
  wind_resistance: 'windResistance',
  consistency: 'consistency',
};

/**
 * Normalise a stats object to camelCase keys, accepting either convention.
 * Unknown keys are dropped.
 * @param {Record<string, number>|null|undefined} obj
 * @returns {Record<string, number>}
 */
function normaliseStats(obj) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (/** @type {readonly string[]} */ (STAT_KEYS).includes(k)) {
      out[k] = v;
    } else if (SNAKE_TO_CAMEL[k]) {
      out[SNAKE_TO_CAMEL[k]] = v;
    }
  }
  return out;
}

/**
 * Cost in points to raise a stat from `currentValue` to `currentValue + 1`.
 * Formula: `1 + floor(currentValue / 10)`.
 * @param {number} currentValue
 * @returns {number}
 */
export function calculateStatUpgradeCost(currentValue) {
  return 1 + Math.floor(currentValue / 10);
}

/**
 * Total points required to raise a stat from `fromValue` to `toValue`.
 * Returns 0 for decreases (never refunds).
 * @param {number} fromValue
 * @param {number} toValue
 * @returns {number}
 */
export function calculateTotalUpgradeCost(fromValue, toValue) {
  if (toValue <= fromValue) return 0;
  let total = 0;
  for (let v = fromValue; v < toValue; v++) {
    total += calculateStatUpgradeCost(v);
  }
  return total;
}

/**
 * Total Stat Budget for a given drone level.
 * Formula: `tsbBase + tsbPerLevel * level`.
 * @param {number} level
 * @param {{ tsbBase?: number, tsbPerLevel?: number }} [config]
 * @returns {number}
 */
export function calculateTSB(level, config = {}) {
  const { tsbBase = 9, tsbPerLevel = 20 } = config;
  return tsbBase + tsbPerLevel * level;
}

/**
 * Maximum value any single stat can reach at a given level.
 * Formula: `min(100, statCapBase + floor(statCapPerLevel * level))`.
 * @param {number} level
 * @param {{ statCapBase?: number, statCapPerLevel?: number }} [config]
 * @returns {number}
 */
export function calculatePerStatCap(level, config = {}) {
  const { statCapBase = 10, statCapPerLevel = 4.5 } = config;
  return Math.min(100, statCapBase + Math.floor(statCapPerLevel * level));
}

/**
 * XP required to advance from `level` to the next: 200 * L * L (SPEC.md 2.1). The only source of
 * the curve; every write of `xpToNextLevel` uses it.
 * @param {number} level
 * @returns {number}
 */
export function calculateXPToNextLevel(level) {
  return XP_PER_LEVEL_SQUARED * level * level;
}

/** Lifetime player races that unlock active slots 2 and 3 (SPEC.md 2.2). */
export const SLOT_UNLOCK_RACES = Object.freeze([500, 2000]);

/**
 * Active drone slots for a player (SPEC.md 2.2): 1, slot 2 at 500 lifetime player races, slot 3
 * at 2,000; max 3.
 * @param {number} lifetimeRaces
 * @returns {number}
 */
export function activeSlotsFor(lifetimeRaces) {
  return 1 + SLOT_UNLOCK_RACES.filter((n) => lifetimeRaces >= n).length;
}

/**
 * Winner payout in Volts (SPEC.md 2.3): 3 + floor(L_winner / 2) + floor(difficulty / 2)
 * + max(0, floor((ELO_loser - ELO_winner) / 100)) + dominance. Dominance is 5 when the margin
 * abs(t_a - t_b) * 100 / min(t_a, t_b) is above 40, 2 when above 20, else 0, compared exactly in
 * integers so the contract can apply the same rule.
 * @param {{ winnerLevel: number, difficulty: number, winnerElo: number, loserElo: number, winnerTimeMs: number, loserTimeMs: number }} race
 * @returns {number}
 */
export function computeWinnerPayout({
  winnerLevel,
  difficulty,
  winnerElo,
  loserElo,
  winnerTimeMs,
  loserTimeMs,
}) {
  const levelBonus = Math.floor(winnerLevel / 2);
  const difficultyBonus = Math.floor(difficulty / 2);
  const upsetBonus = Math.max(0, Math.floor((loserElo - winnerElo) / 100));
  const gap = Math.abs(winnerTimeMs - loserTimeMs) * 100;
  const fastest = Math.min(winnerTimeMs, loserTimeMs);
  let dominance = 0;
  if (fastest > 0 && gap > 40 * fastest) dominance = 5;
  else if (fastest > 0 && gap > 20 * fastest) dominance = 2;
  return 3 + levelBonus + difficultyBonus + upsetBonus + dominance;
}

/**
 * Loser payout in Volts (SPEC.md 2.3): 1 + floor(L_loser / 4).
 * @param {{ loserLevel: number }} race
 * @returns {number}
 */
export function computeLoserPayout({ loserLevel }) {
  return 1 + Math.floor(loserLevel / 4);
}

/**
 * Standard ELO update with K-factor 32 by default.
 * @param {number} winnerElo
 * @param {number} loserElo
 * @param {number} [kFactor=32]
 * @returns {{ newWinnerElo: number, newLoserElo: number }}
 */
export function calculateNewElo(winnerElo, loserElo, kFactor = 32) {
  const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const expectedLoser = 1 - expectedWinner;
  const newWinnerElo = Math.round(winnerElo + kFactor * (1 - expectedWinner));
  const newLoserElo = Math.round(loserElo + kFactor * (0 - expectedLoser));
  return { newWinnerElo, newLoserElo };
}

/**
 * Validate a proposed stat allocation against all game rules.
 * Checks: no stat decreases below the drone's current value, no stat exceeds
 * the per-level cap, total stat sum stays within TSB, total cost is affordable
 * out of the supplied player balance.
 *
 * Accepts either snake_case (API request shape) or camelCase (Drizzle shape)
 * keys on both `drone` and `proposedStats`.
 *
 * April 2026: allocation cost is now paid from the player's single
 * `users.points` wallet. Pass the player's current balance as
 * `config.availablePoints`. For backwards compatibility this falls back to
 * `drone.unspentPoints`, but call sites should be migrated to the explicit
 * player-balance form and not rely on the drone column.
 *
 * @param {Record<string, any>} drone - current drone state (level, 9 stats)
 * @param {Record<string, number>} proposedStats - partial map of new stat values
 * @param {{ tsbBase?: number, tsbPerLevel?: number, statCapBase?: number, statCapPerLevel?: number, availablePoints?: number }} [config]
 * @returns {{ valid: boolean, errors: string[], totalCost: number }}
 */
export function validateStatAllocation(drone, proposedStats, config = {}) {
  const errors = [];
  const current = normaliseStats(drone);
  const proposed = { ...current, ...normaliseStats(proposedStats) };
  const level = drone.level ?? 1;
  const cap = calculatePerStatCap(level, config);
  const tsb = calculateTSB(level, config);

  let totalCost = 0;
  for (const key of STAT_KEYS) {
    const from = current[key] ?? 1;
    const to = proposed[key] ?? from;
    if (to < from) {
      errors.push(`${key} cannot decrease from ${from} to ${to}`);
    }
    if (to > cap) {
      errors.push(`${key} (${to}) exceeds level ${level} cap of ${cap}`);
    }
    totalCost += calculateTotalUpgradeCost(from, to);
  }

  const proposedSum = STAT_KEYS.reduce((a, k) => a + (proposed[k] ?? 0), 0);
  if (proposedSum > tsb) {
    errors.push(`Stat sum ${proposedSum} exceeds Total Stat Budget ${tsb} for level ${level}`);
  }

  const available = config.availablePoints ?? drone.unspentPoints ?? drone.unspent_points ?? 0;
  if (totalCost > available) {
    errors.push(`Cost ${totalCost} exceeds available points ${available}`);
  }

  return { valid: errors.length === 0, errors, totalCost };
}

/**
 * Given a drone's stats, return which environmental conditions it performs
 * best, worst, and average in. Used by the drone management screen's
 * "Performance Summary" panel.
 *
 * Thresholds scale with the drone's level when supplied: optimal is 60%
 * of the per-stat cap, low is 25%. So a LV5 drone (cap 32) reads optimal
 * at 19 and low at 8; a LV20 drone (cap 100) reads optimal at 60 and low
 * at 25. When `level` is omitted, falls back to legacy fixed thresholds
 * 40 / 15 to preserve existing call sites that pass only stats.
 *
 * @param {Record<string, number>} droneStats - either case convention accepted
 * @param {number} [level] - drone level; when present, thresholds scale to its cap
 * @returns {{ optimal: string[], moderate: string[], poor: string[] }}
 */
export function analyzeDronePerformance(droneStats, level) {
  const s = normaliseStats(droneStats);

  const scores = [
    { name: 'Clear Day', score: (s.speed + s.turning + s.acceleration) / 3 },
    { name: 'Night Racing', score: s.nightVision },
    { name: 'Rain', score: s.rainHandling },
    { name: 'Heavy Wind', score: s.windResistance },
    { name: 'Long Tracks', score: s.batteryCapacity },
    { name: 'Technical Turns', score: (s.turning + s.durability) / 2 },
    { name: 'Straight Lines', score: (s.speed + s.acceleration) / 2 },
    { name: 'Close Finishes', score: s.consistency },
  ];

  let optimalThreshold;
  let lowThreshold;
  if (level != null && Number.isFinite(level)) {
    const cap = calculatePerStatCap(level);
    optimalThreshold = Math.floor(cap * 0.6);
    lowThreshold = Math.floor(cap * 0.25);
  } else {
    optimalThreshold = 40;
    lowThreshold = 15;
  }

  const optimal = [];
  const moderate = [];
  const poor = [];

  for (const { name, score } of scores) {
    if (score >= optimalThreshold) optimal.push(name);
    else if (score >= lowThreshold) moderate.push(name);
    else poor.push(name);
  }

  return { optimal, moderate, poor };
}
