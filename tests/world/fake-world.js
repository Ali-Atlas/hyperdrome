/**
 * The contract pieces the world seed touches, on top of the mock adapter (lib/near/mock.js):
 * `mint_drone` with the contract's checks (SPEC.md 4.4), `nft_tokens_for_owner`, the `listed` flag
 * of `get_drones` and `get_catalog` built from the app's mirrors of the catalog. Test-only.
 */
import { randomInt } from 'node:crypto';
import { calculatePerStatCap, calculateTSB } from '../../lib/game-engine/economy.js';
import { RARITY_NAMES, SKIN_TEMPLATES } from '../../lib/game-engine/skin-templates.js';
import { MOD_TEMPLATES, STAT_KEYS } from '../../lib/game-engine/templates.js';
import { ContractPanicError } from '../../lib/near/errors.js';
import { createMockNear } from '../../lib/near/mock.js';

/** Supply caps by rarity id (SPEC.md 2.6). */
const SKIN_CAPS = [10, 6, 4, 3];
/** Ember, the uncapped starter skin (SPEC.md 2.2). */
const EMBER = 4;

/**
 * The `get_catalog()` answer for the app's catalog mirrors.
 * @param {{ skinCaps?: Record<number, number | null> }} [overrides] caps by skin template id
 */
export function catalogView(overrides = {}) {
  return {
    skins: SKIN_TEMPLATES.map((t) => {
      const rarity = RARITY_NAMES.indexOf(t.rarity);
      const cap = t.id === EMBER ? null : SKIN_CAPS[rarity];
      return {
        id: t.id,
        slug: t.slug,
        file: t.file,
        rarity,
        rarity_name: t.rarity,
        cap: overrides.skinCaps && t.id in overrides.skinCaps ? overrides.skinCaps[t.id] : cap,
        minted: 0,
      };
    }),
    mods: MOD_TEMPLATES.map((m) => ({
      id: m.id,
      name: m.name,
      rarity: RARITY_NAMES.indexOf(m.rarity),
      bonus_stat: m.bonusStat === null ? null : STAT_KEYS.indexOf(m.bonusStat),
      bonus_pct: m.bonusPct,
      penalty_stat: STAT_KEYS.indexOf(m.penaltyStat),
      penalty_pct: m.penaltyPct,
      special: m.special,
    })),
    stat_names: [...STAT_KEYS],
  };
}

/**
 * A mock adapter whose chain mints drones and lists them by owner.
 * @param {{ failMintAt?: number }} [options] the 1-based `mint_drone` call that throws once
 */
export function createFakeWorld(options = {}) {
  const near = createMockNear();
  const { chain } = near.mock;
  // Token numbers start at a random base: every test shares one database with unique token ids.
  let counter = randomInt(1_000_000_000);
  let mintCalls = 0;
  /** @type {Set<string>} */
  const listed = new Set();
  /** @type {string[]} */
  const minted = [];
  /** @type {ReturnType<typeof catalogView>} */
  let catalog = catalogView();

  /**
   * @param {string} method
   * @param {(args: any) => { result?: unknown, events?: any[] }} fn
   */
  const on = (method, fn) => near.mock.on(method, /** @type {any} */ (fn));

  on('mint_drone', ({ owner, name, level, stats }) => {
    mintCalls += 1;
    if (mintCalls === options.failMintAt) throw new Error('injected mint failure');
    /** @param {string} panic */
    const refuse = (panic) => {
      throw new ContractPanicError(panic, { method: 'mint_drone' });
    };
    if (!Number.isInteger(level) || level < 1 || level > 20) refuse('bad level');
    if (stats.length !== 9 || stats.some((/** @type {number} */ s) => s < 1)) refuse('bad stat');
    if (stats.some((/** @type {number} */ s) => s > calculatePerStatCap(level))) refuse('over cap');
    const sum = stats.reduce((/** @type {number} */ a, /** @type {number} */ b) => a + b, 0);
    if (sum > calculateTSB(level)) refuse('tsb exceeded');
    const token = `d:${++counter}`;
    chain.addDrone(token, { owner, stats, level, name });
    minted.push(token);
    return { result: token, events: [] };
  });
  on('nft_tokens_for_owner', ({ account_id, from_index, limit }) => {
    const owned = [...chain.drones].filter(([, d]) => d.owner === account_id).map(([id]) => id);
    const from = Number(from_index);
    return { result: owned.slice(from, from + limit).map((token_id) => ({ token_id })) };
  });
  on('get_drones', ({ tokens }) => ({
    result: /** @type {any[]} */ (chain.methods.get_drones({ tokens }).result).map(
      (view) => view && { ...view, listed: listed.has(view.token_id) }
    ),
  }));
  on('get_catalog', () => ({ result: catalog }));

  return {
    near,
    /** Token ids minted through `mint_drone`, in order. */
    minted,
    /** `mint_drone` calls the seed sent (failed ones included). */
    mintArgs: () =>
      near.mock.calls
        .filter((c) => c.kind === 'ops' && c.method === 'mint_drone')
        .map((c) => c.args),
    /**
     * A drone the contract holds in escrow for a listing: contract-owned, `listed` true.
     * @param {number} level
     */
    addEscrowedListing(level) {
      const token = `d:${++counter}`;
      chain.addDrone(token, { owner: near.gameId, level });
      listed.add(token);
      return token;
    },
    /** @param {ReturnType<typeof catalogView>} next */
    setCatalog(next) {
      catalog = next;
    },
  };
}
