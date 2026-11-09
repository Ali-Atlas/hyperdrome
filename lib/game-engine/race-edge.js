/**
 * What a matchup looks like before it runs (SPEC.md 11): the favorite and its win probability from
 * ELO, each side's Strengths and Gaps, and each side's edge on this race's track and conditions.
 * Pure, so the race page's matchup view and the dashboard's Next Race panel cannot disagree.
 */

import { raceDrone } from './mods.js';
import { specialFit, statWeights } from './mod-fit.js';
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
 * The favorite of a matchup from ELO alone: `prob` is the favorite's win probability, and on a dead
 * heat the left side is the favorite.
 * @template {{ eloRating?: number }} T
 * @param {T} left
 * @param {T} right
 * @returns {{ viewer: T, opponent: T, viewerElo: number, oppElo: number, prob: number }}
 */
export function computeRaceEdge(left, right) {
  const lElo = left?.eloRating ?? 1000;
  const rElo = right?.eloRating ?? 1000;
  const leftProb = 1 / (1 + Math.pow(10, (rElo - lElo) / 400));
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
