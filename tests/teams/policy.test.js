import { describe, expect, it } from 'vitest';
import {
  calculatePerStatCap,
  calculateTSB,
  calculateTotalUpgradeCost,
} from '../../lib/game-engine/economy.js';
import { skinTemplate } from '../../lib/game-engine/skin-templates.js';
import { STAT_KEYS, modTemplate } from '../../lib/game-engine/templates.js';
import { TEAM_ACTION_NAMESPACE, teamActionId } from '../../lib/teams/action-id.js';
import { teamEconomy } from '../../lib/teams/constants.js';
import {
  allocateAlongPersona,
  decide,
  listPrice,
  maxBuyPrice,
  planBuy,
  planCapsule,
  planEquip,
  planList,
  teamCaps,
} from '../../lib/teams/policy.js';
import { TEAMS, TEAM_DRONE_LEVELS, teamDroneName, teamSlugOf } from '../../lib/teams/roster.js';
import { TEAM_CONSTANTS } from './fake-chain.js';

const ones = () => STAT_KEYS.map(() => 1);
const sum = (/** @type {number[]} */ xs) => xs.reduce((a, b) => a + b, 0);

describe('team roster (SPEC 10)', () => {
  it('has 4 teams with weights that sum to 100, 2 skins and 3 mods of real templates', () => {
    expect(TEAMS.map((t) => t.slug)).toEqual(['vortex', 'nimbus', 'hairpin', 'static']);
    for (const team of TEAMS) {
      expect(Object.keys(team.weights).sort()).toEqual([...STAT_KEYS].sort());
      expect(sum(Object.values(team.weights))).toBe(100);
      expect(team.skins).toHaveLength(2);
      expect(team.mods).toHaveLength(3);
      for (const skin of team.skins) expect(skinTemplate(skin.template)?.rarity).toBe('common');
      for (const mod of team.mods) expect(modTemplate(mod.template)).not.toBeNull();
      for (const item of [...team.skins, ...team.mods]) {
        expect(item.drone).toBeLessThan(TEAM_DRONE_LEVELS.length);
      }
    }
    expect(teamDroneName(TEAMS[0], 2)).toBe('VORTEX-V3');
    expect(teamSlugOf('nimbus.game.hyperdrome.testnet')).toBe('nimbus');
    expect(teamEconomy(TEAM_CONSTANTS)).toEqual({
      startVolts: 20_000,
      perTxCap: 5_000,
      perDayCap: 15_000,
      reserve: 5_000,
      droneLevels: [...TEAM_DRONE_LEVELS],
      capsulePrices: { starter: 1_000, premium: 6_000 },
    });
  });
});

describe('team action ids', () => {
  it('are version 5 uuids of team:slot:step:subject (reference values from Python uuid.uuid5)', () => {
    expect(TEAM_ACTION_NAMESPACE).toBe('748473c1-8cd9-5964-bbcb-d639f3efdf38');
    expect(teamActionId('vortex', 9966100, 'equip', 'd:42')).toBe(
      'cae10c96-0725-5446-bd55-bae43dbaf8ce'
    );
    expect(teamActionId('vortex', 9966100, 'equip', 'd:42')).toBe(
      teamActionId('vortex', 9966100, 'equip', 'd:42')
    );
    expect(teamActionId('vortex', 9966101, 'equip', 'd:42')).not.toBe(
      teamActionId('vortex', 9966100, 'equip', 'd:42')
    );
  });
});

describe('allocation along the persona weights', () => {
  it('fills TSB(L) within cap(L) for every team and level, largest weights highest', () => {
    for (const team of TEAMS) {
      for (const level of TEAM_DRONE_LEVELS) {
        const { stats, points } = allocateAlongPersona({
          stats: ones(),
          level,
          weights: team.weights,
        });
        expect(sum(stats)).toBe(calculateTSB(level));
        expect(points).toBe(calculateTSB(level) - 9);
        expect(Math.max(...stats)).toBeLessThanOrEqual(calculatePerStatCap(level));
        expect(Math.min(...stats)).toBeGreaterThanOrEqual(1);
        const top = STAT_KEYS.indexOf(
          /** @type {any} */ (Object.entries(team.weights).sort((a, b) => b[1] - a[1])[0][0])
        );
        expect(stats[top]).toBe(Math.max(...stats));
      }
    }
  });

  it('gives each stat its share of the budget: Vortex at level 4', () => {
    // 80 points above the all-1 line; speed 30% -> 24, acceleration 20% -> 16, and so on.
    const { stats } = allocateAlongPersona({ stats: ones(), level: 4, weights: TEAMS[0].weights });
    expect(stats).toEqual([25, 9, 17, 6, 4, 7, 4, 11, 6]);
  });

  it('skips a capped stat and spends what is left on the others: Vortex at level 8', () => {
    // Speed's share would be 49; cap(8) is 46.
    const { stats } = allocateAlongPersona({ stats: ones(), level: 8, weights: TEAMS[0].weights });
    expect(stats[0]).toBe(46);
    expect(sum(stats)).toBe(169);
  });

  it('stops at the Volt budget, never lowers a stat, and reports the cost', () => {
    const from = allocateAlongPersona({ stats: ones(), level: 5, weights: TEAMS[0].weights }).stats;
    const full = allocateAlongPersona({ stats: from, level: 6, weights: TEAMS[0].weights });
    expect(full.points).toBe(20);
    expect(full.cost).toBe(sum(from.map((s, i) => calculateTotalUpgradeCost(s, full.stats[i]))));
    const part = allocateAlongPersona({
      stats: from,
      level: 6,
      weights: TEAMS[0].weights,
      budget: 10,
    });
    expect(part.cost).toBeLessThanOrEqual(10);
    expect(part.points).toBeGreaterThan(0);
    expect(part.points).toBeLessThan(20);
    part.stats.forEach((s, i) => expect(s).toBeGreaterThanOrEqual(from[i]));
    expect(
      allocateAlongPersona({ stats: from, level: 6, weights: TEAMS[0].weights, budget: 0 }).points
    ).toBe(0);
  });
});

describe('team prices and capsules', () => {
  it('lists at 1.2x and buys at or under 0.8x the rarity base', () => {
    expect(
      ['common', 'rare', 'epic', 'legendary'].map((r) => listPrice(/** @type {any} */ (r)))
    ).toEqual([180, 960, 4_200, 14_400]);
    expect(
      ['common', 'rare', 'epic', 'legendary'].map((r) => maxBuyPrice(/** @type {any} */ (r)))
    ).toEqual([120, 640, 2_800, 9_600]);
  });

  /** @type {import('../../lib/teams/policy.js').TeamState} */
  const rich = {
    volts: 30_000,
    reserve: 5_000,
    perTxCap: 5_000,
    dayLeft: 15_000,
    capsulePrices: { starter: 1_000, premium: 6_000 },
    weights: TEAMS[0].weights,
    drones: [],
    freeMods: [],
    listedMods: 0,
    market: [],
  };

  it('opens premium only when its price fits the caps', () => {
    // 25,000 spare Volts, but a 6,000 capsule is over the 5,000 cap: the contract would refuse.
    expect(planCapsule(rich)).toMatchObject({ step: 'capsule', subject: 'starter' });
    expect(planCapsule({ ...rich, perTxCap: 6_000 })).toMatchObject({ subject: 'premium' });
    expect(planCapsule({ ...rich, perTxCap: 6_000, dayLeft: 5_999 })).toMatchObject({
      subject: 'starter',
    });
    expect(planCapsule({ ...rich, perTxCap: 6_000, volts: 24_999 })).toMatchObject({
      subject: 'starter',
    });
    expect(planCapsule({ ...rich, volts: 5_999 })).toBeNull();
    // What is left of the day's cap does not cover a starter capsule: nothing is sent.
    expect(planCapsule({ ...rich, dayLeft: 999 })).toBeNull();
    expect(
      planCapsule({ ...rich, listedMods: 4, freeMods: [{ token: 'm:1', template: 1 }] })
    ).toMatchObject({ subject: 'starter' });
    expect(
      planCapsule({
        ...rich,
        listedMods: 4,
        freeMods: [
          { token: 'm:1', template: 1 },
          { token: 'm:2', template: 2 },
        ],
      })
    ).toBeNull();
  });

  it('reads the caps from the budget: spent counts only on the contract day it was spent', () => {
    const budget = { per_tx: '5000', per_day: '15000', spent: '14500', day: 20_762 };
    const noon = (20_762 + 0.5) * 86_400_000;
    expect(teamCaps(budget, noon)).toEqual({ perTxCap: 5_000, dayLeft: 500 });
    expect(teamCaps(budget, noon + 86_400_000)).toEqual({ perTxCap: 5_000, dayLeft: 15_000 });
    expect(teamCaps({ ...budget, spent: '16000' }, noon)).toMatchObject({ dayLeft: 0 });
    expect(teamCaps(null, noon)).toEqual({ perTxCap: 0, dayLeft: 0 });
  });

  /** Meridian (4 straights, 4 turns) at night: Aero Shell fits 0.5, Predator Lens 4. */
  const night = { track: { straights: 4, turns: 4 }, weather: 'clear', timeOfDay: 'night' };
  /** A racing drone with Aero Shell (m:1, equipped). */
  const racer = {
    token: 'd:1',
    level: 8,
    stats: allocateAlongPersona({ stats: ones(), level: 8, weights: TEAMS[0].weights }).stats,
    equippedMod: 'm:1',
    mods: [{ token: 'm:1', template: 11 }],
    race: night,
    order: 0,
  };

  it('equip keeps the equipped mod on a tie and moves to a better one', () => {
    // Two Aero Shells tie: the equipped one stays, whichever token number it has.
    const twins = [
      { token: 'm:1', template: 11 },
      { token: 'm:2', template: 11 },
    ];
    expect(
      planEquip({ ...rich, drones: [{ ...racer, mods: twins, equippedMod: 'm:2' }] })
    ).toBeNull();
    // Nothing equipped: the lower token number of the tie.
    expect(
      planEquip({ ...rich, drones: [{ ...racer, mods: twins, equippedMod: null }] })?.args
    ).toEqual({ drone: 'd:1', item: 'm:1', kind: 'mod' });
    const better = [...racer.mods, { token: 'm:9', template: 22 }];
    expect(planEquip({ ...rich, drones: [{ ...racer, mods: better }] })?.args).toMatchObject({
      item: 'm:9',
    });
    // A drone outside the matchups is left alone.
    expect(planEquip({ ...rich, drones: [{ ...racer, mods: better, race: null }] })).toBeNull();
  });

  it('list takes the lowest fit, then the cheaper rarity, then the lower token number', () => {
    // Night Lens (common) and Night Optics (rare) both fit 0 in clear daylight.
    const day = { ...racer, race: { ...night, timeOfDay: 'day' } };
    const freeMods = [
      { token: 'm:5', template: 14 },
      { token: 'm:7', template: 6 },
      { token: 'm:6', template: 6 },
      { token: 'm:8', template: 11 },
    ];
    expect(planList({ ...rich, drones: [day], freeMods })).toMatchObject({
      subject: 'm:6',
      args: { token: 'm:6', price: '180' },
    });
    expect(planList({ ...rich, drones: [day], freeMods: freeMods.slice(0, 2) })).toBeNull();
    expect(planList({ ...rich, drones: [{ ...day, race: null }], freeMods })).toBeNull();
  });

  it('buy needs 2 fit of gain, a price at or under 0.8x base, the spare Volts and the caps', () => {
    /** @param {number} price @param {Partial<typeof rich>} [over] */
    const buys = (price, over = {}) =>
      planBuy({
        ...rich,
        drones: [racer],
        market: [{ token: 'm:50', template: 22, price }],
        ...over,
      })?.subject ?? null;
    expect(buys(2_800)).toBe('m:50');
    expect(buys(2_801)).toBeNull();
    expect(buys(2_800, { volts: 7_799 })).toBeNull();
    expect(buys(2_800, { perTxCap: 2_799 })).toBeNull();
    expect(buys(2_800, { dayLeft: 2_799 })).toBeNull();
    // Night Optics gains 1.5 over Aero Shell: not enough.
    expect(
      planBuy({ ...rich, drones: [racer], market: [{ token: 'm:51', template: 14, price: 10 }] })
    ).toBeNull();
    // With no race there is no fit to compare.
    expect(buys(2_800, { drones: [{ ...racer, race: null }] })).toBeNull();
    // The same gain twice: the lower price, then the lower token number.
    const market = [
      { token: 'm:60', template: 22, price: 900 },
      { token: 'm:62', template: 22, price: 800 },
      { token: 'm:61', template: 22, price: 800 },
    ];
    expect(planBuy({ ...rich, drones: [racer], market })?.subject).toBe('m:61');
  });

  it('decide passes over a plan equal to the one the chain just refused', () => {
    const state = {
      ...rich,
      drones: [racer],
      market: [{ token: 'm:50', template: 22, price: 600 }],
    };
    const capsule = decide(state);
    expect(capsule).toMatchObject({ step: 'capsule', subject: 'starter' });
    expect(decide(state, capsule)).toMatchObject({ step: 'buy', subject: 'm:50' });
    // A different plan of the same step is not passed over.
    expect(decide(state, { .../** @type {any} */ (capsule), subject: 'premium' })).toEqual(capsule);
  });
});
