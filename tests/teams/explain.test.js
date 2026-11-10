/**
 * The reason a team decision gives (SPEC.md 10): one sentence built from the plan's own values.
 * Fits are worked by hand on The Grid (4 straights, 4 turns, mix 0.5): w(speed) = w(turning) =
 * w(acceleration) = 0.25, w(durability) = 0.15, and rain adds 0.5 to rain_handling.
 */
import { describe, expect, it } from 'vitest';
import { STAT_KEYS } from '../../lib/game-engine/templates.js';
import { TRACKS } from '../../lib/game-engine/tracks.js';
import { explainPlan, planNumbers } from '../../lib/teams/explain.js';
import {
  decide,
  planAllocate,
  planBind,
  planCapsule,
  planList,
  planBuy,
} from '../../lib/teams/policy.js';

const GRID = TRACKS[3];
const clear = { track: GRID, weather: 'clear', timeOfDay: 'day' };
const rain = { track: GRID, weather: 'rain', timeOfDay: 'day' };

/** Templates: 2 Grip Pads (0.25 on a clear Grid), 4 Shock Absorber (0.05), 12 Grip Coating (0.5), 13 Storm Plating (1.5 in rain). */
const mod = (/** @type {number} */ n, /** @type {number} */ template) => ({
  token: `m:${n}`,
  template,
});

/** @typedef {import('../../lib/teams/policy.js').TeamState} TeamState */
/** @typedef {import('../../lib/teams/policy.js').Plan} Plan */

/** A plan the test expects to exist. */
function must(/** @type {Plan | null} */ plan) {
  if (!plan) throw new Error('expected a plan');
  return plan;
}

/**
 * @param {Partial<TeamState>} over
 * @returns {TeamState}
 */
function state(over = {}) {
  return {
    volts: 9_000,
    reserve: 5_000,
    perTxCap: 5_000,
    dayLeft: 15_000,
    capsulePrices: { starter: 500, premium: 6_000 },
    weights: /** @type {TeamState['weights']} */ (
      Object.fromEntries(STAT_KEYS.map((k) => [k, k === 'speed' ? 30 : 10]))
    ),
    drones: [
      {
        token: 'd:7',
        name: 'HAIRPIN-H3',
        level: 8,
        stats: STAT_KEYS.map(() => 5),
        equippedMod: 'm:1',
        mods: [mod(1, 4), mod(2, 12)],
        race: clear,
        order: 0,
      },
    ],
    freeMods: [],
    listedMods: 0,
    market: [],
    ...over,
  };
}

describe('explainPlan (SPEC 10)', () => {
  it('equip: the new fit and the one it replaces', () => {
    const s = state();
    const plan = must(decide(s));
    expect(plan.step).toBe('equip');
    expect(explainPlan(plan, s)).toBe(
      'Equipped Grip Coating on HAIRPIN-H3 for The Grid: fit 0.5, up from 0.05 with Shock Absorber.'
    );
    expect(planNumbers(plan, s)).toMatchObject({
      fit: 0.5,
      previous: 'Shock Absorber',
      previousFit: 0.05,
      weather: 'clear',
    });
  });

  it('equip on a drone with no mod on', () => {
    const s = state();
    s.drones[0].equippedMod = null;
    expect(explainPlan(must(decide(s)), s)).toBe(
      'Equipped Grip Coating on HAIRPIN-H3 for The Grid: fit 0.5, its best bound mod.'
    );
  });

  it('bind: the gain over the best bound mod, and a first mod', () => {
    const s = state({ freeMods: [mod(9, 13)] });
    s.drones[0].race = rain;
    s.drones[0].equippedMod = 'm:2';
    const plan = must(planBind(s));
    // Storm Plating 1.5 in rain; Grip Coating stays 0.5.
    expect(explainPlan(plan, s)).toBe(
      'Bound Storm Plating to HAIRPIN-H3 for good: fit 1.5 on The Grid, 1 more than Grip Coating.'
    );
    expect(planNumbers(plan, s)).toMatchObject({ gain: 1, bestFit: 0.5 });

    s.drones[0].mods = [];
    expect(explainPlan(must(planBind(s)), s)).toBe(
      'Bound Storm Plating to HAIRPIN-H3 for good: fit 1.5 on The Grid, its first mod.'
    );
  });

  it('allocate: the Volts, the points and the stat that got most', () => {
    const s = state({ volts: 5_040 });
    s.drones[0].race = null;
    const plan = must(planAllocate(s));
    const n = planNumbers(plan, s);
    // 40 spare Volts take speed from 5 to 25: 5 points at 1 Volt, 10 at 2 and 5 at 3 (1 + floor(stat / 10)).
    expect(n).toMatchObject({ points: 20, cost: 40, spare: 40, topStat: 'speed' });
    expect(explainPlan(plan, s)).toBe(
      'Spent 40 Volts on 20 stat points for HAIRPIN-H3, most of them on speed.'
    );
  });

  it('capsule: the price and the spare mods', () => {
    const s = state({ freeMods: [mod(9, 2)], listedMods: 1 });
    expect(explainPlan(must(planCapsule(s)), s)).toBe(
      'Opened a starter mod capsule for 500 Volts: 2 spare mods, fewer than the 6 it keeps.'
    );
  });

  it('list: the price and the best fit of the mod it lets go', () => {
    const s = state({ freeMods: [mod(9, 12), mod(10, 4), mod(11, 2)] });
    const plan = must(planList(s));
    // Shock Absorber fits least (0.05) and lists at 1.2x the common base of 150.
    expect(explainPlan(plan, s)).toBe(
      "Listed Shock Absorber at 180 Volts: surplus mod, best fit 0.05 for the team's races."
    );
  });

  it('list: a negative fit keeps its sign', () => {
    // Streamline Plate (speed +2, turning -1) on Helix (2 straights, 6 turns): mix 0.25.
    // w(speed) = 0.125, w(turning) = 0.375: 0.25 - 0.375 = -0.125.
    const s = state({ freeMods: [mod(9, 1), mod(10, 12), mod(11, 12)] });
    s.drones[0].race = { track: TRACKS[9], weather: 'clear', timeOfDay: 'day' };
    expect(explainPlan(must(planList(s)), s)).toBe(
      "Listed Streamline Plate at 180 Volts: surplus mod, best fit -0.13 for the team's races."
    );
  });

  it('buy: the price, the drone it is for and the gain', () => {
    // Typhoon Module (epic, rain +8, speed -5) in rain: 8 * 0.5 - 5 * 0.25 = 2.75, a gain of 2.25
    // over Grip Coating's 0.5; 2,800 is the most a team pays for an epic (0.8x 3,500).
    const s = state({ market: [{ token: 'm:40', template: 21, price: 2_800 }] });
    s.drones[0].race = rain;
    s.drones[0].equippedMod = 'm:2';
    const plan = must(planBuy(s));
    expect(plan.subject).toBe('m:40');
    expect(explainPlan(plan, s)).toBe(
      'Bought Typhoon Module for 2,800 Volts for HAIRPIN-H3: fit 2.75 on The Grid, 2.25 more than its best mod.'
    );
    expect(planNumbers(plan, s)).toMatchObject({ maxPrice: 2_800, gain: 2.25 });
  });

  it('a plan whose subject the state no longer has still gives a sentence', () => {
    const s = state();
    expect(
      explainPlan(
        {
          step: 'equip',
          subject: 'd:99',
          method: 'equip',
          args: { drone: 'd:99', item: 'm:5', kind: 'mod' },
        },
        s
      )
    ).toBe('Equipped a mod on d:99.');
  });
});
