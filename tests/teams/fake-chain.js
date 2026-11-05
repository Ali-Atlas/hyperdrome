/**
 * In-memory game contract for the team tests, on the mock adapter (lib/near/mock.js): the owner
 * mints, the player methods a team uses and the views the seed and the runner read, with the
 * SPEC.md 4.7 events. Test-only; it checks Volts and nothing else.
 */
import { randomInt } from 'node:crypto';
import { calculateTotalUpgradeCost } from '../../lib/game-engine/economy.js';
import { RARITY_NAMES } from '../../lib/game-engine/skin-templates.js';
import { modTemplate } from '../../lib/game-engine/templates.js';
import { ContractPanicError } from '../../lib/near/errors.js';
import { createMockNear } from '../../lib/near/mock.js';
import { ev } from '../gameplay/setup.js';

/** The `get_constants()` fields the teams read (SPEC.md 2.7, 2.10). */
export const TEAM_CONSTANTS = {
  economy: {
    packs: [
      { id: 0, name: 'starter', skin_pack_price: '2000', mod_capsule_price: '1000' },
      { id: 1, name: 'premium', skin_pack_price: '12000', mod_capsule_price: '6000' },
      { id: 2, name: 'legendary', skin_pack_price: '60000', mod_capsule_price: '30000' },
    ],
    team_drone_levels: [4, 5, 8],
    team_start_volts: '20000',
    team_per_tx_cap: '5000',
    team_per_day_cap: '15000',
    team_reserve: '5000',
  },
};

/**
 * @typedef {{ owner: string, name: string, level: number, stats: number[], skins: string[], mods: string[], equipped: { skin: string | null, mod: string | null } }} FakeDrone
 * @typedef {{ owner: string, kind: 'skin' | 'mod', template: number, rarity: number, boundTo: string | null }} FakeItem
 */

/** A fresh mock adapter with the fake contract behind it. */
export function createTeamChain() {
  const near = createMockNear({ constants: TEAM_CONSTANTS });
  /** @type {Map<string, FakeDrone>} */
  const drones = new Map();
  /** @type {Map<string, FakeItem>} */
  const items = new Map();
  /** @type {Map<string, number>} */
  const volts = new Map();
  /** @type {Map<string, { per_tx: string, per_day: string }>} */
  const budgets = new Map();
  /** @type {Map<string, { seller: string, price: number }>} */
  const listings = new Map();
  /** @type {Map<number, string>} pack id -> buyer */
  const packs = new Map();
  /** @type {Map<string, string>} method -> panic */
  const refusals = new Map();
  /** @type {number[][]} mod templates of the next capsule reveals */
  const draws = [];
  // Ids start at a random base: every test shares one database with unique token ids.
  const counters = { d: randomInt(1_000_000_000), s: randomInt(1_000_000_000), m: 0, pack: 0 };
  counters.m = counters.s;
  counters.pack = counters.s;

  /**
   * Register a handler with loose arg types; a refusal set with `refuse` panics first.
   * @param {string} method
   * @param {(args: any, ctx: { accountId: string | null }) => { result?: unknown, events?: any[] }} fn
   */
  const on = (method, fn) =>
    near.mock.on(method, (args, ctx) => {
      const panic = refusals.get(method);
      if (panic) throw new ContractPanicError(panic, { method });
      return fn(args, ctx);
    });

  /** @param {string} account @param {number} amount */
  const spend = (account, amount) => {
    const balance = volts.get(account) ?? 0;
    if (balance < amount) throw new ContractPanicError('insufficient volts', {});
    volts.set(account, balance - amount);
    return ev('ft_burn', [{ owner_id: account, amount: String(amount) }], 'nep141');
  };

  /** @param {string} owner @param {'skin' | 'mod'} kind @param {number} template */
  const mintItem = (owner, kind, template) => {
    const token = `${kind === 'skin' ? 's' : 'm'}:${++counters[kind === 'skin' ? 's' : 'm']}`;
    const rarity =
      kind === 'mod'
        ? RARITY_NAMES.indexOf(/** @type {any} */ (modTemplate(template)).rarity)
        : Math.floor((template - 1) / 8);
    items.set(token, { owner, kind, template, rarity, boundTo: null });
    return { token, event: ev('item_minted', { token, owner, kind, template, rarity }) };
  };

  /** @param {string} from @param {string} to @param {string} token */
  const moved = (from, to, token) =>
    ev('nft_transfer', [{ old_owner_id: from, new_owner_id: to, token_ids: [token] }], 'nep171');

  on('mint_drone', (a) => {
    const token = `d:${++counters.d}`;
    drones.set(token, {
      owner: a.owner,
      name: a.name,
      level: a.level,
      stats: a.stats,
      skins: [],
      mods: [],
      equipped: { skin: null, mod: null },
    });
    return {
      result: token,
      events: [ev('drone_minted', { token, owner: a.owner, level: a.level })],
    };
  });
  on('mint_item', (a) => {
    const { token, event } = mintItem(a.owner, a.kind, a.template);
    return { result: token, events: [event] };
  });
  on('mint_volts', (a) => {
    volts.set(a.to, (volts.get(a.to) ?? 0) + Number(a.amount));
    return { events: [ev('ft_mint', [{ owner_id: a.to, amount: a.amount }], 'nep141')] };
  });
  on('set_team_budget', (a) => {
    budgets.set(a.account, { per_tx: a.per_tx, per_day: a.per_day });
    return {};
  });
  on('bind', (a, { accountId }) => {
    const drone = /** @type {FakeDrone} */ (drones.get(a.drone));
    const item = /** @type {FakeItem} */ (items.get(a.item));
    if (drone.owner !== accountId || item.owner !== accountId) {
      throw new ContractPanicError('not owner', {});
    }
    if (item.boundTo) throw new ContractPanicError('bound item', {});
    item.boundTo = a.drone;
    drone[item.kind === 'skin' ? 'skins' : 'mods'].push(a.item);
    const events = [ev('item_bound', { drone: a.drone, item: a.item })];
    // Skins equip by the tier rule (SPEC.md 2.6): of the commons, only Ember, on tier 1.
    const fits = item.kind === 'mod' || (item.template === 4 && drone.level <= 5);
    if (!drone.equipped[item.kind] && fits) {
      drone.equipped[item.kind] = a.item;
      events.push(ev('equipped', { drone: a.drone, kind: item.kind, item: a.item }));
    }
    return { events };
  });
  on('equip', (a) => {
    const drone = /** @type {FakeDrone} */ (drones.get(a.drone));
    drone.equipped[/** @type {'skin' | 'mod'} */ (a.kind)] = a.item;
    return { events: [ev('equipped', { drone: a.drone, kind: a.kind, item: a.item })] };
  });
  on('allocate_stats', (a, { accountId }) => {
    const drone = /** @type {FakeDrone} */ (drones.get(a.drone));
    const cost = drone.stats.reduce(
      (sum, from, i) => sum + calculateTotalUpgradeCost(from, a.stats[i]),
      0
    );
    const burn = spend(String(accountId), cost);
    drone.stats = a.stats;
    return {
      events: [burn, ev('stats_allocated', { drone: a.drone, stats: a.stats, cost: String(cost) })],
    };
  });
  on('open_pack', (a, { accountId }) => {
    const price = Number(TEAM_CONSTANTS.economy.packs[a.tier].mod_capsule_price);
    const burn = spend(String(accountId), price);
    const id = ++counters.pack;
    packs.set(id, String(accountId));
    return {
      result: id,
      events: [burn, ev('pack_committed', { pack_id: id, buyer: accountId, kind: 'mod' })],
    };
  });
  on('reveal_pack', (a) => {
    const buyer = /** @type {string} */ (packs.get(a.pack_id));
    const minted = (draws.shift() ?? [1, 2, 3]).map((t) => mintItem(buyer, 'mod', t));
    return {
      events: [
        ...minted.map((m) => m.event),
        ev('pack_opened', { pack_id: a.pack_id, tokens: minted.map((m) => m.token) }),
      ],
    };
  });
  on('list', (a, { accountId }) => {
    const seller = String(accountId);
    listings.set(a.token, { seller, price: Number(a.price) });
    /** @type {FakeItem} */ (items.get(a.token)).owner = near.gameId;
    return {
      events: [
        moved(seller, near.gameId, a.token),
        ev('listed', { token: a.token, seller, price: a.price }),
      ],
    };
  });
  on('buy', (a, { accountId }) => {
    const buyer = String(accountId);
    const listing = listings.get(a.token);
    if (!listing) throw new ContractPanicError('not listed', {});
    const fee = Math.floor(listing.price / 10);
    if ((volts.get(buyer) ?? 0) < listing.price) {
      throw new ContractPanicError('insufficient volts', {});
    }
    volts.set(buyer, (volts.get(buyer) ?? 0) - listing.price);
    volts.set(listing.seller, (volts.get(listing.seller) ?? 0) + listing.price - fee);
    listings.delete(a.token);
    /** @type {FakeItem} */ (items.get(a.token)).owner = buyer;
    /** @param {string} to @param {number} amount */
    const paid = (to, amount) =>
      ev(
        'ft_transfer',
        [{ old_owner_id: buyer, new_owner_id: to, amount: String(amount) }],
        'nep141'
      );
    return {
      events: [
        paid(listing.seller, listing.price - fee),
        paid(near.ownerId, fee),
        moved(near.gameId, buyer, a.token),
        ev('sold', {
          token: a.token,
          seller: listing.seller,
          buyer,
          price: String(listing.price),
          fee: String(fee),
        }),
      ],
    };
  });

  /** @param {string} token */
  const droneView = (token) => {
    const d = drones.get(token);
    if (!d) return null;
    return {
      token_id: token,
      owner: d.owner,
      hot: {
        level: d.level,
        xp: 0,
        elo: 1000,
        wins: 0,
        losses: 0,
        equipped_mod: d.equipped.mod,
        equipped_skin: d.equipped.skin,
        in_batch: null,
      },
      cold: { stats: d.stats, bound_skins: d.skins, bound_mods: d.mods, invested: 0, name: d.name },
      listed: false,
      locked: false,
    };
  };
  /** @param {string} token */
  const itemView = (token) => {
    const i = items.get(token);
    return i ? { token_id: token, ...i, bound_to: i.boundTo } : null;
  };
  on('get_drone', (a) => ({ result: droneView(a.token) }));
  on('get_drones', (a) => ({ result: a.tokens.map(droneView) }));
  on('get_item', (a) => ({ result: itemView(a.token) }));
  on('get_items', (a) => ({ result: a.tokens.map(itemView) }));
  on('get_team', (a) => {
    const b = budgets.get(a.account);
    return { result: b ? { ...b, spent: '0', day: 0 } : null };
  });
  on('ft_balance_of', (a) => ({ result: String(volts.get(a.account_id) ?? 0) }));
  on('nft_tokens_for_owner', (a) => ({
    result: [...drones, ...items]
      .filter(([, t]) => t.owner === a.account_id)
      .map(([token_id]) => ({ token_id })),
  }));

  return {
    near,
    drones,
    items,
    volts,
    /** The next capsule reveal mints these mod templates. */
    draw: (/** @type {number[]} */ templates) => void draws.push(templates),
    /** Every later call of `method` panics with `panic`, until cleared with null. */
    refuse: (/** @type {string} */ method, /** @type {string | null} */ panic) =>
      void (panic ? refusals.set(method, panic) : refusals.delete(method)),
    /** Player calls of `method` so far (every method when omitted). */
    playerCalls: (/** @type {string} */ method = '') =>
      near.mock.calls.filter((c) => c.kind === 'player' && (!method || c.method === method)),
    /** Calls of any kind for `method`. */
    calls: (/** @type {string} */ method) => near.mock.calls.filter((c) => c.method === method),
  };
}
