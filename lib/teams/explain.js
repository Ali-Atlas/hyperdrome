/**
 * Why an AI team took an action, in one plain sentence (SPEC.md 10, the economy page in 11).
 * Pure: `planNumbers(plan, state)` gives the values the plan was made from (fit, gain, price,
 * points), recomputed from the same state and the same functions `decide` used, and
 * `explainPlan(plan, state)` puts them into a sentence. The teams service stores both with the
 * action it sends.
 */

import { calculateTotalUpgradeCost } from '../game-engine/economy.js';
import { STAT_KEYS, modTemplate } from '../game-engine/templates.js';
import { MAX_UNBOUND_MODS, bestBoundMod, fitOf, maxBuyPrice } from './policy.js';

/** @typedef {import('./policy.js').Plan} Plan */
/** @typedef {import('./policy.js').TeamState} TeamState */
/** @typedef {import('./policy.js').TeamDrone} TeamDrone */
/** @typedef {import('./policy.js').ModRef} ModRef */

/**
 * @typedef {Record<string, string | number | null | Record<string, number>>} PlanNumbers the
 *   values behind a decision: names, fits and gains (6 decimals), prices and Volts; null where the
 *   state has no value
 */

/** @param {number} x */
const round6 = (x) => Math.round(x * 1e6) / 1e6;

/** A fit or gain as the sentence shows it: at most 2 decimals, no trailing zeros. */
const fit = (/** @type {number} */ x) => String(Number(x.toFixed(2)));

/** Whole Volts with thousands separators. */
const volts = (/** @type {number} */ x) => x.toLocaleString('en-US');

/** @param {ModRef | undefined} mod */
const modName = (mod) => (mod ? (modTemplate(mod.template)?.name ?? mod.token) : 'a mod');

/** @param {TeamDrone | undefined} drone @param {string} token */
const droneName = (drone, token) => drone?.name ?? token;

/** `nightVision` -> `night vision` */
const statLabel = (/** @type {string} */ key) =>
  key.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`);

/**
 * The race's track name: the runner passes the full `TRACKS` row (fit needs only its counts).
 * @param {TeamDrone['race'] | undefined} race
 * @returns {string | null}
 */
function trackName(race) {
  if (!race) return null;
  const track = /** @type {{ name?: string }} */ (race.track);
  return track.name ?? null;
}

/**
 * @param {TeamState} state
 * @param {unknown} token
 */
const findDrone = (state, token) => state.drones.find((d) => d.token === token);

/**
 * The values a plan was made from, by step.
 * @param {Plan} plan
 * @param {TeamState} state
 * @returns {PlanNumbers}
 */
export function planNumbers(plan, state) {
  switch (plan.step) {
    case 'equip':
      return equipNumbers(plan, state);
    case 'bind':
      return bindNumbers(plan, state);
    case 'allocate':
      return allocateNumbers(plan, state);
    case 'capsule':
      return capsuleNumbers(plan, state);
    case 'list':
      return listNumbers(plan, state);
    case 'buy':
      return buyNumbers(plan, state);
    default:
      return {};
  }
}

/** @param {Plan} plan @param {TeamState} state @returns {PlanNumbers} */
function equipNumbers(plan, state) {
  const drone = findDrone(state, plan.args.drone);
  const mod = drone?.mods.find((m) => m.token === plan.args.item);
  const previous = drone?.mods.find((m) => m.token === drone.equippedMod);
  const race = drone?.race;
  return {
    drone: droneName(drone, String(plan.args.drone)),
    mod: modName(mod),
    fit: mod && race ? fitOf(mod, race) : null,
    previous: previous ? modName(previous) : null,
    previousFit: previous && race ? fitOf(previous, race) : null,
    track: trackName(race),
    weather: race?.weather ?? null,
    timeOfDay: race?.timeOfDay ?? null,
  };
}

/** @param {Plan} plan @param {TeamState} state @returns {PlanNumbers} */
function bindNumbers(plan, state) {
  const drone = findDrone(state, plan.args.drone);
  const mod = state.freeMods.find((m) => m.token === plan.args.item);
  const race = drone?.race;
  const best = drone && race ? bestBoundMod(drone, race) : null;
  const modFit = mod && race ? fitOf(mod, race) : null;
  return {
    drone: droneName(drone, String(plan.args.drone)),
    mod: modName(mod),
    fit: modFit,
    best: best ? modName(best.mod) : null,
    bestFit: best ? best.fit : null,
    gain: modFit === null ? null : round6(modFit - (best?.fit ?? 0)),
    track: trackName(race),
  };
}

/** @param {Plan} plan @param {TeamState} state @returns {PlanNumbers} */
function allocateNumbers(plan, state) {
  const drone = findDrone(state, plan.args.drone);
  const next = /** @type {number[]} */ (plan.args.stats);
  /** @type {Record<string, number>} */
  const raised = {};
  let points = 0;
  let cost = 0;
  /** @type {string | null} */
  let top = null;
  if (drone) {
    STAT_KEYS.forEach((key, i) => {
      const added = next[i] - drone.stats[i];
      if (added <= 0) return;
      raised[key] = added;
      points += added;
      cost += calculateTotalUpgradeCost(drone.stats[i], next[i]);
      if (top === null || added > raised[top]) top = key;
    });
  }
  return {
    drone: droneName(drone, String(plan.args.drone)),
    points,
    cost,
    topStat: top,
    spare: state.volts - state.reserve,
    raised,
  };
}

/** @param {Plan} plan @param {TeamState} state @returns {PlanNumbers} */
function capsuleNumbers(plan, state) {
  const tier = /** @type {'starter' | 'premium'} */ (plan.args.tier);
  return {
    tier,
    price: state.capsulePrices[tier] ?? null,
    spareMods: state.freeMods.length + state.listedMods,
    keeps: MAX_UNBOUND_MODS,
  };
}

/** @param {Plan} plan @param {TeamState} state @returns {PlanNumbers} */
function listNumbers(plan, state) {
  const mod = state.freeMods.find((m) => m.token === plan.args.token);
  const races = state.drones.flatMap((d) => (d.race ? [d.race] : []));
  return {
    mod: modName(mod),
    price: Number(plan.args.price),
    bestFit: mod && races.length ? Math.max(...races.map((race) => fitOf(mod, race))) : null,
    spareMods: state.freeMods.length,
  };
}

/** @param {Plan} plan @param {TeamState} state @returns {PlanNumbers} */
function buyNumbers(plan, state) {
  const listing = state.market.find((m) => m.token === plan.args.token);
  const template = listing ? modTemplate(listing.template) : null;
  // The drone the mod helps most, as `planBuy` ranked it.
  const ranked = listing
    ? state.drones
        .filter((d) => d.race)
        .map((d) => {
          const race = /** @type {NonNullable<TeamDrone['race']>} */ (d.race);
          const modFit = fitOf(listing, race);
          return {
            drone: d,
            fit: modFit,
            gain: round6(modFit - (bestBoundMod(d, race)?.fit ?? 0)),
            track: trackName(race),
          };
        })
        .sort((a, b) => b.gain - a.gain || a.drone.order - b.drone.order)
    : [];
  const pick = ranked[0];
  return {
    mod: modName(listing),
    price: listing?.price ?? null,
    maxPrice: template ? maxBuyPrice(template.rarity) : null,
    drone: pick ? droneName(pick.drone, pick.drone.token) : null,
    fit: pick?.fit ?? null,
    gain: pick?.gain ?? null,
    track: pick?.track ?? null,
  };
}

/**
 * The plan in one plain sentence built from its own values, e.g. "Listed Grip Pads at 180 Volts:
 * surplus mod, best fit -0.15 for the team's races."
 * @param {Plan} plan
 * @param {TeamState} state
 * @returns {string}
 */
export function explainPlan(plan, state) {
  const n = planNumbers(plan, state);
  const num = (/** @type {string} */ key) => /** @type {number | null} */ (n[key]);
  switch (plan.step) {
    case 'equip': {
      const head = `Equipped ${n.mod} on ${n.drone}`;
      if (num('fit') === null) return `${head}.`;
      const where = n.track ? ` for ${n.track}` : '';
      const before =
        num('previousFit') === null
          ? 'its best bound mod'
          : `up from ${fit(/** @type {number} */ (num('previousFit')))} with ${n.previous}`;
      return `${head}${where}: fit ${fit(/** @type {number} */ (num('fit')))}, ${before}.`;
    }
    case 'bind': {
      const head = `Bound ${n.mod} to ${n.drone} for good`;
      if (num('fit') === null) return `${head}.`;
      const where = n.track ? ` on ${n.track}` : '';
      const than =
        n.best === null
          ? 'its first mod'
          : `${fit(/** @type {number} */ (num('gain')))} more than ${n.best}`;
      return `${head}: fit ${fit(/** @type {number} */ (num('fit')))}${where}, ${than}.`;
    }
    case 'allocate': {
      const points = /** @type {number} */ (num('points'));
      const head = `Spent ${volts(/** @type {number} */ (num('cost')))} Volts on ${points} stat ${points === 1 ? 'point' : 'points'} for ${n.drone}`;
      return n.topStat ? `${head}, most of them on ${statLabel(String(n.topStat))}.` : `${head}.`;
    }
    case 'capsule': {
      const price =
        num('price') === null ? '' : ` for ${volts(/** @type {number} */ (num('price')))} Volts`;
      const spare = /** @type {number} */ (num('spareMods'));
      return `Opened a ${n.tier} mod capsule${price}: ${spare} spare ${spare === 1 ? 'mod' : 'mods'}, fewer than the ${n.keeps} it keeps.`;
    }
    case 'list': {
      const head = `Listed ${n.mod} at ${volts(/** @type {number} */ (num('price')))} Volts`;
      return num('bestFit') === null
        ? `${head}: surplus mod.`
        : `${head}: surplus mod, best fit ${fit(/** @type {number} */ (num('bestFit')))} for the team's races.`;
    }
    case 'buy': {
      const price =
        num('price') === null ? '' : ` for ${volts(/** @type {number} */ (num('price')))} Volts`;
      const head = `Bought ${n.mod}${price}`;
      if (num('gain') === null) return `${head}.`;
      return `${head} for ${n.drone}: fit ${fit(/** @type {number} */ (num('fit')))} on ${n.track}, ${fit(/** @type {number} */ (num('gain')))} more than its best mod.`;
    }
    default:
      return `${plan.step} ${plan.subject}.`;
  }
}
