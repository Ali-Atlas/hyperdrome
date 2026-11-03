/**
 * Player gameplay actions (SPEC.md 4.4, 8): allocate, equip, bind, vendor drone, and the
 * marketplace's list, buy and cancel. Each checks ownership against the database cache, then
 * sends the contract call through `runPlayerAction` (the contract enforces every rule again) and
 * updates the caches from the outcome's events. A replayed action id skips the cache checks, since
 * the first run already changed what they look at, and gets the stored answer.
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/lib/db';
import { activeSlotsFor } from '@/lib/game-engine/economy.js';
import { getNear } from '@/lib/near';
import { runPlayerAction } from './action.service.js';
import { applyEvents, tokenKind } from './chain-cache.service.js';

const { actions, users, drones, skins, mods, droneSkins, droneMods, marketplaceListings } = schema;

/**
 * @typedef {import('./action.service.js').ActionResponse} ActionResponse
 * @typedef {{ db?: any, near?: import('@/lib/near').NearAdapter }} Deps
 * @typedef {{ db: any, near: import('@/lib/near').NearAdapter }} FullDeps
 */

/**
 * @param {number} status
 * @param {string} error
 * @returns {ActionResponse}
 */
const reject = (status, error) => ({ status, body: { error } });

/** @param {Deps} deps @returns {FullDeps} */
const resolveDeps = (deps) => ({ db: deps.db ?? defaultDb, near: deps.near ?? getNear() });

/**
 * Run `method` after `check` passes (skipped on a replay). `check` returns the args or a rejection.
 * @param {string} userId
 * @param {string} actionId
 * @param {string} method
 * @param {(replay: boolean) => Promise<Record<string, unknown> | ActionResponse>} check
 * @param {FullDeps} deps
 * @returns {Promise<ActionResponse>}
 */
async function checkedAction(userId, actionId, method, check, deps) {
  const [seen] = await deps.db
    .select({ id: actions.id })
    .from(actions)
    .where(eq(actions.id, actionId))
    .limit(1);
  const args = await check(Boolean(seen));
  if ('status' in args && 'body' in args) return /** @type {ActionResponse} */ (args);
  return runPlayerAction(
    {
      userId,
      actionId,
      method,
      args,
      onApplied: async (events) => {
        const { balances } = await applyEvents(events, deps);
        const [user] = await deps.db
          .select({ account: users.nearAccountId })
          .from(users)
          .where(eq(users.id, userId));
        const volts = user?.account ? balances[user.account] : undefined;
        return volts === undefined ? {} : { volts };
      },
    },
    deps
  );
}

/**
 * The user's cached drone with a token id; any owner on a replay.
 * @param {FullDeps} deps
 * @param {string} userId
 * @param {string} droneId
 * @param {boolean} replay
 */
async function ownedDrone(deps, userId, droneId, replay) {
  const [drone] = await deps.db
    .select()
    .from(drones)
    .where(and(eq(drones.id, droneId), isNotNull(drones.tokenId)))
    .limit(1);
  if (!drone || (!replay && drone.userId !== userId)) return null;
  return drone;
}

/**
 * The cached skin or mod row for an item token, and the drone it is bound to (if any).
 * @param {FullDeps} deps
 * @param {string} token
 */
async function itemWithBinding(deps, token) {
  const isSkin = tokenKind(token) === 'skin';
  const table = isSkin ? skins : mods;
  const [item] = await deps.db.select().from(table).where(eq(table.tokenId, token)).limit(1);
  if (!item) return null;
  const [binding] = isSkin
    ? await deps.db.select().from(droneSkins).where(eq(droneSkins.skinId, item.id)).limit(1)
    : await deps.db.select().from(droneMods).where(eq(droneMods.modId, item.id)).limit(1);
  return { item, boundDroneId: /** @type {string | null} */ (binding?.droneId ?? null) };
}

/**
 * `allocate_stats`: raise the drone's stats to `stats` (cost burned from Volts).
 * @param {{ userId: string, droneId: string, actionId: string, stats: number[] }} input
 * @param {Deps} [deps]
 */
export function allocateStats({ userId, droneId, actionId, stats }, deps = {}) {
  const d = resolveDeps(deps);
  return checkedAction(
    userId,
    actionId,
    'allocate_stats',
    async (replay) => {
      const drone = await ownedDrone(d, userId, droneId, replay);
      if (!drone) return reject(404, 'Drone not found.');
      return { drone: drone.tokenId, stats };
    },
    d
  );
}

/**
 * `equip`: put a bound skin or mod in its slot, or clear the slot with null.
 * @param {{ userId: string, droneId: string, actionId: string, kind: 'skin' | 'mod', item: string | null }} input
 * @param {Deps} [deps]
 */
export function equipItem({ userId, droneId, actionId, kind, item }, deps = {}) {
  const d = resolveDeps(deps);
  return checkedAction(
    userId,
    actionId,
    'equip',
    async (replay) => {
      const drone = await ownedDrone(d, userId, droneId, replay);
      if (!drone) return reject(404, 'Drone not found.');
      if (item && !replay) {
        const found = await itemWithBinding(d, item);
        if (!found || found.item.userId !== userId) return reject(404, 'Item not found.');
        if (found.boundDroneId !== drone.id) {
          return reject(409, 'Bind this item to the drone before equipping it.');
        }
      }
      return { drone: drone.tokenId, item, kind };
    },
    d
  );
}

/**
 * `bind`: attach an unbound skin or mod to the drone for good (auto-equips an empty slot).
 * @param {{ userId: string, droneId: string, actionId: string, item: string }} input
 * @param {Deps} [deps]
 */
export function bindItem({ userId, droneId, actionId, item }, deps = {}) {
  const d = resolveDeps(deps);
  return checkedAction(
    userId,
    actionId,
    'bind',
    async (replay) => {
      const drone = await ownedDrone(d, userId, droneId, replay);
      if (!drone) return reject(404, 'Drone not found.');
      if (!replay) {
        const found = await itemWithBinding(d, item);
        if (!found || found.item.userId !== userId) return reject(404, 'Item not found.');
        if (found.boundDroneId) return reject(409, 'This item is already bound to a drone.');
      }
      return { drone: drone.tokenId, item };
    },
    d
  );
}

/**
 * `vendor_buy_drone`: a new level 1 drone with a common skin and mod bound (3,500 Volts).
 * @param {{ userId: string, actionId: string }} input
 * @param {Deps} [deps]
 */
export function buyVendorDrone({ userId, actionId }, deps = {}) {
  const d = resolveDeps(deps);
  return checkedAction(userId, actionId, 'vendor_buy_drone', async () => ({}), d);
}

/**
 * The active cached listing for a token, if any.
 * @param {FullDeps} deps
 * @param {string} token
 */
async function activeListing(deps, token) {
  const [listing] = await deps.db
    .select()
    .from(marketplaceListings)
    .where(and(eq(marketplaceListings.tokenId, token), eq(marketplaceListings.status, 'active')))
    .limit(1);
  return listing ?? null;
}

/**
 * `list`: put a drone or an unbound item on the marketplace at `price` Volts (escrowed).
 * @param {{ userId: string, actionId: string, token: string, price: number }} input
 * @param {Deps} [deps]
 */
export function listToken({ userId, actionId, token, price }, deps = {}) {
  const d = resolveDeps(deps);
  return checkedAction(
    userId,
    actionId,
    'list',
    async (replay) => {
      if (!replay) {
        if (await activeListing(d, token)) return reject(409, 'This item is already listed.');
        if (tokenKind(token) === 'drone') {
          const [drone] = await d.db.select().from(drones).where(eq(drones.tokenId, token));
          if (!drone || drone.userId !== userId) return reject(404, 'Drone not found.');
        } else {
          const found = await itemWithBinding(d, token);
          if (!found || found.item.userId !== userId) return reject(404, 'Item not found.');
          if (found.boundDroneId) {
            return reject(409, 'This item is bound to a drone. It can only move with that drone.');
          }
        }
      }
      return { token, price: String(price) };
    },
    d
  );
}

/**
 * `buy`: pay the listing price; the token (and a drone's bound items) moves to the buyer.
 * @param {{ userId: string, actionId: string, token: string }} input
 * @param {Deps} [deps]
 */
export function buyListing({ userId, actionId, token }, deps = {}) {
  const d = resolveDeps(deps);
  return checkedAction(
    userId,
    actionId,
    'buy',
    async (replay) => {
      if (!replay) {
        const listing = await activeListing(d, token);
        if (!listing) return reject(404, 'This listing is no longer active.');
        if (listing.sellerId === userId) return reject(409, 'You cannot buy your own listing.');
      }
      return { token };
    },
    d
  );
}

/**
 * `cancel`: take the seller's listing down; the token returns from escrow.
 * @param {{ userId: string, actionId: string, token: string }} input
 * @param {Deps} [deps]
 */
export function cancelListing({ userId, actionId, token }, deps = {}) {
  const d = resolveDeps(deps);
  return checkedAction(
    userId,
    actionId,
    'cancel',
    async (replay) => {
      if (!replay) {
        const listing = await activeListing(d, token);
        if (!listing || listing.sellerId !== userId) {
          return reject(404, 'This listing is no longer active.');
        }
      }
      return { token };
    },
    d
  );
}

/**
 * Activate or deactivate a drone (database only, SPEC.md 8). Activating respects the active-slot
 * limit from the player's lifetime races (SPEC.md 2.2).
 * @param {{ userId: string, droneId: string, active: boolean }} input
 * @param {{ db?: any }} [deps]
 * @returns {Promise<ActionResponse>} `{ data: drone }` on success
 */
export async function setDroneActive({ userId, droneId, active }, deps = {}) {
  const db = deps.db ?? defaultDb;
  const [drone] = await db.select().from(drones).where(eq(drones.id, droneId)).limit(1);
  if (!drone || drone.userId !== userId) return reject(404, 'Drone not found.');
  if (active && !drone.active) {
    const [user] = await db
      .select({ totalRaces: users.totalRaces })
      .from(users)
      .where(eq(users.id, userId));
    const slots = activeSlotsFor(user?.totalRaces ?? 0);
    const [{ count }] = await db
      .select({ count: sql`count(*)::int` })
      .from(drones)
      .where(and(eq(drones.userId, userId), eq(drones.active, true)));
    if (Number(count) >= slots) {
      const have = `You already have ${slots} active ${slots === 1 ? 'drone' : 'drones'}.`;
      return reject(
        409,
        slots >= 3
          ? `${have} Deactivate one to activate this drone.`
          : `${have} Deactivate one, or race more to unlock another slot.`
      );
    }
  }
  const [updated] = await db
    .update(drones)
    .set({ active })
    .where(eq(drones.id, droneId))
    .returning();
  return { status: 200, body: { data: updated } };
}
