/**
 * Mod fit score (SPEC.md 10): how well a mod suits one race, from the track's straights and turns
 * mix and the conditions. Pure; the AI teams rank their mods with it.
 */

import { SEGMENT_SUBTYPES } from './race-simulator.js';
import {
  SPECIAL_PHANTOM_DRIVE,
  SPECIAL_QUANTUM_SYNC,
  SPECIAL_STORM_RIDER,
  STAT_KEYS,
} from './templates.js';

/** @typedef {import('./templates.js').StatKey} StatKey */
/** @typedef {import('./templates.js').ModTemplate} ModTemplate */

/**
 * @typedef {object} FitRace
 * @property {{ straights: number, turns: number }} track
 * @property {string} weather one of WEATHER
 * @property {string} timeOfDay one of TIME_OF_DAY
 */

/** Weight added to the stat a condition tests. */
export const CONDITION_WEIGHT = 0.5;
/** Phantom Drive (no battery fade on lap 1) helps in every race. */
export const PHANTOM_DRIVE_FIT = 2;
/** Quantum Sync (less noise on turns) counts when turns outnumber straights. */
export const QUANTUM_SYNC_FIT = 2;
/** Storm Rider (softer condition penalties) counts when a condition applies. */
export const STORM_RIDER_FIT = 3;

/** Fit scores are rounded to this many decimals, so equal scores compare equal. */
const DECIMALS = 6;

/** @param {number} x */
const round = (x) => Math.round(x * 10 ** DECIMALS) / 10 ** DECIMALS;

/**
 * A subtype's stat weights as a lookup.
 * @param {string} subtype
 * @returns {Partial<Record<StatKey, number>>}
 */
const biasOf = (subtype) => Object.fromEntries(SEGMENT_SUBTYPES[subtype].statBias);

const STRAIGHT_WEIGHTS = biasOf('standard_str');
const TURN_WEIGHTS = biasOf('standard_turn');

/**
 * The share of a track's segments that are straights.
 * @param {{ straights: number, turns: number }} track
 * @returns {number} 0 to 1
 */
export function trackMix(track) {
  return track.straights / (track.straights + track.turns);
}

/**
 * The stat a race's conditions test, each with `CONDITION_WEIGHT`: rainHandling in rain or
 * heavy_rain, nightVision at night or in fog or haze, windResistance in wind.
 * @param {string} weather
 * @param {string} timeOfDay
 * @returns {StatKey[]}
 */
export function conditionStats(weather, timeOfDay) {
  /** @type {StatKey[]} */
  const stats = [];
  if (weather === 'rain' || weather === 'heavy_rain') stats.push('rainHandling');
  if (timeOfDay === 'night' || weather === 'fog' || weather === 'haze') stats.push('nightVision');
  if (weather === 'wind') stats.push('windResistance');
  return stats;
}

/**
 * Weight of every stat in a race: `mix * straightWeight + (1 - mix) * turnWeight` from the
 * standard straight and standard turn subtypes, plus the condition weight.
 * @param {FitRace} race
 * @returns {Record<StatKey, number>}
 */
export function statWeights({ track, weather, timeOfDay }) {
  const mix = trackMix(track);
  const tested = conditionStats(weather, timeOfDay);
  return /** @type {Record<StatKey, number>} */ (
    Object.fromEntries(
      STAT_KEYS.map((stat) => [
        stat,
        mix * (STRAIGHT_WEIGHTS[stat] ?? 0) +
          (1 - mix) * (TURN_WEIGHTS[stat] ?? 0) +
          (tested.includes(stat) ? CONDITION_WEIGHT : 0),
      ])
    )
  );
}

/**
 * What a legendary special is worth in a race, before its penalty.
 * @param {ModTemplate['special']} special
 * @param {FitRace} race
 * @returns {number}
 */
function specialFit(special, race) {
  if (special === SPECIAL_PHANTOM_DRIVE) return PHANTOM_DRIVE_FIT;
  if (special === SPECIAL_QUANTUM_SYNC) return trackMix(race.track) < 0.5 ? QUANTUM_SYNC_FIT : 0;
  if (special === SPECIAL_STORM_RIDER) {
    return conditionStats(race.weather, race.timeOfDay).length > 0 ? STORM_RIDER_FIT : 0;
  }
  return 0;
}

/**
 * Fit of a mod template for a race: `bonusPct * w(bonusStat) - penaltyPct * w(penaltyStat)`; a
 * legendary mod scores its special in place of the bonus term.
 * @param {ModTemplate} template
 * @param {FitRace} race
 * @returns {number} rounded to 6 decimals
 */
export function modFit(template, race) {
  const w = statWeights(race);
  const gain = template.bonusStat
    ? template.bonusPct * w[template.bonusStat]
    : specialFit(template.special, race);
  return round(gain - template.penaltyPct * w[template.penaltyStat]);
}
