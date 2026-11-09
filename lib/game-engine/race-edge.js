/**
 * What a matchup looks like before it runs (SPEC.md 11): the favorite and its win probability from
 * the race simulator, each side's Strengths and Gaps, and each side's edge on this race's track and conditions.
 * Pure, so the race page's matchup view and the dashboard's Next Race panel cannot disagree.
 */

import { raceDrone } from './mods.js';
import { specialFit, statWeights } from './mod-fit.js';
import { simulateRace } from './race-simulator.js';
import { STAT_KEYS } from './templates.js';

/** @typedef {import('./templates.js').StatKey} StatKey */
/** @typedef {import('./mod-fit.js').FitRace} FitRace */
/** @typedef {Record<StatKey, number>} Stats */

/** @type {Readonly<Record<StatKey, string>>} */
export const STAT_LABELS = Object.freeze({
  speed: 'SPD',
  turning: 'TRN',
  acceleration: 'ACC',
  durability: 'DUR',
  nightVision: 'NV',
  batteryCapacity: 'BAT',
  rainHandling: 'RAIN',
  windResistance: 'WIND',
  consistency: 'CST',
});

/**
 * Races simulated for a win probability, as mirrored pairs. 30 to 38 us per race measured in Node
 * on a 36-segment race; at an estimated 5x for a mid-range phone, 200 races take about 38 ms.
 */
export const WIN_SIM_RACES = 200;
/** Matchups kept for re-renders. */
const WIN_CACHE_SIZE = 64;

/** @type {Map<string, number>} */
const winCache = new Map();

/**
 * A side of a matchup: flat stats and the equipped mod's template id.
 * @typedef {Partial<Stats> & { eloRating?: number, modTemplate?: number | null }} MatchupSide
 */

/**
 * The race a matchup runs: the simulator's track fields and the conditions.
 * @typedef {{ track: import('./race-simulator.js').Track, weather: string, timeOfDay: string }} MatchupRace
 */

/** @param {number} i @returns {string} a fixed 32-byte hex seed */
const simSeed = (i) => i.toString(16).padStart(64, '0');

/**
 * The left side's probability of winning this race, from the real race simulator (SPEC.md 5): the
 * sides' effective stats and mods, the track and the conditions, over `WIN_SIM_RACES` fixed seeds.
 * Each seed runs once with each side as drone A, so the simulator's order cannot favor a side and
 * identical drones come to exactly 0.5.
 * @param {MatchupSide} left
 * @param {MatchupSide} right
 * @param {MatchupRace} race
 * @returns {number} 0 to 1
 */
export function winProbability(left, right, race) {
  const droneL = raceDrone(/** @type {Stats} */ (left), left.modTemplate ?? 0);
  const droneR = raceDrone(/** @type {Stats} */ (right), right.modTemplate ?? 0);
  const { track, weather, timeOfDay } = race;
  const key = JSON.stringify([
    droneL,
    droneR,
    track.straights,
    track.turns,
    track.difficulty,
    track.length,
    weather,
    timeOfDay,
  ]);
  const cached = winCache.get(key);
  if (cached !== undefined) return cached;

  let wins = 0;
  for (let i = 0; i < WIN_SIM_RACES / 2; i++) {
    const shared = { seed: simSeed(i), raceId: `edge:${i}`, track, weather, timeOfDay };
    if (simulateRace({ ...shared, droneA: droneL, droneB: droneR }).winner === 'a') wins++;
    if (simulateRace({ ...shared, droneA: droneR, droneB: droneL }).winner === 'b') wins++;
  }
  const probability = wins / WIN_SIM_RACES;
  if (winCache.size >= WIN_CACHE_SIZE) winCache.delete(winCache.keys().next().value ?? '');
  winCache.set(key, probability);
  return probability;
}

/**
 * The favorite of a matchup and its win probability on this race (`winProbability`). On exactly
 * 50% the left side is the favorite. Without a track there is nothing to simulate: 50%.
 * @template {MatchupSide} T
 * @param {T} left
 * @param {T} right
 * @param {MatchupRace | null | undefined} race
 * @returns {{ viewer: T, opponent: T, viewerElo: number, oppElo: number, prob: number }}
 */
export function computeRaceEdge(left, right, race) {
  const lElo = left?.eloRating ?? 1000;
  const rElo = right?.eloRating ?? 1000;
  const leftProb = race?.track ? winProbability(left, right, race) : 0.5;
  if (leftProb >= 0.5) {
    return { viewer: left, opponent: right, viewerElo: lElo, oppElo: rElo, prob: leftProb };
  }
  return { viewer: right, opponent: left, viewerElo: rElo, oppElo: lElo, prob: 1 - leftProb };
}

/**
 * Strengths and Gaps of `viewer` against `opponent`: every stat where it is higher, largest first,
 * and every stat where it is lower, largest first. Ties appear in neither.
 * @param {Partial<Stats>} viewer
 * @param {Partial<Stats>} opponent
 * @returns {{ strengths: { stat: StatKey, delta: number }[], gaps: { stat: StatKey, delta: number }[] }}
 */
export function statDeltas(viewer, opponent) {
  const deltas = STAT_KEYS.map((stat) => ({
    stat,
    delta: (viewer[stat] ?? 0) - (opponent[stat] ?? 0),
  }));
  return {
    strengths: deltas.filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta),
    gaps: deltas.filter((d) => d.delta < 0).sort((a, b) => a.delta - b.delta),
  };
}

/**
 * A drone's score in a race: its effective stats (SPEC.md 2.4, the mod applied) weighted by what
 * this track and these conditions test. A legendary special has no stat bonus, so its fit, which
 * is in percent of a stat, is added as that percent of the drone's mean effective stat.
 * @param {Stats} stats
 * @param {number | null | undefined} modTemplateId
 * @param {FitRace} race
 * @returns {number}
 */
export function trackScore(stats, modTemplateId, race) {
  const effective = raceDrone(stats, modTemplateId ?? 0);
  const weights = statWeights(race);
  const score = STAT_KEYS.reduce((sum, stat) => sum + weights[stat] * effective[stat], 0);
  if (!effective.special) return score;
  const mean = STAT_KEYS.reduce((sum, stat) => sum + effective[stat], 0) / STAT_KEYS.length;
  return score + (specialFit(effective.special, race) / 100) * mean;
}

/**
 * Each side's edge in a race, in weighted stat points to 1 decimal: positive for the side ahead.
 * @param {{ stats: Stats, modTemplate?: number | null }} a
 * @param {{ stats: Stats, modTemplate?: number | null }} b
 * @param {FitRace} race
 * @returns {{ a: number, b: number }}
 */
export function trackEdges(a, b, race) {
  const diff = trackScore(a.stats, a.modTemplate, race) - trackScore(b.stats, b.modTemplate, race);
  const rounded = Math.round(diff * 10) / 10;
  return { a: rounded, b: rounded === 0 ? 0 : -rounded };
}
