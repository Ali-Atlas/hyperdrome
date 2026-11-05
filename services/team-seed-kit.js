/**
 * A team's on-chain kit (SPEC.md 2.10, 10): drones, skins, mods and Volts minted with the ops key,
 * items bound with the team's play key, and the database cache rebuilt from chain views. Every
 * step reads the chain first, so a second run mints and binds only what is missing.
 */
import { inArray } from 'drizzle-orm';
import { schema } from '@/lib/db';
import { STAT_KEYS } from '@/lib/game-engine/templates.js';
import { RpcUnknownOutcomeError } from '@/lib/near/errors.js';
import { allocateAlongPersona } from '@/lib/teams/policy.js';
import { TEAM_DRONE_LEVELS, teamDroneName } from '@/lib/teams/roster.js';
import { applyEvents } from './chain-cache.service.js';

const { drones } = schema;

/** A team owns 3 drones, 2 skins, 3 mods and whatever its capsules add. */
const OWNED_TOKENS_LIMIT = 100;

/**
 * @typedef {import('@/lib/teams/roster.js').TeamDef} TeamDef
 * @typedef {{ db: any, near: import('@/lib/near').NearAdapter, def: TeamDef, owner: string, record: (step: string, txHash: string) => void }} KitCtx
 * @typedef {{ token_id: string, hot: { level: number, equipped_skin: string | null, equipped_mod: string | null }, cold: { name: string, bound_skins: string[], bound_mods: string[] } }} ChainDrone
 * @typedef {{ token_id: string, kind: 'skin' | 'mod', template: number, rarity: number, bound_to: string | null }} ChainItem
 * @typedef {{ drones: ChainDrone[], items: ChainItem[] }} ChainKit
 */

/**
 * Everything the team account owns on chain.
 * @param {KitCtx} ctx
 * @returns {Promise<ChainKit>}
 */
export async function readKit(ctx) {
  const owned = /** @type {{ token_id: string }[] | null} */ (
    await ctx.near.view('nft_tokens_for_owner', {
      account_id: ctx.owner,
      from_index: '0',
      limit: OWNED_TOKENS_LIMIT,
    })
  );
  const ids = (owned ?? []).map((t) => t.token_id);
  const droneIds = ids.filter((id) => id.startsWith('d:'));
  const itemIds = ids.filter((id) => !id.startsWith('d:'));
  const droneViews = droneIds.length
    ? /** @type {(ChainDrone | null)[]} */ (await ctx.near.view('get_drones', { tokens: droneIds }))
    : [];
  const itemViews = itemIds.length
    ? /** @type {(ChainItem | null)[]} */ (await ctx.near.view('get_items', { tokens: itemIds }))
    : [];
  return {
    drones: /** @type {ChainDrone[]} */ (droneViews.filter(Boolean)),
    items: /** @type {ChainItem[]} */ (itemViews.filter(Boolean)),
  };
}

/**
 * The team's drone tokens by drone index; throws when one is missing on chain.
 * @param {TeamDef} def
 * @param {ChainKit} kit
 * @returns {string[]}
 */
function droneTokens(def, kit) {
  return TEAM_DRONE_LEVELS.map((_, i) => {
    const name = teamDroneName(def, i);
    const drone = kit.drones.find((d) => d.cold.name === name);
    if (!drone) throw new Error(`drone ${name} is not on chain`);
    return drone.token_id;
  });
}

/**
 * Mint what is missing: the three drones (stats along the persona weights, at TSB(L)), the skins
 * and mods of the roster, and Volts up to the starting balance.
 * @param {KitCtx} ctx
 * @param {number} startVolts
 */
export async function mintKit(ctx, startVolts) {
  const { near, def, owner } = ctx;
  const kit = await readKit(ctx);
  for (const [i, level] of TEAM_DRONE_LEVELS.entries()) {
    const name = teamDroneName(def, i);
    if (kit.drones.some((d) => d.cold.name === name)) continue;
    const { stats } = allocateAlongPersona({
      stats: STAT_KEYS.map(() => 1),
      level,
      weights: def.weights,
    });
    const minted = await near.callAsOps('mint_drone', {
      owner,
      name,
      level,
      stats,
      active_hint: true,
    });
    ctx.record(`mint_drone ${name} (level ${level}) -> ${minted.result}`, minted.txHash);
  }
  for (const kind of /** @type {const} */ (['skin', 'mod'])) {
    const have = kit.items.filter((item) => item.kind === kind).map((item) => item.template);
    for (const { template } of kind === 'skin' ? def.skins : def.mods) {
      const at = have.indexOf(template);
      if (at >= 0) {
        have.splice(at, 1);
        continue;
      }
      const minted = await near.callAsOps('mint_item', {
        owner,
        kind,
        template,
        placeholder_name: null,
      });
      ctx.record(`mint_item ${kind} template ${template} -> ${minted.result}`, minted.txHash);
    }
  }
  const balance = Number((await near.view('ft_balance_of', { account_id: owner })) ?? 0);
  if (balance < startVolts) {
    const amount = String(startVolts - balance);
    const minted = await near.callAsOps('mint_volts', { to: owner, amount });
    ctx.record(`mint_volts ${amount}`, minted.txHash);
  }
}

/**
 * Bind each roster item to its drone with the team's play key, in roster order (the first mod
 * bound to a drone is equipped). Items already bound to their drone are left alone.
 * @param {KitCtx} ctx
 * @param {string} playKeyEnc
 */
export async function bindKit(ctx, playKeyEnc) {
  const { def } = ctx;
  const kit = await readKit(ctx);
  const tokens = droneTokens(def, kit);
  const pool = [...kit.items];
  /**
   * Take the first pooled item that matches, so two wanted items never claim the same token.
   * @param {(item: ChainItem) => boolean} match
   */
  const take = (match) => {
    const at = pool.findIndex(match);
    return at >= 0 ? pool.splice(at, 1)[0] : null;
  };
  for (const kind of /** @type {const} */ (['skin', 'mod'])) {
    for (const { template, drone } of kind === 'skin' ? def.skins : def.mods) {
      const target = tokens[drone];
      /** @param {ChainItem} item */
      const wanted = (item) => item.kind === kind && item.template === template;
      if (take((item) => wanted(item) && item.bound_to === target)) continue;
      const item = take((x) => wanted(x) && x.bound_to === null);
      if (!item) throw new Error(`no unbound ${kind} of template ${template} to bind`);
      const bound = await bindOnce(ctx, playKeyEnc, { drone: target, item: item.token_id });
      ctx.record(`bind ${item.token_id} to ${target}`, bound.txHash);
    }
  }
}

/**
 * One `bind` with the play key; an unknown outcome is resolved by seq and hash before failing.
 * @param {KitCtx} ctx
 * @param {string} playKeyEnc
 * @param {{ drone: string, item: string }} args
 */
async function bindOnce(ctx, playKeyEnc, args) {
  try {
    return await ctx.near.callAsPlayer(ctx.owner, playKeyEnc, 'bind', args);
  } catch (err) {
    if (!(err instanceof RpcUnknownOutcomeError) || err.seq === undefined) throw err;
    const outcome = await ctx.near.resolveOutcome(ctx.owner, err.seq, err.txHash);
    if (!outcome.applied) throw err;
    return outcome;
  }
}

/**
 * Rebuild the team's cache rows from chain views: drones, items, bound and equipped state go
 * through the same event path the game uses (`applyEvents`), and the three drones are set active.
 * @param {KitCtx} ctx
 */
export async function cacheKit(ctx) {
  const { owner } = ctx;
  const kit = await readKit(ctx);
  /**
   * @param {string} event
   * @param {Record<string, unknown>} data
   */
  const ev = (event, data) => ({
    standard: 'hyperdrome',
    version: '1.0.0',
    event,
    data,
    receiptId: 'seed-teams',
  });
  const events = [
    ...kit.drones.map((d) => ev('drone_minted', { token: d.token_id, owner, level: d.hot.level })),
    ...kit.items.map((i) =>
      ev('item_minted', {
        token: i.token_id,
        owner,
        kind: i.kind,
        template: i.template,
        rarity: i.rarity,
      })
    ),
    ...kit.drones.flatMap((d) =>
      [...d.cold.bound_skins, ...d.cold.bound_mods].map((item) =>
        ev('item_bound', { drone: d.token_id, item })
      )
    ),
    ...kit.drones.flatMap((d) =>
      /** @type {const} */ ([
        ['skin', d.hot.equipped_skin],
        ['mod', d.hot.equipped_mod],
      ])
        .filter(([, item]) => item)
        .map(([kind, item]) => ev('equipped', { drone: d.token_id, kind, item }))
    ),
  ];
  await applyEvents(events, ctx);
  await ctx.db
    .update(drones)
    .set({ active: true })
    .where(inArray(drones.tokenId, droneTokens(ctx.def, kit)));
}
