/**
 * Lookups shared by the cache writers (services/chain-cache.service.js, chain-cache-settle.js):
 * the user row behind a NEAR account and the cache row behind a token id.
 */
import { eq } from 'drizzle-orm';
import { schema } from '@/lib/db';

const { users, drones, skins, mods } = schema;

/**
 * @typedef {{ db: any, near: import('@/lib/near').NearAdapter, userIds: Map<string, string | null>, voltAccounts: Set<string> }} Ctx
 */

/** Item kind by token prefix. */
const KIND_BY_PREFIX = /** @type {const} */ ({ d: 'drone', s: 'skin', m: 'mod' });

/**
 * `drone`, `skin` or `mod` for a token id (`d:1`, `s:2`, `m:3`).
 * @param {string} token
 * @returns {'drone' | 'skin' | 'mod' | null}
 */
export function tokenKind(token) {
  return KIND_BY_PREFIX[/** @type {'d' | 's' | 'm'} */ (token.split(':')[0])] ?? null;
}

/**
 * The user row id for a NEAR account, or null (bots, the contract, unknown accounts).
 * @param {Ctx} ctx
 * @param {string} account
 */
export async function userIdFor(ctx, account) {
  if (!ctx.userIds.has(account)) {
    const [row] = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.nearAccountId, account))
      .limit(1);
    ctx.userIds.set(account, row?.id ?? null);
  }
  return ctx.userIds.get(account) ?? null;
}

/**
 * The cache table and row for a token, or null when it is not cached.
 * @param {Ctx} ctx
 * @param {string} token
 */
export async function rowFor(ctx, token) {
  const kind = tokenKind(token);
  if (!kind) return null;
  const table = { drone: drones, skin: skins, mod: mods }[kind];
  const [row] = await ctx.db
    .select({ id: table.id, userId: table.userId })
    .from(table)
    .where(eq(table.tokenId, token))
    .limit(1);
  return row ? { kind, table, id: /** @type {string} */ (row.id), userId: row.userId } : null;
}
