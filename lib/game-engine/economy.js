/**
 * Drone Manager — pure game economy functions.
 *
 * Every function is side-effect free and accepts a `config` object instead
 * of reading from the database, so the same math runs server-side (in API
 * routes / race loop) and client-side (in the stat editor for instant
 * feedback) with the same inputs.
 */

/** camelCase stat keys, canonical order. */
export const STAT_KEYS = [
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
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (STAT_KEYS.includes(k)) {
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
 * XP required to advance from the given level to the next.
 * Formula: `xpMultiplier * level * level`.
 * @param {number} level
 * @param {{ xpMultiplier?: number }} [config]
 * @returns {number}
 */
export function calculateXPToNextLevel(level, config = {}) {
  const { xpMultiplier = 300 } = config;
  return xpMultiplier * level * level;
}

/**
 * Points awarded to the race winner.
 * Formula: `basePoints + trackDifficulty + max(0, floor((loserElo - winnerElo) / 100))`.
 * The upset bonus only fires when the winner was rated below the loser.
 * @param {number} trackDifficulty
 * @param {number} winnerElo
 * @param {number} loserElo
 * @param {{ basePoints?: number }} [config]
 * @returns {number}
 */
export function calculateRacePoints(trackDifficulty, winnerElo, loserElo, config = {}) {
  const { basePoints = 3 } = config;
  const upsetBonus = Math.max(0, Math.floor((loserElo - winnerElo) / 100));
  return basePoints + trackDifficulty + upsetBonus;
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
 * the per-level cap, total stat sum stays within TSB, total cost is affordable.
 *
 * Accepts either snake_case (API request shape) or camelCase (Drizzle shape)
 * keys on both `drone` and `proposedStats`.
 *
 * @param {Record<string, any>} drone - current drone state (level, unspent points, 9 stats)
 * @param {Record<string, number>} proposedStats - partial map of new stat values
 * @param {object} [config] - optional TSB/cap config overrides
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
    errors.push(
      `Stat sum ${proposedSum} exceeds Total Stat Budget ${tsb} for level ${level}`,
    );
  }

  const available = drone.unspentPoints ?? drone.unspent_points ?? 0;
  if (totalCost > available) {
    errors.push(
      `Cost ${totalCost} exceeds available points ${available}`,
    );
  }

  return { valid: errors.length === 0, errors, totalCost };
}

/**
 * Given a drone's stats, return which environmental conditions it performs
 * best, worst, and average in. Used by the drone management screen's
 * "Performance Summary" panel.
 *
 * Scores are computed from weighted stat combos and compared against
 * threshold bands. Returns three disjoint lists of condition labels.
 *
 * @param {Record<string, number>} droneStats - either case convention accepted
 * @returns {{ optimal: string[], moderate: string[], poor: string[] }}
 */
export function analyzeDronePerformance(droneStats) {
  const s = normaliseStats(droneStats);

  const scores = [
    { name: 'Clear Day',       score: (s.speed + s.turning + s.acceleration) / 3 },
    { name: 'Night Racing',    score: s.nightVision },
    { name: 'Rain',            score: s.rainHandling },
    { name: 'Heavy Wind',      score: s.windResistance },
    { name: 'Long Tracks',     score: s.batteryCapacity },
    { name: 'Technical Turns', score: (s.turning + s.durability) / 2 },
    { name: 'Straight Lines',  score: (s.speed + s.acceleration) / 2 },
    { name: 'Close Finishes',  score: s.consistency },
  ];

  const optimal = [];
  const moderate = [];
  const poor = [];

  for (const { name, score } of scores) {
    if (score >= 40) optimal.push(name);
    else if (score >= 15) moderate.push(name);
    else poor.push(name);
  }

  return { optimal, moderate, poor };
}
