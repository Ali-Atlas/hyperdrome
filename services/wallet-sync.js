/**
 * Re-reading a player's tokens and Volts from chain into the cache (SPEC.md 8): for items sent
 * back from the wallet and anything withdrawn by the wallet directly. Everything goes through the
 * events path `applyEvents` uses (services/team-seed-kit.js builds its rows the same way).
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/lib/db';
import { getNear } from '@/lib/near';
import { reject } from './action-store.js';
import { applyEvents, tokenKind } from './chain-cache.service.js';

const { users, drones, skins, mods } = schema;

/** `nft_tokens_for_owner` page size and `get_drones` / `get_items` chunk size. */
const PAGE = 50;

/**
 * @typedef {import('@/lib/near').NearEvent} NearEvent
 * @typedef {import('./action-store.js').ActionResponse} ActionResponse
 */

/**
 * @param {string} event
 * @param {unknown} data
 * @param {string} [standard]
 * @returns {NearEvent}
 */
const ev = (event, data, standard = 'hyperdrome') => ({
  standard,
  version: '1.0.0',
  event,
  data,
  receiptId: 'wallet-sync',
});

/**
 * Every token `account` owns on chain.
 * @param {import('@/lib/near').NearAdapter} near
 * @param {string} account
 * @returns {Promise<string[]>}
 */
async function chainTokens(near, account) {
  const supply = Number(await near.view('nft_supply_for_owner', { account_id: account }));
  /** @type {string[]} */
  const owned = [];
  for (let from = 0; from < supply; from += PAGE) {
    const page = /** @type {{ token_id: string }[]} */ (
      await near.view('nft_tokens_for_owner', {
        account_id: account,
        from_index: String(from),
        limit: PAGE,
      })
    );
    owned.push(...page.map((t) => t.token_id));
  }
  return owned;
}

/**
 * Chain owners of `tokens` (the contract's `get_drones` / `get_items` views).
 * @param {import('@/lib/near').NearAdapter} near
 * @param {string[]} tokens
 * @returns {Promise<Map<string, any>>} token -> its view (with `owner`)
 */
async function chainViews(near, tokens) {
  /** @type {Map<string, any>} */
  const views = new Map();
  for (const method of /** @type {const} */ (['get_drones', 'get_items'])) {
    const wanted = tokens.filter((t) => (tokenKind(t) === 'drone') === (method === 'get_drones'));
    for (let i = 0; i < wanted.length; i += PAGE) {
      const chunk = wanted.slice(i, i + PAGE);
      const results = /** @type {any[]} */ (await near.view(method, { tokens: chunk }));
      chunk.forEach((token, j) => {
        if (results[j]) views.set(token, results[j]);
      });
    }
  }
  return views;
}

/**
 * Rows the database holds for the user's tokens.
 * @param {any} db
 * @param {string} userId
 * @returns {Promise<string[]>}
 */
async function cachedTokens(db, userId) {
  /** @type {string[]} */
  const tokens = [];
  for (const table of [drones, skins, mods]) {
    const rows = await db
      .select({ token: table.tokenId })
      .from(table)
      .where(and(eq(table.userId, userId), isNotNull(table.tokenId)));
    tokens.push(...rows.map((/** @type {{ token: string }} */ r) => r.token));
  }
  return tokens;
}

/**
 * Bring the cache in line with the chain for one player: tokens now owned on chain are the
 * player's again, tokens that left are not, and `users.points` is re-read.
 * @param {{ userId: string }} input
 * @param {{ db?: any, near?: import('@/lib/near').NearAdapter }} [deps]
 * @returns {Promise<ActionResponse>}
 */
export async function syncWallet({ userId }, deps = {}) {
  const db = deps.db ?? defaultDb;
  const near = deps.near ?? getNear();
  const [user] = await db
    .select({ account: users.nearAccountId, state: users.bootstrapState })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user?.account || user.state !== 'done') {
    return reject(409, 'Your racing account is still being set up.');
  }
  const account = /** @type {string} */ (user.account);

  const owned = await chainTokens(near, account);
  const ownedSet = new Set(owned);
  const cached = await cachedTokens(db, userId);
  const left = cached.filter((t) => !ownedSet.has(t));
  const views = await chainViews(near, [...owned, ...left]);

  // Mints first (applyEvents orders them), so a token the cache has never seen gets its row.
  /** @type {NearEvent[]} */
  const events = [];
  const known = new Set(cached);
  for (const token of owned) {
    if (known.has(token)) continue;
    const view = views.get(token);
    if (!view) continue;
    if (tokenKind(token) === 'drone') {
      events.push(ev('drone_minted', { token, owner: account, level: view.hot.level }));
      for (const item of [...view.cold.bound_skins, ...view.cold.bound_mods]) {
        events.push(ev('item_bound', { drone: token, item }));
      }
    } else {
      events.push(
        ev('item_minted', {
          token,
          owner: account,
          kind: view.kind,
          template: view.template,
          rarity: view.rarity,
        })
      );
    }
  }
  if (owned.length > 0) {
    events.push(
      ev(
        'nft_transfer',
        [{ old_owner_id: null, new_owner_id: account, token_ids: owned }],
        'nep171'
      )
    );
  }
  for (const token of left) {
    const owner = views.get(token)?.owner;
    // Escrow keeps the seller as the cached owner; a listing is left alone.
    if (owner && owner !== near.gameId) {
      events.push(
        ev(
          'nft_transfer',
          [{ old_owner_id: account, new_owner_id: owner, token_ids: [token] }],
          'nep171'
        )
      );
    }
  }
  events.push(ev('ft_transfer', [{ old_owner_id: account }], 'nep141'));

  const { balances } = await applyEvents(events, { db, near });
  return { status: 200, body: { volts: balances[account] ?? 0, tokens: owned.length } };
}
