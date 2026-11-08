/**
 * Database caches of on-chain state, updated from a transaction's events (SPEC.md 3, 4.7, 7).
 * `applyEvents` reads the hyperdrome, nep171 and nep141 events of one outcome and writes the
 * drones, skins, mods, bound and equipped rows, the listings cache and `users.points`. It reads
 * the chain only where an event lacks a field the cache needs (a new drone's stats, a placeholder
 * skin's name, a Volt balance after any Volt movement). `batch_settled` writes each drone's
 * post-race level, xp, elo, record and lock and each race row's rewards; `batch_aborted` clears
 * the cached lock.
 */
import { and, eq } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/lib/db';
import { calculateTSB, calculateXPToNextLevel } from '@/lib/game-engine/economy.js';
import {
  RARITY_NAMES,
  droneImagePath,
  skinImagePath,
  skinTemplate,
} from '@/lib/game-engine/skin-templates.js';
import { modTemplate, statsFromArray } from '@/lib/game-engine/templates.js';
import { getNear } from '@/lib/near';
import { rowFor, userIdFor } from './chain-cache-rows.js';
import { raceSettled } from './chain-cache-settle.js';

export { tokenKind } from './chain-cache-rows.js';

const { users, drones, skins, mods, droneSkins, droneMods, marketplaceListings } = schema;

/**
 * @typedef {import('@/lib/near').NearEvent} NearEvent
 * @typedef {import('./chain-cache-rows.js').Ctx} Ctx
 * @typedef {{ stats: number[], name: string }} DroneCold
 * @typedef {{ level: number, xp: number, elo: number, wins: number, losses: number }} DroneHot
 */

/**
 * Apply one outcome's events to the caches.
 * @param {NearEvent[]} events in receipt order
 * @param {{ db?: any, near?: import('@/lib/near').NearAdapter }} [deps]
 * @returns {Promise<{ balances: Record<string, number> }>} Volt balances read after the events
 */
export async function applyEvents(events, deps = {}) {
  /** @type {Ctx} */
  const ctx = {
    db: deps.db ?? defaultDb,
    near: deps.near ?? getNear(),
    userIds: new Map(),
    voltAccounts: new Set(),
  };
  // Mints first, so binds, equips and listings in the same outcome find their rows.
  const minted = events.filter((e) => e.event === 'drone_minted' || e.event === 'item_minted');
  for (const e of minted) await applyOne(ctx, e);
  for (const e of events.filter((x) => !minted.includes(x))) await applyOne(ctx, e);

  /** @type {Record<string, number>} */
  const balances = {};
  for (const account of ctx.voltAccounts) {
    const userId = await userIdFor(ctx, account);
    if (!userId) continue;
    const raw = await ctx.near.view('ft_balance_of', { account_id: account });
    balances[account] = Number(raw ?? 0);
    await ctx.db.update(users).set({ points: balances[account] }).where(eq(users.id, userId));
  }
  return { balances };
}

/**
 * @param {Ctx} ctx
 * @param {NearEvent} e
 */
async function applyOne(ctx, e) {
  /** @type {any} */
  const d = e.data;
  if (e.standard === 'nep141') {
    for (const x of asList(d)) {
      for (const account of [x.owner_id, x.old_owner_id, x.new_owner_id]) {
        if (typeof account === 'string') ctx.voltAccounts.add(account);
      }
    }
    return;
  }
  if (e.standard === 'nep171') {
    if (e.event !== 'nft_transfer') return;
    for (const x of asList(d)) await transferred(ctx, x.new_owner_id, x.token_ids ?? []);
    return;
  }
  if (e.standard !== 'hyperdrome') return;
  switch (e.event) {
    case 'drone_minted':
      return droneMinted(ctx, d.token, d.owner);
    case 'item_minted':
      return itemMinted(ctx, d);
    case 'stats_allocated':
      return statsAllocated(ctx, d.drone, d.stats, Number(d.cost));
    case 'item_bound':
      return itemBound(ctx, d.drone, d.item);
    case 'equipped':
      return equipped(ctx, d.drone, d.kind, d.item ?? null);
    case 'listed':
      return listed(ctx, d.token, d.seller, Number(d.price));
    case 'sold':
      return ctx.db
        .update(marketplaceListings)
        .set({
          status: 'sold',
          buyerId: await userIdFor(ctx, d.buyer),
          soldAt: new Date(),
          platformFee: Number(d.fee),
        })
        .where(activeListing(d.token));
    case 'cancelled':
      return ctx.db
        .update(marketplaceListings)
        .set({ status: 'cancelled' })
        .where(activeListing(d.token));
    case 'batch_settled':
      for (const race of d.races) await raceSettled(ctx, race, Number(d.batch_id));
      return;
    case 'batch_aborted':
      return ctx.db
        .update(drones)
        .set({ inBatch: null, chainSyncedAt: new Date() })
        .where(eq(drones.inBatch, Number(d.batch_id)));
    default:
  }
}

/** @param {unknown} data NEP-297 standard events carry a list; ours carry one object */
const asList = (data) => /** @type {any[]} */ (Array.isArray(data) ? data : [data]);

/** @param {string} token */
const activeListing = (token) =>
  and(eq(marketplaceListings.tokenId, token), eq(marketplaceListings.status, 'active'));

/**
 * A new drone (vendor or milestone): read its stats and name, insert the cache row.
 * @param {Ctx} ctx
 * @param {string} token
 * @param {string} owner
 */
async function droneMinted(ctx, token, owner) {
  const userId = await userIdFor(ctx, owner);
  if (!userId || (await rowFor(ctx, token))) return;
  const chain = /** @type {{ hot: DroneHot, cold: DroneCold } | null} */ (
    await ctx.near.view('get_drone', { token })
  );
  if (!chain) return;
  const { hot, cold } = chain;
  await ctx.db
    .insert(drones)
    .values({
      userId,
      name: cold.name,
      level: hot.level,
      xp: hot.xp,
      xpToNextLevel: calculateXPToNextLevel(hot.level),
      totalStatBudget: calculateTSB(hot.level),
      ...statsFromArray(cold.stats),
      eloRating: hot.elo,
      wins: hot.wins,
      losses: hot.losses,
      totalRaces: hot.wins + hot.losses,
      imageUrl: droneImagePath(hot.level, null),
      active: false,
      tokenId: token,
      chainSyncedAt: new Date(),
    })
    .onConflictDoNothing();
}

/**
 * A new skin or mod (pack reveal, vendor kit): insert the cache row from its template.
 * @param {Ctx} ctx
 * @param {{ token: string, owner: string, kind: 'skin' | 'mod', template: number, rarity: number }} d
 */
async function itemMinted(ctx, d) {
  const userId = await userIdFor(ctx, d.owner);
  if (!userId || (await rowFor(ctx, d.token))) return;
  const base = { userId, tokenId: d.token, template: d.template, chainSyncedAt: new Date() };
  if (d.kind === 'mod') {
    const t = modTemplate(d.template);
    if (!t) throw new Error(`unknown mod template ${d.template}`);
    await ctx.db
      .insert(mods)
      .values({
        ...base,
        name: t.name,
        rarity: t.rarity,
        statBonusType: t.bonusStat,
        statBonusValue: t.bonusStat ? String(t.bonusPct) : null,
        statPenaltyType: t.penaltyStat,
        statPenaltyValue: String(t.penaltyPct),
        specialAbility: t.special,
      })
      .onConflictDoNothing();
    return;
  }
  const t = skinTemplate(d.template);
  let name = t?.name;
  if (!t) {
    const item = /** @type {{ placeholder_name?: string | null } | null} */ (
      await ctx.near.view('get_item', { token: d.token })
    );
    name = item?.placeholder_name ?? 'Unnamed Skin';
  }
  await ctx.db
    .insert(skins)
    .values({
      ...base,
      name: /** @type {string} */ (name),
      rarity: t?.rarity ?? RARITY_NAMES[d.rarity] ?? 'common',
      imageUrl: t ? skinImagePath(t) : `/placeholder/${d.token.replace(':', '-')}.png`,
    })
    .onConflictDoNothing();
}

/**
 * @param {Ctx} ctx
 * @param {string} token
 * @param {number[]} stats
 * @param {number} cost
 */
async function statsAllocated(ctx, token, stats, cost) {
  const row = await rowFor(ctx, token);
  if (!row) return;
  const [drone] = await ctx.db
    .select({ invested: drones.totalPointsInvested })
    .from(drones)
    .where(eq(drones.id, row.id));
  await ctx.db
    .update(drones)
    .set({
      ...statsFromArray(stats),
      totalPointsInvested: (drone?.invested ?? 0) + cost,
      chainSyncedAt: new Date(),
    })
    .where(eq(drones.id, row.id));
}

/**
 * @param {Ctx} ctx
 * @param {string} droneToken
 * @param {string} itemToken
 */
async function itemBound(ctx, droneToken, itemToken) {
  const drone = await rowFor(ctx, droneToken);
  const item = await rowFor(ctx, itemToken);
  if (!drone || !item || item.kind === 'drone') return;
  if (item.kind === 'skin') {
    await ctx.db
      .insert(droneSkins)
      .values({ droneId: drone.id, skinId: item.id, isEquipped: false })
      .onConflictDoNothing();
  } else {
    await ctx.db
      .insert(droneMods)
      .values({ droneId: drone.id, modId: item.id, isEquipped: false })
      .onConflictDoNothing();
  }
}

/**
 * The drone's equipped skin or mod changed (null clears the slot).
 * @param {Ctx} ctx
 * @param {string} droneToken
 * @param {'skin' | 'mod'} kind
 * @param {string | null} itemToken
 */
async function equipped(ctx, droneToken, kind, itemToken) {
  const drone = await rowFor(ctx, droneToken);
  if (!drone) return;
  const item = itemToken ? await rowFor(ctx, itemToken) : null;
  const itemId = item?.id ?? null;
  if (kind === 'skin') {
    await ctx.db
      .update(droneSkins)
      .set({ isEquipped: false })
      .where(eq(droneSkins.droneId, drone.id));
    if (itemId) {
      await ctx.db
        .insert(droneSkins)
        .values({ droneId: drone.id, skinId: itemId, isEquipped: true })
        .onConflictDoUpdate({
          target: [droneSkins.droneId, droneSkins.skinId],
          set: { isEquipped: true },
        });
    }
    await ctx.db
      .update(drones)
      .set({ appliedSkinId: itemId, chainSyncedAt: new Date() })
      .where(eq(drones.id, drone.id));
    return;
  }
  await ctx.db.update(droneMods).set({ isEquipped: false }).where(eq(droneMods.droneId, drone.id));
  if (itemId) {
    await ctx.db
      .insert(droneMods)
      .values({ droneId: drone.id, modId: itemId, isEquipped: true })
      .onConflictDoUpdate({
        target: [droneMods.droneId, droneMods.modId],
        set: { isEquipped: true },
      });
  }
  await ctx.db
    .update(drones)
    .set({ appliedModId: itemId, chainSyncedAt: new Date() })
    .where(eq(drones.id, drone.id));
}

/**
 * A new active listing (the token is now in the contract's escrow).
 * @param {Ctx} ctx
 * @param {string} token
 * @param {string} seller
 * @param {number} price
 */
async function listed(ctx, token, seller, price) {
  const sellerId = await userIdFor(ctx, seller);
  const row = await rowFor(ctx, token);
  if (!sellerId || !row) return;
  const [existing] = await ctx.db
    .select({ id: marketplaceListings.id })
    .from(marketplaceListings)
    .where(activeListing(token))
    .limit(1);
  if (existing) return;
  await ctx.db.insert(marketplaceListings).values({
    sellerId,
    itemType: row.kind,
    droneId: row.kind === 'drone' ? row.id : null,
    skinId: row.kind === 'skin' ? row.id : null,
    modId: row.kind === 'mod' ? row.id : null,
    price,
    status: 'active',
    tokenId: token,
  });
}

/**
 * Tokens moved to `newOwner`. Escrow moves (to the contract on `list`) keep the seller as the
 * cached owner; a sale moves the drone or item to the buyer and parks a drone as inactive.
 * @param {Ctx} ctx
 * @param {string} newOwner
 * @param {string[]} tokens
 */
async function transferred(ctx, newOwner, tokens) {
  if (newOwner === ctx.near.gameId) return;
  const userId = await userIdFor(ctx, newOwner);
  for (const token of tokens) {
    const row = await rowFor(ctx, token);
    if (!row || row.userId === userId) continue;
    /** @type {Record<string, unknown>} */
    const set = { userId, chainSyncedAt: new Date() };
    if (row.kind === 'drone') set.active = false;
    await ctx.db.update(row.table).set(set).where(eq(row.table.id, row.id));
  }
}
