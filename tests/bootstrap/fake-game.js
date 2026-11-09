/**
 * Minimal in-memory game contract for the mock adapter (lib/near/mock.js): the mints, bind and
 * views the bootstrap uses (SPEC.md 4.4, 4.5, 4.7). Test-only.
 */
import { randomInt } from 'node:crypto';
import { createMockNear } from '../../lib/near/mock.js';

/**
 * @param {{ failOnce?: Record<string, (args: any) => boolean> }} [options] per-method predicates;
 *   the first matching call throws, later ones run
 */
export function createFakeGame(options = {}) {
  const near = createMockNear();
  /** @type {Map<string, { owner: string, kind: 'drone' | 'skin' | 'mod', name?: string, template?: number, boundTo?: string | null, bound?: string[], equipped?: Record<string, string | null> }>} */
  const tokens = new Map();
  /** @type {Map<string, bigint>} */
  const balances = new Map();
  // Token numbers start at a random base: every test shares one database with unique token ids.
  const base = randomInt(1_000_000_000);
  const counters = { d: base, s: base, m: base };
  const failOnce = { ...(options.failOnce ?? {}) };

  /**
   * Register a handler with loose arg types (the contract's JSON args).
   * @param {string} method
   * @param {(args: any, ctx: { accountId: string | null }) => { result?: unknown, events?: any[] }} fn
   */
  const on = (method, fn) => near.mock.on(method, /** @type {any} */ (fn));

  /** @param {string} method @param {any} args */
  const maybeFail = (method, args) => {
    const rule = failOnce[method];
    if (rule?.(args)) {
      delete failOnce[method];
      throw new Error(`injected failure in ${method}`);
    }
  };

  on('mint_drone', (args) => {
    maybeFail('mint_drone', args);
    const id = `d:${++counters.d}`;
    tokens.set(id, {
      owner: args.owner,
      kind: 'drone',
      name: args.name,
      bound: [],
      equipped: { skin: null, mod: null },
    });
    return { result: id, events: [] };
  });
  on('mint_item', (args) => {
    maybeFail('mint_item', args);
    const prefix = args.kind === 'skin' ? 's' : 'm';
    const id = `${prefix}:${++counters[prefix]}`;
    tokens.set(id, { owner: args.owner, kind: args.kind, template: args.template, boundTo: null });
    return { result: id, events: [] };
  });
  on('mint_volts', (args) => {
    maybeFail('mint_volts', args);
    balances.set(args.to, (balances.get(args.to) ?? 0n) + BigInt(args.amount));
    return {
      result: null,
      events: [
        {
          standard: 'nep141',
          version: '1.0.0',
          receiptId: 'r',
          event: 'ft_mint',
          data: [{ owner_id: args.to, amount: args.amount }],
        },
      ],
    };
  });
  on('bind', (args, { accountId }) => {
    maybeFail('bind', args);
    const drone = tokens.get(args.drone);
    const item = tokens.get(args.item);
    if (!drone || !item || drone.owner !== accountId || item.owner !== accountId || item.boundTo)
      throw new Error('bad bind');
    item.boundTo = args.drone;
    drone.bound?.push(args.item);
    /** @type {Array<{ event: string, data: Record<string, string> }>} */
    const events = [{ event: 'item_bound', data: { drone: args.drone, item: args.item } }];
    const slot = /** @type {'skin' | 'mod'} */ (item.kind);
    if (drone.equipped && !drone.equipped[slot]) {
      drone.equipped[slot] = args.item;
      events.push({ event: 'equipped', data: { drone: args.drone, kind: slot, item: args.item } });
    }
    return {
      result: null,
      events: events.map((e) => ({
        standard: 'hyperdrome',
        version: '1.0.0',
        receiptId: 'r',
        ...e,
      })),
    };
  });
  on('nft_tokens_for_owner', (args) => ({
    result: [...tokens]
      .filter(([, t]) => t.owner === args.account_id)
      .map(([token_id]) => ({ token_id })),
  }));
  on('ft_balance_of', (args) => ({
    result: String(balances.get(args.account_id) ?? 0n),
  }));
  on('get_drone', (args) => {
    const t = tokens.get(args.token);
    if (!t) return { result: null };
    const bound = t.bound ?? [];
    return {
      result: {
        cold: {
          name: t.name,
          bound_skins: bound.filter((id) => id.startsWith('s:')),
          bound_mods: bound.filter((id) => id.startsWith('m:')),
        },
        hot: { equipped_skin: t.equipped?.skin ?? null, equipped_mod: t.equipped?.mod ?? null },
      },
    };
  });
  on('get_item', (args) => ({ result: tokens.get(args.token) ?? null }));

  /** @param {string} method @param {(args: any) => boolean} [where] */
  const count = (method, where = () => true) =>
    near.mock.calls.filter((c) => c.method === method && where(c.args)).length;

  /** @param {'drone' | 'skin' | 'mod'} kind the first token of that kind, if minted */
  const first = (kind) => [...tokens].find(([, t]) => t.kind === kind)?.[0];

  return { near, tokens, balances, count, first };
}
