/**
 * The showcase plan (lib/showcase/plan.js): what the seed mints and lists must fit the contract's
 * rules before a transaction is sent, because a mint cannot be undone.
 */
import { describe, expect, it } from 'vitest';
import { skinTemplate } from '../../lib/game-engine/skin-templates.js';
import { estimateCost } from '../../lib/showcase/cost.js';
import {
  OPERATOR_KIT,
  OPERATOR_VOLTS,
  PILOTS,
  droneFits,
  dronePrice,
  itemInfo,
  kitSteps,
  pilotKit,
  plannedSkinMints,
  showcaseActionId,
} from '../../lib/showcase/plan.js';
import { RARITY_BASE_PRICE } from '../../lib/teams/policy.js';

const kits = [OPERATOR_KIT, ...PILOTS.map(pilotKit)];
const tier = (/** @type {number} */ level) => Math.ceil(level / 5);

describe('showcase plan', () => {
  it('mints every drone inside its level cap and stat budget', () => {
    for (const drone of kits.flatMap((kit) => kit.drones)) {
      expect(droneFits(drone), drone.name).toBe(true);
    }
  });

  it('gives the operator one drone per tier, each with a skin above common and a mod', () => {
    expect(OPERATOR_KIT.drones.map((d) => tier(d.level))).toEqual([1, 2, 3, 4]);
    for (const drone of OPERATOR_KIT.drones) {
      expect(drone.mods.length, drone.name).toBeGreaterThan(0);
      const rarities = drone.skins.map((t) => itemInfo('skin', t).rarity);
      expect(rarities.length, drone.name).toBeGreaterThan(0);
      expect(rarities, drone.name).not.toContain('common');
    }
    expect(OPERATOR_KIT.volts).toBe(OPERATOR_VOLTS);
    expect(kitSteps(OPERATOR_KIT).filter((s) => s.method === 'list')).toEqual([]);
  });

  it('uses catalog skins only, each template far under the legendary cap', () => {
    for (const [template, planned] of plannedSkinMints()) {
      expect(skinTemplate(template), `template ${template}`).not.toBeNull();
      expect(planned).toBeLessThanOrEqual(3);
    }
  });

  it('lists 3 to 5 tokens per pilot, one of them a drone, near the rarity base price', () => {
    for (const pilot of PILOTS) {
      const lists = kitSteps(pilotKit(pilot)).filter((s) => s.method === 'list');
      expect(lists.length, pilot.username).toBeGreaterThanOrEqual(3);
      expect(lists.length, pilot.username).toBeLessThanOrEqual(5);
      expect(lists.filter((s) => s.piece?.startsWith('drone:'))).toHaveLength(1);
      expect(lists[0].price).toBe(dronePrice(pilot.drone));
      for (const { kind, template, price } of pilot.listings) {
        const base = RARITY_BASE_PRICE[itemInfo(kind, template).rarity];
        expect(Math.abs(price - base) / base, `${kind} ${template}`).toBeLessThanOrEqual(0.1);
        // Above the 0.8x a team buys at (SPEC.md 10), so no team ever buys a seeded mod.
        expect(price).toBeGreaterThan((base * 4) / 5);
      }
    }
  });

  it('puts at least 6 legendary skins, a top-tier drone and epic and rare skins on the market', () => {
    const listed = PILOTS.flatMap((p) => p.listings).filter((l) => l.kind === 'skin');
    const count = (/** @type {string} */ rarity) =>
      listed.filter((l) => itemInfo('skin', l.template).rarity === rarity).length;
    expect(count('legendary')).toBeGreaterThanOrEqual(6);
    expect(count('epic')).toBeGreaterThanOrEqual(2);
    expect(count('rare')).toBeGreaterThanOrEqual(2);
    expect(PILOTS.some((p) => p.drone.level >= 16)).toBe(true);
  });

  it('keeps one unlisted racer per pilot, one in each bracket the operator races in', () => {
    const bracketOf = (/** @type {number} */ level) => Math.ceil(level / 5);
    expect(PILOTS.map((p) => bracketOf(p.racer.level)).sort()).toEqual(
      OPERATOR_KIT.drones.map((d) => bracketOf(d.level)).sort()
    );
    for (const pilot of PILOTS) {
      const kit = pilotKit(pilot);
      expect(kit.active).toEqual([pilot.racer.name]);
      expect(kit.prices[`drone:${pilot.racer.name}`]).toBeUndefined();
      expect(pilot.racer.skins.length).toBeGreaterThan(0);
      expect(pilot.racer.mods.length).toBeGreaterThan(0);
    }
    expect(OPERATOR_KIT.active[0]).toBe('APEX-Z9');
  });

  it('gives every step of every account its own action id, stable across runs', () => {
    const ids = kits.flatMap((kit, i) =>
      kitSteps(kit).map((step) => showcaseActionId(`account-${i}`, step.key))
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(showcaseActionId('a.testnet', 'volts')).toBe(showcaseActionId('a.testnet', 'volts'));
    expect(showcaseActionId('a.testnet', 'volts')).not.toBe(showcaseActionId('b.testnet', 'volts'));
  });

  it('binds before it lists, and mints before both', () => {
    for (const kit of kits) {
      const order = kitSteps(kit).map((s) =>
        s.method.startsWith('mint_') ? 0 : s.method === 'bind' ? 1 : 2
      );
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
  });

  it('estimates a cost from the plan', () => {
    const cost = estimateCost();
    expect(cost.lists).toBe(PILOTS.length * 5);
    expect(cost.opsNear).toBeLessThan(1);
    expect(cost.gameNear).toBeLessThan(1);
  });
});
