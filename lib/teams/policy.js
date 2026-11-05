/**
 * Decision rules of the AI teams (SPEC.md 10). Pure: `decide(state)` returns the one action a
 * team takes in a tick, or null. The steps run in order (equip, allocate, capsule, list, buy) and
 * the first that applies wins. `services/teams.service.js` loads the state and sends the action.
 */

import {
  calculatePerStatCap,
  calculateStatUpgradeCost,
  calculateTSB,
} from '../game-engine/economy.js';
import { modFit } from '../game-engine/mod-fit.js';
import { STAT_KEYS, modTemplate } from '../game-engine/templates.js';

/** @typedef {import('../game-engine/mod-fit.js').FitRace} FitRace */
/** @typedef {import('../game-engine/templates.js').StatKey} StatKey */
/** @typedef {import('../game-engine/templates.js').ModTemplate} ModTemplate */

/** @typedef {{ token: string, template: number }} ModRef a mod token and its template id */

/**
 * @typedef {object} TeamDrone
 * @property {string} token
 * @property {number} level
 * @property {number[]} stats the 9 stats in SPEC.md 2.1 order
 * @property {string | null} equippedMod token of the equipped mod
 * @property {ModRef[]} mods mods bound to the drone
 * @property {FitRace | null} race the drone's race in this tick's committed matchups
 * @property {number} order index of that matchup (drones without a race sort last)
 */

/**
 * @typedef {object} TeamState
 * @property {number} volts the team's Volt balance
 * @property {number} reserve Volts the team never spends below
 * @property {number} perTxCap the on-chain cap on one Volt debit
 * @property {number} dayLeft what is left of the on-chain cap on the day's Volt debits
 * @property {{ starter: number, premium: number }} capsulePrices mod capsule prices
 * @property {Record<StatKey, number>} weights persona weights
 * @property {TeamDrone[]} drones
 * @property {ModRef[]} freeMods unbound mods that are not listed
 * @property {number} listedMods the team's own active mod listings
 * @property {(ModRef & { price: number })[]} market active mod listings of other sellers
 */

/**
 * @typedef {object} Plan
 * @property {'equip' | 'allocate' | 'capsule' | 'list' | 'buy'} step
 * @property {string} subject what the step acts on: a token id, or the capsule tier
 * @property {string} method the contract method
 * @property {Record<string, unknown>} args its args, without `seq` (capsule: `{ tier }`, the tier name)
 */

/** Base price per rarity; teams list at 1.2x and buy at or under 0.8x. */
export const RARITY_BASE_PRICE = Object.freeze({
  common: 150,
  rare: 800,
  epic: 3_500,
  legendary: 12_000,
});
/** A team opens capsules while it holds fewer unbound mods than this (its listings included). */
export const MAX_UNBOUND_MODS = 6;
/** A team lists a mod when it holds at least this many unbound, unlisted mods. */
export const LIST_AT_UNBOUND = 3;
/** A listed mod is bought when it beats a drone's best bound mod by at least this much fit. */
export const BUY_FIT_GAIN = 2;
/** Volts above the reserve at which a team opens a premium capsule. */
export const PREMIUM_SPENDABLE = 20_000;

/** @param {ModTemplate['rarity']} rarity @returns {number} 1.2x the base price */
export const listPrice = (rarity) => (RARITY_BASE_PRICE[rarity] * 6) / 5;
/** @param {ModTemplate['rarity']} rarity @returns {number} 0.8x the base price */
export const maxBuyPrice = (rarity) => (RARITY_BASE_PRICE[rarity] * 4) / 5;

/** @param {string} token `m:12` -> 12 */
const tokenNumber = (token) => Number(token.split(':')[1]);
/** @param {number} x */
const round6 = (x) => Math.round(x * 1e6) / 1e6;

/**
 * Volts a team may put into one action: what it holds above the reserve, at most the
 * per-transaction cap and what is left of the day's cap.
 * @param {TeamState} state
 */
const spendable = (state) => Math.min(state.volts - state.reserve, state.perTxCap, state.dayLeft);

/** Milliseconds in the contract's cap day (SPEC.md 2.10). */
const DAY_MS = 86_400_000;

/**
 * A team's caps from its `get_team` budget: the per-transaction cap and what the day's cap still
 * allows. The contract resets `spent` when `day` (block time / 86,400,000) changes; a team with no
 * budget row has zero caps.
 * @param {{ per_tx: string, per_day: string, spent: string, day: number } | null} budget
 * @param {number} nowMs
 * @returns {{ perTxCap: number, dayLeft: number }}
 */
export function teamCaps(budget, nowMs) {
  if (!budget) return { perTxCap: 0, dayLeft: 0 };
  const spent = budget.day === Math.floor(nowMs / DAY_MS) ? Number(budget.spent) : 0;
  return {
    perTxCap: Number(budget.per_tx),
    dayLeft: Math.max(0, Number(budget.per_day) - spent),
  };
}

/**
 * Raise stats one point at a time along the persona weights. Each point goes to the stat furthest
 * below its share of the level's budget (`weight / total * (TSB - 9)` points above 1); ties go to
 * the larger weight, then to SPEC.md 2.1 order. A stat at cap(L) is skipped, as is a point whose
 * cost (`1 + floor(stat / 10)`) no longer fits `budget`. Stops at TSB(L) or when no point fits.
 * @param {{ stats: number[], level: number, weights: Record<StatKey, number>, budget?: number }} input `budget` in Volts (default: no limit)
 * @returns {{ stats: number[], points: number, cost: number }}
 */
export function allocateAlongPersona({ stats, level, weights, budget = Infinity }) {
  const cap = calculatePerStatCap(level);
  const next = [...stats];
  const total = STAT_KEYS.reduce((sum, key) => sum + (weights[key] ?? 0), 0) || 1;
  const share = calculateTSB(level) - STAT_KEYS.length;
  let headroom = calculateTSB(level) - next.reduce((a, b) => a + b, 0);
  let points = 0;
  let cost = 0;
  while (headroom > 0) {
    const order = STAT_KEYS.map((key, i) => ({
      i,
      weight: weights[key] ?? 0,
      // The deficit times `total`, so the comparison stays in integers.
      deficit: (weights[key] ?? 0) * share - (next[i] - 1) * total,
    }))
      .filter((s) => next[s.i] < cap)
      .sort((a, b) => b.deficit - a.deficit || b.weight - a.weight || a.i - b.i);
    const pick = order.find((s) => cost + calculateStatUpgradeCost(next[s.i]) <= budget);
    if (!pick) break;
    cost += calculateStatUpgradeCost(next[pick.i]);
    next[pick.i] += 1;
    points += 1;
    headroom -= 1;
  }
  return { stats: next, points, cost };
}

/**
 * Fit of a mod for a race (0 for an unknown template).
 * @param {ModRef} mod
 * @param {FitRace} race
 */
function fitOf(mod, race) {
  const template = modTemplate(mod.template);
  return template ? modFit(template, race) : 0;
}

/**
 * The drone's best bound mod for its race: highest fit, then the equipped one, then the lower
 * token number.
 * @param {TeamDrone} drone
 * @param {FitRace} race
 * @returns {{ mod: ModRef, fit: number } | null}
 */
export function bestBoundMod(drone, race) {
  const ranked = drone.mods
    .map((mod) => ({ mod, fit: fitOf(mod, race) }))
    .sort(
      (a, b) =>
        b.fit - a.fit ||
        Number(b.mod.token === drone.equippedMod) - Number(a.mod.token === drone.equippedMod) ||
        tokenNumber(a.mod.token) - tokenNumber(b.mod.token)
    );
  return ranked[0] ?? null;
}

/**
 * The team's drones that race this tick, in matchup order.
 * @param {TeamState} state
 * @returns {(TeamDrone & { race: FitRace })[]}
 */
function racing(state) {
  return /** @type {(TeamDrone & { race: FitRace })[]} */ (
    state.drones.filter((d) => d.race).sort((a, b) => a.order - b.order)
  );
}

/**
 * (a) Equip: the first racing drone whose best bound mod is not the equipped one.
 * @param {TeamState} state
 * @returns {Plan | null}
 */
export function planEquip(state) {
  for (const drone of racing(state)) {
    const best = bestBoundMod(drone, drone.race);
    if (best && best.mod.token !== drone.equippedMod) {
      return {
        step: 'equip',
        subject: drone.token,
        method: 'equip',
        args: { drone: drone.token, item: best.mod.token, kind: 'mod' },
      };
    }
  }
  return null;
}

/**
 * (b) Allocate: the first drone (highest level first) with TSB headroom, every point the Volts
 * above the reserve pay for.
 * @param {TeamState} state
 * @returns {Plan | null}
 */
export function planAllocate(state) {
  const budget = spendable(state);
  if (budget <= 0) return null;
  const drones = [...state.drones].sort(
    (a, b) => b.level - a.level || tokenNumber(a.token) - tokenNumber(b.token)
  );
  for (const drone of drones) {
    const plan = allocateAlongPersona({ ...drone, weights: state.weights, budget });
    if (plan.points > 0) {
      return {
        step: 'allocate',
        subject: drone.token,
        method: 'allocate_stats',
        args: { drone: drone.token, stats: plan.stats },
      };
    }
  }
  return null;
}

/**
 * (c) Capsule: a starter mod capsule while the team holds fewer than 6 unbound mods (its own
 * listings count), premium from 20,000 spare Volts when its price fits the caps.
 * @param {TeamState} state
 * @returns {Plan | null}
 */
export function planCapsule(state) {
  const budget = spendable(state);
  const { starter, premium } = state.capsulePrices;
  if (state.freeMods.length + state.listedMods >= MAX_UNBOUND_MODS || budget < starter) return null;
  const spare = state.volts - state.reserve;
  const tier = spare >= PREMIUM_SPENDABLE && premium <= budget ? 'premium' : 'starter';
  return { step: 'capsule', subject: tier, method: 'open_pack', args: { tier } };
}

/**
 * (d) List: with 3 or more unbound, unlisted mods, the one that fits the team's races this tick
 * least (ties: the cheaper rarity, then the lower token number), at 1.2x its rarity base price.
 * @param {TeamState} state
 * @returns {Plan | null}
 */
export function planList(state) {
  const races = racing(state).map((d) => d.race);
  if (state.freeMods.length < LIST_AT_UNBOUND || races.length === 0) return null;
  const ranked = state.freeMods
    .map((mod) => ({
      mod,
      template: modTemplate(mod.template),
      fit: Math.max(...races.map((race) => fitOf(mod, race))),
    }))
    .filter((x) => x.template)
    .sort(
      (a, b) =>
        a.fit - b.fit ||
        price(a.template) - price(b.template) ||
        tokenNumber(a.mod.token) - tokenNumber(b.mod.token)
    );
  const lowest = ranked[0];
  if (!lowest) return null;
  return {
    step: 'list',
    subject: lowest.mod.token,
    method: 'list',
    args: { token: lowest.mod.token, price: String(listPrice(rarityOf(lowest.template))) },
  };
}

/** @param {ModTemplate | null} template */
const rarityOf = (template) => /** @type {ModTemplate} */ (template).rarity;
/** @param {ModTemplate | null} template */
const price = (template) => RARITY_BASE_PRICE[rarityOf(template)];

/**
 * (e) Buy: a listed mod of another seller whose fit for one of the team's racing drones beats
 * that drone's best bound mod (0 with none bound) by 2 or more, priced at or under 0.8x its rarity
 * base and within the Volts above the reserve and the per-transaction cap. The largest gain wins
 * (ties: the lower price, then the lower token number).
 * @param {TeamState} state
 * @returns {Plan | null}
 */
export function planBuy(state) {
  const budget = spendable(state);
  const drones = racing(state);
  const ranked = state.market
    .map((listing) => {
      const template = modTemplate(listing.template);
      const gains = drones.map((drone) =>
        round6(fitOf(listing, drone.race) - (bestBoundMod(drone, drone.race)?.fit ?? 0))
      );
      return { listing, template, gain: Math.max(-Infinity, ...gains) };
    })
    .filter(
      (x) =>
        x.template &&
        x.gain >= BUY_FIT_GAIN &&
        x.listing.price <= maxBuyPrice(x.template.rarity) &&
        x.listing.price <= budget
    )
    .sort(
      (a, b) =>
        b.gain - a.gain ||
        a.listing.price - b.listing.price ||
        tokenNumber(a.listing.token) - tokenNumber(b.listing.token)
    );
  const pick = ranked[0];
  if (!pick) return null;
  return {
    step: 'buy',
    subject: pick.listing.token,
    method: 'buy',
    args: { token: pick.listing.token },
  };
}

/** The steps in the order a team tries them. */
export const STEPS = Object.freeze([planEquip, planAllocate, planCapsule, planList, planBuy]);

/**
 * The plan as one comparable string (args are flat; key order does not matter).
 * @param {Plan} plan
 */
const planKey = (plan) =>
  JSON.stringify([
    plan.step,
    plan.subject,
    Object.entries(plan.args).sort(([a], [b]) => (a < b ? -1 : 1)),
  ]);

/**
 * True when two plans are the same step on the same subject with the same args.
 * @param {Plan} a
 * @param {Plan} b
 */
export const samePlan = (a, b) => planKey(a) === planKey(b);

/**
 * The one action the team takes this tick: the first step that applies, or null. A plan equal to
 * `refused` (the team's latest action, when the chain refused it) is passed over, so a refusal the
 * state does not explain cannot repeat every tick and keep the later steps from running.
 * @param {TeamState} state
 * @param {Plan | null} [refused]
 * @returns {Plan | null}
 */
export function decide(state, refused = null) {
  for (const step of STEPS) {
    const plan = step(state);
    if (plan && !(refused && samePlan(plan, refused))) return plan;
  }
  return null;
}
