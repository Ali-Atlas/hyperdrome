/**
 * Mod effects (SPEC.md 2.4 and 2.5). A mod changes the raw stats before scoring by a percent of the
 * stat; a legendary mod carries a special the simulator applies instead of a bonus stat.
 */

import { STAT_KEYS, modTemplate } from './templates.js';

/** @typedef {import('./templates.js').Stats} Stats */
/** @typedef {import('./templates.js').ModTemplate} ModTemplate */
/** @typedef {import('./templates.js').Special} Special */

const STAT_MIN = 1;
const STAT_MAX = 100;

/**
 * clamp(round(stat * (100 + pct) / 100), 1, 100), with `pct` negative for a penalty. Integer math,
 * rounding half up, the same as the contract's `apply_pct`.
 * @param {number} stat
 * @param {number} pct
 * @returns {number}
 */
export function applyPct(stat, pct) {
  const rounded = Math.floor((stat * (100 + pct) + 50) / 100);
  return Math.min(STAT_MAX, Math.max(STAT_MIN, rounded));
}

/**
 * Stats after a mod template's bonus and penalty. A legendary mod applies only its penalty here;
 * its special is passed to the simulator separately.
 * @param {Stats} stats
 * @param {ModTemplate | null} template
 * @returns {Stats}
 */
export function applyMod(stats, template) {
  const out = /** @type {Stats} */ ({ ...stats });
  if (!template) return out;
  if (template.bonusStat) {
    out[template.bonusStat] = applyPct(out[template.bonusStat], template.bonusPct);
  }
  out[template.penaltyStat] = applyPct(out[template.penaltyStat], -template.penaltyPct);
  return out;
}

/**
 * @typedef {Stats & { special: Special | null }} RaceDrone
 * Effective stats plus the equipped mod's special: the drone shape `simulateRace` takes.
 */

/**
 * The race-ready drone for raw stats and an equipped mod template id (0 = none).
 * @param {Stats} stats
 * @param {number} modTemplateId
 * @returns {RaceDrone}
 */
export function raceDrone(stats, modTemplateId) {
  const template = modTemplate(modTemplateId);
  const effective = applyMod(pickStats(stats), template);
  return { ...effective, special: template?.special ?? null };
}

/**
 * Only the 9 stat keys of `source`.
 * @param {Stats} source
 * @returns {Stats}
 */
function pickStats(source) {
  return /** @type {Stats} */ (Object.fromEntries(STAT_KEYS.map((k) => [k, source[k]])));
}

/**
 * Storm Rider: a condition multiplier m below 1 becomes 1 - (1 - m) / 2.
 * @param {number} m
 * @param {Special | null} special
 * @returns {number}
 */
export function conditionMultiplier(m, special) {
  return special === 'storm_rider' && m < 1 ? 1 - (1 - m) / 2 : m;
}

/**
 * Phantom Drive: no battery fade on lap 1.
 * @param {number} lap 1-based
 * @param {Special | null} special
 * @returns {boolean}
 */
export function batteryFadeApplies(lap, special) {
  return !(special === 'phantom_drive' && lap === 1);
}

/**
 * Noise damping factor: 1 - consistency/100; Quantum Sync uses 1 - 2 * consistency/100 (at least 0)
 * on turn segments.
 * @param {number} consistency
 * @param {'straight' | 'turn'} type
 * @param {Special | null} special
 * @returns {number}
 */
export function noiseFactor(consistency, type, special) {
  if (special === 'quantum_sync' && type === 'turn')
    return Math.max(0, 1 - (2 * consistency) / 100);
  return 1 - consistency / 100;
}
