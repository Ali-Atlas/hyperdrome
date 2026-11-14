/**
 * The showcase seed (services/showcase-seed.service.js) against the fake contract and the test
 * database: one run mints, binds and lists the plan, and a second run sends nothing.
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../../lib/db/index.js';
import { OPERATOR_KIT, PILOTS, kitSteps, pilotEmail, pilotKit } from '../../lib/showcase/plan.js';
import { seedShowcase } from '../../services/showcase-seed.service.js';
import { showcaseStatus } from '../../services/showcase-status.js';
import { dbEnabled, newPlayer, testDb } from '../gameplay/setup.js';
import { createTeamChain } from '../teams/fake-chain.js';

const { users, drones, marketplaceListings, droneOwnershipHistory } = schema;

/**
 * The fake contract with what the seed adds to the team tests' needs: the catalog, the owner's
 * token count, and a `list` that also escrows a drone with its bound items.
 */
function showcaseChain() {
  const chain = createTeamChain();
  const { near } = chain;
  const on = (/** @type {string} */ method, /** @type {(a: any, c: any) => any} */ fn) =>
    near.mock.on(method, fn);
  on('get_catalog', () => ({
    result: {
      skins: Array.from({ length: 32 }, (_, i) => ({ id: i + 1, cap: 50, minted: 0 })),
      mods: [],
    },
  }));
  on('nft_supply_for_owner', (a) => ({
    result: String(
      [...chain.drones, ...chain.items].filter(([, t]) => t.owner === a.account_id).length
    ),
  }));
  on('list', (a, { accountId }) => {
    const drone = chain.drones.get(a.token);
    const moved = drone ? [a.token, ...drone.skins, ...drone.mods] : [a.token];
    for (const token of moved) {
      const t = chain.drones.get(token) ?? chain.items.get(token);
      if (t) t.owner = near.gameId;
    }
    return {
      events: [
        {
          standard: 'nep171',
          version: '1.0.0',
          event: 'nft_transfer',
          data: [{ old_owner_id: accountId, new_owner_id: near.gameId, token_ids: moved }],
          receiptId: 'r',
        },
        {
          standard: 'hyperdrome',
          version: '1.0.0',
          event: 'listed',
          data: { token: a.token, seller: accountId, price: a.price },
          receiptId: 'r',
        },
      ],
    };
  });
  return chain;
}

describe.skipIf(!dbEnabled)('showcase seed', () => {
  const db = testDb();
  const wipe = async () => {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.email, PILOTS.map(pilotEmail)));
    const ids = rows.map((/** @type {{ id: string }} */ r) => r.id);
    if (ids.length === 0) return;
    await db.delete(marketplaceListings).where(inArray(marketplaceListings.sellerId, ids));
    await db.delete(droneOwnershipHistory).where(inArray(droneOwnershipHistory.ownerUserId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  };
  beforeEach(wipe);
  afterAll(wipe);

  it('mints, binds and lists the plan once, and a second run sends nothing', async () => {
    const chain = showcaseChain();
    const { near } = chain;
    const { user, accountId } = await newPlayer(db, near);
    const deps = { db, near, wait: async () => {} };
    const count = (/** @type {string} */ method) => chain.calls(method).length;

    const reports = await seedShowcase({ operatorAccount: accountId }, deps);
    expect(reports.map((r) => r.username)).toEqual([
      user.username,
      ...PILOTS.map((p) => p.username),
    ]);
    expect(reports.every((r) => r.steps.every((s) => !s.replayed && s.txHash))).toBe(true);

    const kits = [OPERATOR_KIT, ...PILOTS.map(pilotKit)].flatMap(kitSteps);
    const planned = (/** @type {string} */ method) =>
      kits.filter((s) => s.method === method).length;
    // Each pilot's bootstrap adds a starter drone, Ember, a mod, Volts and two binds.
    // The operator's own account is the fifth.
    expect(count('create_player')).toBe(PILOTS.length + 1);
    expect(count('mint_drone')).toBe(planned('mint_drone') + PILOTS.length);
    expect(count('mint_item')).toBe(planned('mint_item') + 2 * PILOTS.length);
    expect(count('mint_volts')).toBe(1 + PILOTS.length);
    expect(count('bind')).toBe(planned('bind') + 2 * PILOTS.length);
    expect(count('list')).toBe(planned('list'));
    expect(chain.volts.get(accountId)).toBe(OPERATOR_KIT.volts);

    const pilots = await db
      .select()
      .from(users)
      .where(inArray(users.email, PILOTS.map(pilotEmail)));
    expect(pilots).toHaveLength(PILOTS.length);
    expect(pilots.every((/** @type {any} */ p) => p.bootstrapState === 'done' && !p.isTeam)).toBe(
      true
    );
    const pilotIds = pilots.map((/** @type {any} */ p) => p.id);
    const listings = await db
      .select()
      .from(marketplaceListings)
      .where(inArray(marketplaceListings.sellerId, pilotIds));
    expect(listings).toHaveLength(planned('list'));
    expect(listings.every((/** @type {any} */ l) => l.status === 'active')).toBe(true);
    // Each pilot races its one unlisted drone (one active slot); the starter is inactive.
    const pilotFleet = await db.select().from(drones).where(inArray(drones.userId, pilotIds));
    const racing = pilotFleet.filter((/** @type {any} */ d) => d.active);
    expect(racing.map((/** @type {any} */ d) => d.name).sort()).toEqual(
      PILOTS.map((p) => p.racer.name).sort()
    );
    // The operator has one slot: the level 20 drone races, the other three wait.
    const fleet = await db.select().from(drones).where(eq(drones.userId, user.id));
    const levels = fleet.map((/** @type {any} */ d) => Number(d.level));
    expect(levels.sort((/** @type {number} */ a, /** @type {number} */ b) => a - b)).toEqual([
      5, 10, 15, 20,
    ]);
    expect(
      fleet.filter((/** @type {any} */ d) => d.active).map((/** @type {any} */ d) => d.name)
    ).toEqual(['APEX-Z9']);
    expect(reports.map((r) => r.activated)).toEqual([
      ['APEX-Z9'],
      ...PILOTS.map((p) => [p.racer.name]),
    ]);

    const sent = near.mock.calls.length;
    const again = await seedShowcase({ operatorAccount: accountId }, deps);
    const writes = near.mock.calls.slice(sent).filter((c) => c.kind !== 'view');
    expect(writes).toEqual([]);
    expect(again.every((r) => r.steps.every((s) => s.replayed))).toBe(true);
    expect(again.every((r) => r.activated.length === 0)).toBe(true);
    expect(again.map((r) => r.steps.map((s) => s.token))).toEqual(
      reports.map((r) => r.steps.map((s) => s.token))
    );

    const status = await showcaseStatus({ operatorAccount: accountId }, deps);
    expect(status.progress.map((p) => p.applied)).toEqual(
      [OPERATOR_KIT, ...PILOTS.map(pilotKit)].map((kit) => kitSteps(kit).length)
    );
    // Every drone of the operator has a pilot's racer in its bracket, and the pairing rule
    // gives the active one that racer while the ratings are level.
    expect(status.racing.map((r) => [r.name, r.bracket, r.active])).toEqual([
      ['APEX-Z9', '16-20', true],
      ['ARCANE-V7', '11-15', false],
      ['BANSHEE-R1', '6-10', false],
      ['AURORA-K5', '1-5', false],
    ]);
    for (const row of status.racing) {
      const racers = PILOTS.map((p) => p.racer.name);
      expect(row.opponents.some((o) => racers.includes(o.name))).toBe(true);
    }
    await db.delete(users).where(eq(users.id, user.id));
  });

  it('stops before sending anything when a planned skin would pass its cap', async () => {
    const chain = showcaseChain();
    const { near } = chain;
    const { user, accountId } = await newPlayer(db, near);
    near.mock.on('get_catalog', () => ({
      result: {
        skins: Array.from({ length: 32 }, (_, i) => ({ id: i + 1, cap: 50, minted: 49 })),
        mods: [],
      },
    }));
    const before = near.mock.calls.length;
    await expect(seedShowcase({ operatorAccount: accountId }, { db, near })).rejects.toThrow(
      /exceed the cap/
    );
    expect(near.mock.calls.slice(before).filter((c) => c.kind !== 'view')).toEqual([]);
    await db.delete(users).where(eq(users.id, user.id));
  });
});
