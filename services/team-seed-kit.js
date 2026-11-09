/**
 * A team's on-chain kit (SPEC.md 2.10, 10): drones, skins, mods and Volts minted with the ops key,
 * items bound with the team's play key, and the database cache rebuilt from chain views. Mints
 * cannot be undone, so each one is written to a ledger on the team's users row
 * (`bootstrap_pending` while the seed runs) as soon as it returns, and a mint whose outcome is
 * unknown is resolved by its hash before anything else is minted. A second run mints and binds
 * only what the ledger and the chain do not show.
 */
import { inArray } from 'drizzle-orm';
import { schema } from '@/lib/db';
import { STAT_KEYS } from '@/lib/game-engine/templates.js';
import {
  ContractPanicError,
  RpcUnknownOutcomeError,
  TransactionFailedError,
} from '@/lib/near/errors.js';
import { allocateAlongPersona } from '@/lib/teams/allocation.js';
import { TEAM_DRONE_LEVELS, teamDroneName } from '@/lib/teams/roster.js';
import { applyEvents } from './chain-cache.service.js';
import { recordVoltFlows } from './volt-daily.js';

const { drones } = schema;

/** A team owns 3 drones, 2 skins, 3 mods and whatever its capsules add. */
const OWNED_TOKENS_LIMIT = 100;
/**
 * How long a mint with an unknown outcome blocks the seed. A transaction the RPC still does not
 * know after this long was dropped before it reached a block.
 */
export const UNKNOWN_MINT_WAIT_MS = 10 * 60_000;
/** Ledger entry of the Volt grant (it has no token id). */
const VOLTS = 'volts';

/** Thrown when a step needs the operator: the message says what to do; running again resumes. */
export class SeedBlockedError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'SeedBlockedError';
  }
}

/**
 * @typedef {import('@/lib/teams/roster.js').TeamDef} TeamDef
 * @typedef {{ minted: Record<string, string>, unknown: { key: string, txHash: string, at: number }[] }} Ledger
 *   `minted`: piece key (`d0`-`d2` drones, `s0`-`s1` skins, `m0`-`m2` mods by roster index,
 *   `volts`) to its token id; `unknown`: mints sent whose outcome is not known yet
 * @typedef {{ db: any, near: import('@/lib/near').NearAdapter, def: TeamDef, owner: string, ledger: Ledger, saveLedger: () => Promise<void>, record: (step: string, txHash: string) => void }} KitCtx
 * @typedef {{ token_id: string, hot: { level: number, equipped_skin: string | null, equipped_mod: string | null }, cold: { name: string, bound_skins: string[], bound_mods: string[] } }} ChainDrone
 * @typedef {{ token_id: string, kind: 'skin' | 'mod', template: number, rarity: number, bound_to: string | null }} ChainItem
 * @typedef {{ drones: ChainDrone[], items: ChainItem[] }} ChainKit
 * @typedef {{ key: string, label: string, find: (kit: ChainKit, taken: Set<string>) => string | undefined, method: string, args: Record<string, unknown> }} Piece
 */

/**
 * The ledger stored on the users row, or an empty one.
 * @param {unknown} stored `users.bootstrap_pending`
 * @returns {Ledger}
 */
export function ledgerOf(stored) {
  const l = /** @type {Partial<Ledger> | null} */ (stored);
  return l && !Array.isArray(l) && l.minted
    ? { minted: { ...l.minted }, unknown: [...(l.unknown ?? [])] }
    : { minted: {}, unknown: [] };
}

/**
 * Everything the team account owns on chain.
 * @param {KitCtx} ctx
 * @returns {Promise<ChainKit>}
 */
async function readKit(ctx) {
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
 * The tokens of the roster, in mint order: the three drones (stats along the persona weights, at
 * TSB(L)), then the skins and the mods.
 * @param {KitCtx} ctx
 * @returns {Piece[]}
 */
function pieces({ def, owner }) {
  /** @type {Piece[]} */
  const list = TEAM_DRONE_LEVELS.map((level, i) => {
    const name = teamDroneName(def, i);
    const { stats } = allocateAlongPersona({
      stats: STAT_KEYS.map(() => 1),
      level,
      weights: def.weights,
    });
    return {
      key: `d${i}`,
      label: `mint_drone ${name} (level ${level})`,
      find: (kit) => kit.drones.find((d) => d.cold.name === name)?.token_id,
      method: 'mint_drone',
      args: { owner, name, level, stats, active_hint: true },
    };
  });
  for (const kind of /** @type {const} */ (['skin', 'mod'])) {
    (kind === 'skin' ? def.skins : def.mods).forEach(({ template }, i) =>
      list.push({
        key: `${kind[0]}${i}`,
        label: `mint_item ${kind} template ${template}`,
        find: (kit, taken) =>
          kit.items.find(
            (x) => x.kind === kind && x.template === template && !taken.has(x.token_id)
          )?.token_id,
        method: 'mint_item',
        args: { owner, kind, template, placeholder_name: null },
      })
    );
  }
  return list;
}

/**
 * Mint what is missing: the roster's drones, skins and mods, and Volts up to the starting balance.
 * @param {KitCtx} ctx
 * @param {number} startVolts
 */
export async function mintKit(ctx, startVolts) {
  const { near, owner, ledger } = ctx;
  await resolveUnknown(ctx);
  const kit = await readKit(ctx);
  const taken = new Set(Object.values(ledger.minted));
  for (const piece of pieces(ctx)) {
    if (ledger.minted[piece.key]) continue;
    // A token the chain already shows (a mint this database never recorded) is adopted.
    const token = piece.find(kit, taken) ?? (await mint(ctx, piece));
    taken.add(token);
    ledger.minted[piece.key] = token;
    await ctx.saveLedger();
  }
  if (ledger.minted[VOLTS]) return;
  const balance = Number((await near.view('ft_balance_of', { account_id: owner })) ?? 0);
  if (balance < startVolts) {
    const amount = String(startVolts - balance);
    await mint(ctx, {
      key: VOLTS,
      label: `mint_volts ${amount}`,
      find: () => undefined,
      method: 'mint_volts',
      args: { to: owner, amount },
    });
  }
  ledger.minted[VOLTS] = 'minted';
  await ctx.saveLedger();
}

/**
 * One mint with the ops key. An unknown outcome is written to the ledger and stops the seed.
 * @param {KitCtx} ctx
 * @param {Piece} piece
 * @returns {Promise<string>} the minted token id (empty for Volts)
 */
async function mint(ctx, piece) {
  try {
    const minted = await ctx.near.callAsOps(piece.method, piece.args);
    await recordVoltFlows(minted.events, ctx.db);
    const token = String(minted.result ?? '');
    ctx.record(token ? `${piece.label} -> ${token}` : piece.label, minted.txHash);
    return token;
  } catch (err) {
    if (!(err instanceof RpcUnknownOutcomeError)) throw err;
    ctx.ledger.unknown.push({ key: piece.key, txHash: err.txHash, at: Date.now() });
    await ctx.saveLedger();
    throw new SeedBlockedError(
      `${piece.label} has an unknown outcome (tx ${err.txHash}). Run the script again in a minute.`
    );
  }
}

/**
 * Resolve the mints whose outcome was unknown: one that executed is entered in the ledger, one
 * that failed is dropped, one the RPC does not know blocks the seed until `UNKNOWN_MINT_WAIT_MS`
 * has passed.
 * @param {KitCtx} ctx
 */
async function resolveUnknown(ctx) {
  const { near, owner, ledger } = ctx;
  for (const entry of [...ledger.unknown]) {
    // Resolved: the transaction executed (minted, or failed and minted nothing).
    let resolved = false;
    try {
      const outcome = await near.resolveOutcome(owner, 0, entry.txHash, {
        senderId: near.ownerId,
      });
      if (outcome.applied) {
        resolved = true;
        ledger.minted[entry.key] = entry.key === VOLTS ? 'minted' : String(outcome.result);
        ctx.record(`${entry.key} (resolved) -> ${ledger.minted[entry.key]}`, entry.txHash);
      }
    } catch (err) {
      if (!(err instanceof ContractPanicError) && !(err instanceof TransactionFailedError)) {
        throw err;
      }
      resolved = true;
    }
    if (!resolved && Date.now() - entry.at < UNKNOWN_MINT_WAIT_MS) {
      throw new SeedBlockedError(
        `the mint ${entry.key} (tx ${entry.txHash}) still has no outcome. Run the script again in a few minutes.`
      );
    }
    ledger.unknown = ledger.unknown.filter((u) => u !== entry);
    await ctx.saveLedger();
  }
}

/**
 * Each roster item's token and the drone token it belongs on, in bind order: skins, then mods in
 * roster order (the first mod bound to a drone is equipped).
 * @param {KitCtx} ctx
 * @returns {{ item: string, drone: string }[]}
 */
function bindings({ def, ledger }) {
  return /** @type {const} */ (['skin', 'mod']).flatMap((kind) =>
    (kind === 'skin' ? def.skins : def.mods).map(({ drone }, i) => ({
      item: ledger.minted[`${kind[0]}${i}`],
      drone: ledger.minted[`d${drone}`],
    }))
  );
}

/**
 * Bind each roster item to its drone with the team's play key. Items already bound are left alone.
 * @param {KitCtx} ctx
 * @param {string} playKeyEnc
 */
export async function bindKit(ctx, playKeyEnc) {
  const kit = await readKit(ctx);
  const boundTo = new Map(kit.items.map((item) => [item.token_id, item.bound_to]));
  for (const { item, drone } of bindings(ctx)) {
    const at = boundTo.get(item);
    if (at === drone) continue;
    if (at === undefined) throw lagging(item);
    if (at) throw new Error(`${item} is bound to ${at}, not to ${drone}`);
    const bound = await bindOnce(ctx, playKeyEnc, { drone, item });
    ctx.record(`bind ${item} to ${drone}`, bound.txHash);
  }
}

/** @param {string} token a minted token the chain views do not show yet */
const lagging = (token) =>
  new SeedBlockedError(
    `the chain views do not show ${token} yet. Run the script again in a minute.`
  );

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
 * The views must show the whole kit bound first, so a lagging view never becomes the cache.
 * @param {KitCtx} ctx
 */
export async function cacheKit(ctx) {
  const { owner, ledger } = ctx;
  const kit = await readKit(ctx);
  const droneTokens = TEAM_DRONE_LEVELS.map((_, i) => ledger.minted[`d${i}`]);
  for (const token of droneTokens) {
    if (!kit.drones.some((d) => d.token_id === token)) throw lagging(token);
  }
  for (const { item, drone } of bindings(ctx)) {
    if (kit.items.find((x) => x.token_id === item)?.bound_to !== drone) throw lagging(item);
  }
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
  await ctx.db.update(drones).set({ active: true }).where(inArray(drones.tokenId, droneTokens));
}
