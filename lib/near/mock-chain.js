/**
 * In-memory drones, items, batches and Volt balances behind the mock adapter: the contract's
 * settlement rules (SPEC.md 4.4 `commit_batch`, `settle_batch`, `abort_batch`), wallet links and `withdraw`, and the views they
 * read (`get_drone(s)`, `get_item(s)`, `get_batch`, `stats_hash`, `ft_balance_of`, `get_wallet_link`,
 * `nft_tokens_for_owner`, `nft_supply_for_owner`).
 * Panics carry the SPEC.md 4.8 strings. Payouts, XP, level-ups and ELO follow SPEC.md 2.1 and 2.3
 * through `lib/game-engine/economy.js` (float ELO, so a value may differ from the contract's
 * fixed-point table by 1).
 */

import { createHash } from 'node:crypto';
import {
  calculateNewElo,
  calculateXPToNextLevel,
  computeLoserPayout,
  computeWinnerPayout,
} from '../game-engine/economy.js';
import { statsHash } from '../game-engine/stats-hash.js';
import { TRACKS } from '../game-engine/tracks.js';
import { ContractPanicError } from './errors.js';
import { walletMethods } from './mock-wallet.js';

/** @typedef {import('./events.js').NearEvent} NearEvent */

/**
 * @typedef {object} MockDrone
 * @property {string} owner
 * @property {{ level: number, xp: number, elo: number, wins: number, losses: number, equipped_mod: string | null, equipped_skin: string | null, in_batch: number | null }} hot
 * @property {{ stats: number[], bound_skins: string[], bound_mods: string[], invested: number, name: string }} cold
 */

/**
 * @typedef {object} MockBatch
 * @property {string} seed_hash hex
 * @property {number} committed_at_ms
 * @property {{ a: string, b: string, track: number, weather: number, tod: number }[]} matchups
 * @property {boolean} settled
 * @property {number} settled_count
 * @property {boolean} aborted
 */

const LEVEL_CAP = 20;
const XP_WIN = 10;
const XP_LOSS = 4;
const LEVEL_UP_VOLTS = 20;
const STRATEGY_WINDOW_MS = 120_000;
const WEATHER_COUNT = 7;
const TOD_COUNT = 4;

/**
 * @param {string} panic
 * @param {string} method
 * @returns {never}
 */
const panic = (panic, method) => {
  throw new ContractPanicError(panic, { method });
};

/** @param {ArrayLike<number>} bytes */
const hex = (bytes) => Buffer.from(bytes).toString('hex');
/** @param {string} h */
const bytes = (h) => [...Buffer.from(h, 'hex')];

/**
 * @param {{ gameId: string }} options
 */
export function createMockChain({ gameId }) {
  /** @type {Map<string, MockDrone>} */
  const drones = new Map();
  /** @type {Map<string, { owner: string, kind: 'skin' | 'mod', template: number, rarity: number, bound_to: string | null, placeholder_name: string | null }>} */
  const items = new Map();
  /** @type {Map<number, MockBatch>} */
  const batches = new Map();
  /** @type {Map<string, number>} */
  const balances = new Map();
  /** @type {Map<string, string>} player -> linked wallet (SPEC.md 4.4 `link_wallet`) */
  const walletLinks = new Map();
  let now = () => Date.now();

  /** @param {string} token */
  const drone = (token) => drones.get(token) ?? panic('not found', 'get_drone');

  /** @param {string | null} token */
  const templateOf = (token) => (token ? (items.get(token)?.template ?? 0) : 0);

  /** @param {string} token */
  const hashOf = (token) => {
    const d = drone(token);
    return statsHash(d.cold.stats, templateOf(d.hot.equipped_mod), templateOf(d.hot.equipped_skin));
  };

  /** @param {MockDrone} d */
  const isLocked = (d) => {
    if (d.hot.in_batch === null) return false;
    const b = batches.get(d.hot.in_batch);
    return Boolean(
      b && !b.settled && !b.aborted && now() >= b.committed_at_ms + STRATEGY_WINDOW_MS
    );
  };

  /** @param {string} token */
  const droneView = (token) => {
    const d = drones.get(token);
    return d
      ? {
          token_id: token,
          owner: d.owner,
          hot: { ...d.hot },
          cold: { ...d.cold },
          listed: false,
          locked: isLocked(d),
        }
      : null;
  };

  /** @param {string} token */
  const itemView = (token) => {
    const i = items.get(token);
    return i ? { token_id: token, ...i } : null;
  };

  /** @param {string} owner */
  const tokensOf = (owner) =>
    [...drones.entries(), ...items.entries()]
      .filter(([, record]) => record.owner === owner)
      .map(([token]) => token);

  /** @param {MockBatch} b */
  const batchView = (b) => ({
    ...b,
    seed_hash: bytes(b.seed_hash),
    matchups: b.matchups.map((m) => ({ ...m })),
  });

  /** @type {Record<string, (args: any) => { result?: unknown, events?: NearEvent[] }>} */
  const methods = {
    commit_batch({ batch_id, seed_hash, matchups }) {
      if (batches.has(batch_id)) panic('exists', 'commit_batch');
      const seen = new Set();
      for (const m of matchups) {
        if (m.track >= TRACKS.length || m.weather >= WEATHER_COUNT || m.tod >= TOD_COUNT)
          panic('not found', 'commit_batch');
        for (const token of [m.a, m.b]) {
          if (!drones.has(token)) panic('not found', 'commit_batch');
          const d = drone(token);
          const current = d.hot.in_batch === null ? null : batches.get(d.hot.in_batch);
          if (seen.has(token) || (current && !current.settled && !current.aborted))
            panic('locked', 'commit_batch');
          seen.add(token);
        }
      }
      for (const m of matchups)
        for (const token of [m.a, m.b]) drone(token).hot.in_batch = batch_id;
      batches.set(batch_id, {
        seed_hash: hex(seed_hash),
        committed_at_ms: now(),
        matchups: matchups.map((/** @type {any} */ m) => ({ ...m })),
        settled: false,
        settled_count: 0,
        aborted: false,
      });
      return { events: [event('batch_committed', { batch_id, count: matchups.length })] };
    },

    settle_batch({ batch_id, seed, from, results }) {
      const b = batches.get(batch_id) ?? panic('not found', 'settle_batch');
      if (createHash('sha256').update(Buffer.from(seed)).digest('hex') !== b.seed_hash)
        panic('bad seed', 'settle_batch');
      if (b.settled || b.aborted || from < b.settled_count) panic('settled', 'settle_batch');
      if (from !== b.settled_count || from + results.length > b.matchups.length)
        panic('bad chunk', 'settle_batch');
      results.forEach((/** @type {any} */ r, /** @type {number} */ i) => {
        const m = b.matchups[from + i];
        const winnerTime = r.winner === r.a ? r.time_a_ms : r.time_b_ms;
        const loserTime = r.winner === r.a ? r.time_b_ms : r.time_a_ms;
        if (
          r.a !== m.a ||
          r.b !== m.b ||
          (r.winner !== r.a && r.winner !== r.b) ||
          r.time_a_ms <= 0 ||
          r.time_b_ms <= 0 ||
          winnerTime > loserTime
        )
          panic('bad chunk', 'settle_batch');
        if (hashOf(r.a) !== hex(r.stats_hash_a) || hashOf(r.b) !== hex(r.stats_hash_b))
          panic('state drift', 'settle_batch');
      });
      /** @type {Map<string, number>} */
      const minted = new Map();
      const races = results.map((/** @type {any} */ r, /** @type {number} */ i) => {
        const m = b.matchups[from + i];
        const [w, l] = r.winner === r.a ? [drone(r.a), drone(r.b)] : [drone(r.b), drone(r.a)];
        const winnerTime = r.winner === r.a ? r.time_a_ms : r.time_b_ms;
        const loserTime = r.winner === r.a ? r.time_b_ms : r.time_a_ms;
        const payoutW = computeWinnerPayout({
          winnerLevel: w.hot.level,
          difficulty: TRACKS[m.track].difficulty,
          winnerElo: w.hot.elo,
          loserElo: l.hot.elo,
          winnerTimeMs: winnerTime,
          loserTimeMs: loserTime,
        });
        const payoutL = computeLoserPayout({ loserLevel: l.hot.level });
        const { newWinnerElo, newLoserElo } = calculateNewElo(w.hot.elo, l.hot.elo);
        const vw = payoutW + levelUp(w, XP_WIN);
        const vl = payoutL + levelUp(l, XP_LOSS);
        w.hot.elo = newWinnerElo;
        l.hot.elo = newLoserElo;
        w.hot.wins += 1;
        l.hot.losses += 1;
        w.hot.in_batch = null;
        l.hot.in_batch = null;
        for (const [d, v] of [
          [w, vw],
          [l, vl],
        ]) {
          const owner = /** @type {MockDrone} */ (d).owner;
          if (owner === gameId) continue;
          const amount = /** @type {number} */ (v);
          minted.set(owner, (minted.get(owner) ?? 0) + amount);
          balances.set(owner, (balances.get(owner) ?? 0) + amount);
        }
        const [da, dbb] = [drone(r.a), drone(r.b)];
        const [va, vb] = r.winner === r.a ? [vw, vl] : [vl, vw];
        return {
          i: from + i,
          a: r.a,
          b: r.b,
          winner: r.winner,
          ta: r.time_a_ms,
          tb: r.time_b_ms,
          va: da.owner === gameId ? '0' : String(va),
          vb: dbb.owner === gameId ? '0' : String(vb),
          elo_a: da.hot.elo,
          elo_b: dbb.hot.elo,
          xp_a: da.hot.xp,
          xp_b: dbb.hot.xp,
          lvl_a: da.hot.level,
          lvl_b: dbb.hot.level,
        };
      });
      b.settled_count += results.length;
      if (b.settled_count === b.matchups.length) {
        b.settled = true;
        b.matchups = [];
      }
      /** @type {NearEvent[]} */
      const events = [];
      if (minted.size > 0) {
        events.push(
          event(
            'ft_mint',
            [...minted].map(([owner_id, amount]) => ({ owner_id, amount: String(amount) })),
            'nep141'
          )
        );
      }
      events.push(event('batch_settled', { batch_id, races }));
      return { events };
    },

    abort_batch({ batch_id }) {
      const b = batches.get(batch_id) ?? panic('not found', 'abort_batch');
      if (b.settled || b.aborted) panic('settled', 'abort_batch');
      b.aborted = true;
      let count = 0;
      for (const m of b.matchups) {
        for (const token of [m.a, m.b]) {
          const d = drone(token);
          if (d.hot.in_batch === batch_id) {
            d.hot.in_batch = null;
            count += 1;
          }
        }
      }
      b.matchups = [];
      return { events: [event('batch_aborted', { batch_id, count })] };
    },

    ...walletMethods({ drones, items, balances, walletLinks, event, panic }),

    get_drone: ({ token }) => ({ result: droneView(token) }),
    get_drones: ({ tokens }) => ({ result: tokens.map(droneView) }),
    get_item: ({ token }) => ({ result: itemView(token) }),
    get_items: ({ tokens }) => ({ result: tokens.map(itemView) }),
    get_batch: ({ id }) => {
      const b = batches.get(id);
      return { result: b ? batchView(b) : null };
    },
    stats_hash: ({ token }) => ({ result: drones.has(token) ? bytes(hashOf(token)) : null }),
    ft_balance_of: ({ account_id }) => ({ result: String(balances.get(account_id) ?? 0) }),
    get_wallet_link: ({ player }) => ({ result: walletLinks.get(player) ?? null }),
    nft_supply_for_owner: ({ account_id }) => ({
      result: String(tokensOf(account_id).length),
    }),
    nft_tokens_for_owner: ({ account_id, from_index, limit }) => ({
      result: tokensOf(account_id)
        .slice(Number(from_index ?? 0), Number(from_index ?? 0) + Number(limit ?? 50))
        .map((token_id) => ({ token_id, owner_id: account_id })),
    }),
  };

  /**
   * Adds XP and applies level-ups (SPEC.md 2.1); returns the level-up Volts.
   * @param {MockDrone} d
   * @param {number} xp
   */
  function levelUp(d, xp) {
    d.hot.xp += xp;
    let volts = 0;
    while (d.hot.level < LEVEL_CAP && d.hot.xp >= calculateXPToNextLevel(d.hot.level)) {
      d.hot.xp -= calculateXPToNextLevel(d.hot.level);
      d.hot.level += 1;
      volts += LEVEL_UP_VOLTS;
    }
    return volts;
  }

  return {
    methods,
    drones,
    items,
    batches,
    balances,
    walletLinks,
    /** Replaces the clock the lock rule and `committed_at_ms` use. @param {() => number} fn */
    setNow(fn) {
      now = fn;
    },
    /**
     * @param {string} token
     * @param {{ owner: string, stats?: number[], level?: number, elo?: number, xp?: number, wins?: number, losses?: number, equippedMod?: string | null, equippedSkin?: string | null, name?: string }} d
     */
    addDrone(token, d) {
      drones.set(token, {
        owner: d.owner,
        hot: {
          level: d.level ?? 1,
          xp: d.xp ?? 0,
          elo: d.elo ?? 1000,
          wins: d.wins ?? 0,
          losses: d.losses ?? 0,
          equipped_mod: d.equippedMod ?? null,
          equipped_skin: d.equippedSkin ?? null,
          in_batch: null,
        },
        cold: {
          stats: d.stats ?? [1, 1, 1, 1, 1, 1, 1, 1, 1],
          bound_skins: d.equippedSkin ? [d.equippedSkin] : [],
          bound_mods: d.equippedMod ? [d.equippedMod] : [],
          invested: 0,
          name: d.name ?? token.toUpperCase(),
        },
      });
    },
    /**
     * @param {string} token
     * @param {{ owner: string, kind: 'skin' | 'mod', template: number, rarity?: number, boundTo?: string | null }} i
     */
    addItem(token, i) {
      items.set(token, {
        owner: i.owner,
        kind: i.kind,
        template: i.template,
        rarity: i.rarity ?? 0,
        bound_to: i.boundTo ?? null,
        placeholder_name: null,
      });
    },
    statsHashOf: hashOf,
  };
}

/**
 * @param {string} name
 * @param {unknown} data
 * @param {string} [standard]
 * @returns {NearEvent}
 */
function event(name, data, standard = 'hyperdrome') {
  return { standard, version: '1.0.0', event: name, data, receiptId: 'mock' };
}
