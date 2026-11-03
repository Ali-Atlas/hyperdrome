/**
 * Marketplace actions through services/gameplay.service.js and the event cache
 * (services/chain-cache.service.js): list escrows and caches the listing, buy moves the drone and
 * its bound items to the buyer and refreshes both balances, cancel closes the listing. Ownership
 * checks run against the cache before any chain call.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { schema } from '../../lib/db/index.js';
import {
  buyListing,
  cancelListing,
  listToken,
  setDroneActive,
} from '../../services/gameplay.service.js';
import { createMockNear, dbEnabled, ev, newDrone, newPlayer, testDb } from './setup.js';

const { drones, mods, droneMods, marketplaceListings, users } = schema;

describe.skipIf(!dbEnabled)('marketplace actions and the event cache', () => {
  const db = testDb();
  afterAll(async () => {
    await db?.$client?.end?.();
  });

  /** A mock contract for list, buy and cancel that emits the SPEC.md 4.7 events. */
  function market() {
    const near = createMockNear();
    /** @type {Map<string, { seller: string, price: string, bound: string[] }>} */
    const listings = new Map();
    /** @type {Map<string, string[]>} drone token -> bound item tokens */
    const bound = new Map();
    /** @type {Map<string, number>} */
    const balances = new Map();
    const transfer = (
      /** @type {string} */ from,
      /** @type {string} */ to,
      ids = /** @type {string[]} */ ([])
    ) => ev('nft_transfer', [{ old_owner_id: from, new_owner_id: to, token_ids: ids }], 'nep171');

    near.mock.on('list', (/** @type {any} */ a, { accountId }) => {
      const ids = [a.token, ...(bound.get(a.token) ?? [])];
      listings.set(a.token, { seller: String(accountId), price: a.price, bound: ids });
      return {
        events: [
          transfer(String(accountId), near.gameId, ids),
          ev('listed', { token: a.token, seller: accountId, price: a.price }),
        ],
      };
    });
    near.mock.on('buy', (/** @type {any} */ a, { accountId }) => {
      const l = listings.get(a.token);
      if (!l) throw new Error('not listed');
      listings.delete(a.token);
      const price = Number(l.price);
      const fee = Math.floor(price / 10);
      balances.set(String(accountId), (balances.get(String(accountId)) ?? 0) - price);
      balances.set(l.seller, (balances.get(l.seller) ?? 0) + price - fee);
      return {
        events: [
          ev(
            'ft_transfer',
            [{ old_owner_id: accountId, new_owner_id: l.seller, amount: String(price - fee) }],
            'nep141'
          ),
          ev(
            'ft_transfer',
            [{ old_owner_id: accountId, new_owner_id: 'treasury', amount: String(fee) }],
            'nep141'
          ),
          transfer(near.gameId, String(accountId), l.bound),
          ev('sold', {
            token: a.token,
            seller: l.seller,
            buyer: accountId,
            price: l.price,
            fee: String(fee),
          }),
        ],
      };
    });
    near.mock.on('cancel', (/** @type {any} */ a) => {
      const l = listings.get(a.token);
      if (!l) throw new Error('not listed');
      listings.delete(a.token);
      return {
        events: [transfer(near.gameId, l.seller, l.bound), ev('cancelled', { token: a.token })],
      };
    });
    near.mock.on('ft_balance_of', (/** @type {any} */ a) => ({
      result: String(1000 + (balances.get(a.account_id) ?? 0)),
    }));
    return { near, bound };
  }

  /** A drone with one bound mod, both cached for `userId`. */
  async function droneWithMod(
    /** @type {string} */ userId,
    /** @type {Map<string, string[]>} */ bound
  ) {
    const drone = await newDrone(db, userId);
    const modToken = `m:${randomBytes(5).readUIntBE(0, 5) + 1}`;
    const [mod] = await db
      .insert(mods)
      .values({ userId, name: 'Grip Pads', rarity: 'common', template: 2, tokenId: modToken })
      .returning();
    await db.insert(droneMods).values({ droneId: drone.id, modId: mod.id, isEquipped: true });
    bound.set(String(drone.tokenId), [modToken]);
    return { drone, mod };
  }

  const listing = async (/** @type {string} */ token) =>
    db.select().from(marketplaceListings).where(eq(marketplaceListings.tokenId, token));

  it('lists, sells to another player and moves the bound items with the drone', async () => {
    const { near, bound } = market();
    const seller = await newPlayer(db, near);
    const buyer = await newPlayer(db, near);
    const { drone, mod } = await droneWithMod(seller.user.id, bound);
    const token = String(drone.tokenId);
    await db.update(drones).set({ active: true }).where(eq(drones.id, drone.id));

    const listed = await listToken(
      { userId: seller.user.id, actionId: randomUUID(), token, price: 500 },
      { db, near }
    );
    expect(listed.status).toBe(200);
    const [active] = await listing(token);
    expect(active).toMatchObject({
      status: 'active',
      itemType: 'drone',
      droneId: drone.id,
      price: 500,
      sellerId: seller.user.id,
    });
    // Escrow keeps the seller as the cached owner.
    expect((await db.select().from(drones).where(eq(drones.id, drone.id)))[0].userId).toBe(
      seller.user.id
    );

    const own = await buyListing(
      { userId: seller.user.id, actionId: randomUUID(), token },
      { db, near }
    );
    expect(own).toEqual({ status: 409, body: { error: 'You cannot buy your own listing.' } });

    const bought = await buyListing(
      { userId: buyer.user.id, actionId: randomUUID(), token },
      { db, near }
    );
    expect(bought.status).toBe(200);
    expect(bought.body.volts).toBe(500);

    const [sold] = await listing(token);
    expect(sold).toMatchObject({ status: 'sold', buyerId: buyer.user.id, platformFee: 50 });
    const [moved] = await db.select().from(drones).where(eq(drones.id, drone.id));
    expect(moved).toMatchObject({ userId: buyer.user.id, active: false });
    const [movedMod] = await db.select().from(mods).where(eq(mods.id, mod.id));
    expect(movedMod.userId).toBe(buyer.user.id);
    const points = async (/** @type {string} */ id) =>
      (await db.select().from(users).where(eq(users.id, id)))[0].points;
    expect(await points(buyer.user.id)).toBe(500);
    expect(await points(seller.user.id)).toBe(1450);
  });

  it('refuses to list a bound item or a token the player does not own, before any chain call', async () => {
    const { near, bound } = market();
    const seller = await newPlayer(db, near);
    const other = await newPlayer(db, near);
    const { drone, mod } = await droneWithMod(seller.user.id, bound);

    const boundItem = await listToken(
      { userId: seller.user.id, actionId: randomUUID(), token: String(mod.tokenId), price: 50 },
      { db, near }
    );
    expect(boundItem.status).toBe(409);
    const notMine = await listToken(
      { userId: other.user.id, actionId: randomUUID(), token: String(drone.tokenId), price: 50 },
      { db, near }
    );
    expect(notMine.status).toBe(404);
    expect(near.mock.calls.filter((c) => c.kind === 'player')).toHaveLength(0);
  });

  it('cancels a listing and keeps the owner', async () => {
    const { near, bound } = market();
    const seller = await newPlayer(db, near);
    const { drone } = await droneWithMod(seller.user.id, bound);
    const token = String(drone.tokenId);
    await listToken(
      { userId: seller.user.id, actionId: randomUUID(), token, price: 20 },
      { db, near }
    );

    const cancelled = await cancelListing(
      { userId: seller.user.id, actionId: randomUUID(), token },
      { db, near }
    );
    expect(cancelled.status).toBe(200);
    expect((await listing(token))[0].status).toBe('cancelled');
    expect((await db.select().from(drones).where(eq(drones.id, drone.id)))[0].userId).toBe(
      seller.user.id
    );
  });

  it('activates a drone only within the active-slot limit (SPEC.md 2.2)', async () => {
    const near = createMockNear();
    const { user } = await newPlayer(db, near);
    const first = await newDrone(db, user.id);
    const second = await newDrone(db, user.id);

    expect(
      (await setDroneActive({ userId: user.id, droneId: first.id, active: true }, { db })).status
    ).toBe(200);
    expect(
      (await setDroneActive({ userId: user.id, droneId: second.id, active: true }, { db })).status
    ).toBe(409);
    await db.update(users).set({ totalRaces: 500 }).where(eq(users.id, user.id));
    expect(
      (await setDroneActive({ userId: user.id, droneId: second.id, active: true }, { db })).status
    ).toBe(200);
  });
});
