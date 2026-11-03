/**
 * Starter kit steps of the bootstrap (SPEC.md 2.2, 12). Every step reads the chain first, so a
 * retry after a partial failure only mints or binds what is missing; each minted token id is
 * written to its cache row (drones, skins, mods) as soon as it exists.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { schema } from '@/lib/db';
import { generateUniqueDroneName } from '@/lib/game-engine/drone-names.js';
import { STARTER_VOLTS, calculateXPToNextLevel } from '@/lib/game-engine/economy.js';
import { modTemplate } from '@/lib/game-engine/templates.js';
import { RpcUnknownOutcomeError } from '@/lib/near/errors.js';

const { drones, skins, mods, droneSkins, droneMods, droneOwnershipHistory } = schema;

/** The starter skin (SPEC.md 2.2, 2.6): Ember, common template 4. */
export const STARTER_SKIN = Object.freeze({
  template: 4,
  name: 'Ember',
  rarity: 'common',
  imageUrl: '/skins/common/ember.webp',
});

/** Starter drone (SPEC.md 2.1): level 1, every stat 1. */
const STARTER_STATS = Object.freeze([1, 1, 1, 1, 1, 1, 1, 1, 1]);

/** Enough for the starter kit (one drone, one skin, one mod) with room for a few strays. */
const OWNED_TOKENS_LIMIT = 50;

/**
 * @typedef {import('./bootstrap.service.js').Ctx} Ctx
 * @typedef {{ cold: { name: string, bound_skins: string[], bound_mods: string[] }, hot: { equipped_skin: string | null, equipped_mod: string | null } }} ChainDrone
 */

/**
 * The user's starter drone cache row (the first drone with a token id), if any.
 * @param {any} db
 * @param {string} userId
 * @returns {Promise<typeof drones.$inferSelect | null>}
 */
export async function findStarterDrone(db, userId) {
  const [row] = await db
    .select()
    .from(drones)
    .where(and(eq(drones.userId, userId), isNotNull(drones.tokenId)))
    .orderBy(drones.createdAt)
    .limit(1);
  return row ?? null;
}

/**
 * Step 2, `account -> minted`: drone, Ember, one common mod and 1,000 Volts, each only if missing.
 * Tokens the account already owns on chain (a mint whose outcome was unknown) are adopted.
 * @param {Ctx} ctx
 * @param {string} owner the player's NEAR account
 */
export async function ensureStarterKit(ctx, owner) {
  const owned = /** @type {Array<{ token_id: string }> | null} */ (
    await ctx.near.view('nft_tokens_for_owner', {
      account_id: owner,
      from_index: '0',
      limit: OWNED_TOKENS_LIMIT,
    })
  );
  const ids = (owned ?? []).map((t) => t.token_id);
  const onChain = (/** @type {string} */ prefix) => ids.find((id) => id.startsWith(prefix)) ?? null;

  if (!(await findStarterDrone(ctx.db, ctx.userId))) await addDrone(ctx, owner, onChain('d:'));
  if (!(await findItem(ctx, skins))) await addSkin(ctx, owner, onChain('s:'));
  if (!(await findItem(ctx, mods))) await addMod(ctx, owner, onChain('m:'));

  const balance = BigInt(
    /** @type {string} */ ((await ctx.near.view('ft_balance_of', { account_id: owner })) ?? '0')
  );
  if (balance < BigInt(STARTER_VOLTS)) {
    await ctx.near.callAsOps('mint_volts', {
      to: owner,
      amount: String(BigInt(STARTER_VOLTS) - balance),
    });
  }
}

/**
 * Step 3, `minted -> done`: bind the skin and the mod to the drone with the play key (bind
 * auto-equips an empty slot), update the caches from the events, and return the Volts balance.
 * @param {Ctx} ctx
 * @param {import('./bootstrap.service.js').UserRow} user
 * @returns {Promise<number>} `ft_balance_of`, for `users.points`
 */
export async function bindStarterKit(ctx, user) {
  const owner = /** @type {string} */ (user.nearAccountId);
  const drone = await findStarterDrone(ctx.db, ctx.userId);
  const skin = await findItem(ctx, skins);
  const mod = await findItem(ctx, mods);
  if (!drone?.tokenId || !skin?.tokenId || !mod?.tokenId) {
    throw new Error('starter kit cache rows missing at bind');
  }

  const chain = /** @type {ChainDrone} */ (
    await ctx.near.view('get_drone', { token: drone.tokenId })
  );
  const bound = new Set([...chain.cold.bound_skins, ...chain.cold.bound_mods]);
  /** @type {{ skin: string | null, mod: string | null }} */
  const equipped = { skin: chain.hot.equipped_skin, mod: chain.hot.equipped_mod };

  for (const item of [skin.tokenId, mod.tokenId]) {
    if (bound.has(item)) continue;
    const { events } = await bindOnce(ctx, owner, /** @type {string} */ (user.playKeyEnc), {
      drone: drone.tokenId,
      item,
    });
    for (const e of events) {
      const data = /** @type {{ item: string, kind?: 'skin' | 'mod' }} */ (e.data);
      if (e.event === 'item_bound') bound.add(data.item);
      if (e.event === 'equipped' && data.kind) equipped[data.kind] = data.item;
    }
  }

  await cacheBinding(ctx, drone.id, droneSkins, 'skinId', skin.id, equipped.skin === skin.tokenId);
  await cacheBinding(ctx, drone.id, droneMods, 'modId', mod.id, equipped.mod === mod.tokenId);
  await ctx.db
    .update(drones)
    .set({
      appliedSkinId: equipped.skin === skin.tokenId ? skin.id : null,
      appliedModId: equipped.mod === mod.tokenId ? mod.id : null,
      chainSyncedAt: new Date(),
    })
    .where(eq(drones.id, drone.id));

  return Number(await ctx.near.view('ft_balance_of', { account_id: owner }));
}

/**
 * One `bind` with the play key; an unknown outcome is resolved by seq and hash before failing.
 * @param {Ctx} ctx
 * @param {string} owner
 * @param {string} playKeyEnc
 * @param {{ drone: string, item: string }} args
 */
async function bindOnce(ctx, owner, playKeyEnc, args) {
  try {
    return await ctx.near.callAsPlayer(owner, playKeyEnc, 'bind', args);
  } catch (err) {
    if (!(err instanceof RpcUnknownOutcomeError) || err.seq === undefined) throw err;
    const outcome = await ctx.near.resolveOutcome(owner, err.seq, err.txHash);
    if (!outcome.applied) throw err;
    return outcome;
  }
}

/**
 * The user's first skin or mod row with a token id.
 * @param {Ctx} ctx
 * @param {typeof skins | typeof mods} table
 */
async function findItem(ctx, table) {
  const [row] = await ctx.db
    .select()
    .from(table)
    .where(and(eq(table.userId, ctx.userId), isNotNull(table.tokenId)))
    .limit(1);
  return row ?? null;
}

/**
 * @param {Ctx} ctx
 * @param {string} owner
 * @param {string | null} existing a drone token the account already owns
 */
async function addDrone(ctx, owner, existing) {
  let tokenId = existing;
  let name;
  if (tokenId) {
    name = /** @type {ChainDrone} */ (await ctx.near.view('get_drone', { token: tokenId })).cold
      .name;
  } else {
    name = await generateUniqueDroneName(ctx.db, drones);
    const minted = await ctx.near.callAsOps('mint_drone', {
      owner,
      name,
      level: 1,
      stats: STARTER_STATS,
      active_hint: true,
    });
    tokenId = /** @type {string} */ (minted.result);
  }
  const [row] = await ctx.db
    .insert(drones)
    .values({
      userId: ctx.userId,
      name,
      level: 1,
      xpToNextLevel: calculateXPToNextLevel(1),
      active: true,
      tokenId,
      chainSyncedAt: new Date(),
    })
    .returning();
  await ctx.db
    .insert(droneOwnershipHistory)
    .values({ droneId: row.id, ownerUserId: ctx.userId, transactionType: 'creation' });
}

/**
 * @param {Ctx} ctx
 * @param {string} owner
 * @param {string | null} existing a skin token the account already owns
 */
async function addSkin(ctx, owner, existing) {
  const tokenId = existing ?? (await mintItem(ctx, owner, 'skin', STARTER_SKIN.template));
  await ctx.db.insert(skins).values({
    userId: ctx.userId,
    name: STARTER_SKIN.name,
    rarity: STARTER_SKIN.rarity,
    imageUrl: STARTER_SKIN.imageUrl,
    template: STARTER_SKIN.template,
    tokenId,
    chainSyncedAt: new Date(),
  });
}

/**
 * @param {Ctx} ctx
 * @param {string} owner
 * @param {string | null} existing a mod token the account already owns
 */
async function addMod(ctx, owner, existing) {
  let tokenId = existing;
  let template;
  if (tokenId) {
    template = /** @type {{ template: number }} */ (
      await ctx.near.view('get_item', { token: tokenId })
    ).template;
  } else {
    template = ctx.pickModTemplate();
    tokenId = await mintItem(ctx, owner, 'mod', template);
  }
  const t = modTemplate(template);
  if (!t) throw new Error(`unknown mod template ${template}`);
  await ctx.db.insert(mods).values({
    userId: ctx.userId,
    name: t.name,
    rarity: t.rarity,
    statBonusType: t.bonusStat,
    statBonusValue: t.bonusStat ? String(t.bonusPct) : null,
    statPenaltyType: t.penaltyStat,
    statPenaltyValue: String(t.penaltyPct),
    specialAbility: t.special,
    template,
    tokenId,
    chainSyncedAt: new Date(),
  });
}

/**
 * @param {Ctx} ctx
 * @param {string} owner
 * @param {'skin' | 'mod'} kind
 * @param {number} template
 * @returns {Promise<string>} the new token id
 */
async function mintItem(ctx, owner, kind, template) {
  const minted = await ctx.near.callAsOps('mint_item', {
    owner,
    kind,
    template,
    placeholder_name: null,
  });
  return /** @type {string} */ (minted.result);
}

/**
 * Upsert the drone-item cache row (bound, with its equipped flag).
 * @param {Ctx} ctx
 * @param {string} droneId
 * @param {typeof droneSkins | typeof droneMods} table
 * @param {'skinId' | 'modId'} column
 * @param {string} itemId
 * @param {boolean} isEquipped
 */
async function cacheBinding(ctx, droneId, table, column, itemId, isEquipped) {
  await ctx.db
    .insert(table)
    .values({ droneId, [column]: itemId, isEquipped })
    .onConflictDoUpdate({
      target: [table.droneId, /** @type {any} */ (table)[column]],
      set: { isEquipped },
    });
}
