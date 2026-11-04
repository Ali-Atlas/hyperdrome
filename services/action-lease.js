/**
 * The per-user action lease (`users.action_claimed_at`, SPEC.md 8): a conditional UPDATE that
 * lets one request at a time act for a player, across serverless instances (Neon's HTTP driver
 * has no transactions or session locks). Used by every chain action and by database-only changes
 * that must not race.
 */
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { schema } from '@/lib/db';

const { users } = schema;

/** How long one action holds the user's lease before another request may take it. */
export const ACTION_LEASE_MS = 30_000;

/**
 * @param {number} status
 * @param {string} error
 * @returns {import('./action.service.js').ActionResponse}
 */
const reject = (status, error) => ({ status, body: { error } });

/**
 * Run `fn` holding the user's action lease (for database-only changes that must not race, such
 * as the active-slot check); 409 when another action holds it.
 * @param {any} db
 * @param {string} userId
 * @param {() => Promise<import('./action.service.js').ActionResponse>} fn
 * @returns {Promise<import('./action.service.js').ActionResponse>}
 */
export async function withUserLease(db, userId, fn) {
  const lease = await claimLease(db, userId);
  if (!lease) return reject(409, 'Another action is still in progress.');
  try {
    return await fn();
  } finally {
    await releaseLease(db, userId, lease);
  }
}

/**
 * @param {any} db
 * @param {string} userId
 * @param {Date} lease the token `claimLease` returned
 */
export async function releaseLease(db, userId, lease) {
  await db
    .update(users)
    .set({ actionClaimedAt: null })
    .where(and(eq(users.id, userId), eq(users.actionClaimedAt, lease)));
}

/**
 * Take the user's action lease when no live claim exists.
 * @param {any} db
 * @param {string} userId
 * @returns {Promise<Date | null>} the lease token, or null when another action holds it
 */
export async function claimLease(db, userId) {
  const now = new Date();
  const [row] = await db
    .update(users)
    .set({ actionClaimedAt: now })
    .where(
      and(
        eq(users.id, userId),
        or(
          isNull(users.actionClaimedAt),
          lt(users.actionClaimedAt, new Date(now.getTime() - ACTION_LEASE_MS))
        )
      )
    )
    .returning({ id: users.id });
  return row ? now : null;
}
