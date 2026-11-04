/**
 * Player bootstrap (SPEC.md 12): a state machine on `users.bootstrap_state`
 * (`none -> account -> minted -> done`). Each call makes at most one transition, so every request
 * fits the route's time limit; the dashboard calls again until `done`. Each step is idempotent and
 * resumable. A request first claims a lease (`bootstrap_claimed_at`) with a conditional UPDATE, so
 * two concurrent requests never act at once; every transition is an
 * `UPDATE ... WHERE bootstrap_state = <expected>`.
 */
import { randomInt } from 'node:crypto';
import { and, eq, isNull, lt, ne, or } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/lib/db';
import { getNear } from '@/lib/near';
import {
  AccountCreateError,
  ContractPanicError,
  RpcUnknownOutcomeError,
  TransactionFailedError,
} from '@/lib/near/errors.js';
import { slugFromUsername, slugWithSuffix } from '@/lib/validators/player-slug.js';
import { ensureStarterKit, bindStarterKit, findStarterDrone } from './bootstrap-kit.js';

const { users } = schema;

/**
 * How long a claim holds before another request may take over a stalled bootstrap; longer than the
 * route's 60 s `maxDuration`, so a live call is never overtaken.
 */
export const CLAIM_LEASE_MS = 120_000;

/** Slug attempts before giving up (the base, then random suffixes on `exists`). */
const SLUG_ATTEMPTS = 5;

/** Thrown when `create_player` has an unknown outcome; its keys are stored in `bootstrap_pending`. */
export class BootstrapPendingError extends Error {
  constructor() {
    super('account creation outcome unknown; resolved on the next call');
    this.name = 'BootstrapPendingError';
  }
}

/** Thrown when a transition finds the row no longer in the expected state (another runner). */
export class BootstrapConflictError extends Error {
  /** @param {string} from */
  constructor(from) {
    super(`bootstrap left state ${from} under another runner`);
    this.name = 'BootstrapConflictError';
  }
}

/**
 * @typedef {typeof users.$inferSelect} UserRow
 * @typedef {{ accountId: string, playKeyEnc: string, adminKeyEnc: string, keyVersion: number, txHash: string, slug: string }} PendingAttempt
 * @typedef {{ db: any, near: import('@/lib/near').NearAdapter, userId: string, token: Date, pickModTemplate: () => number }} Ctx
 * @typedef {{ state: string, accountId: string | null, explorerUrl: string | null, droneId: string | null, busy?: boolean }} BootstrapStatus
 */

/**
 * Make the next bootstrap transition for a user (at most one) and report where it stands.
 * @param {string} userId
 * @param {{ db?: any, near?: import('@/lib/near').NearAdapter, pickModTemplate?: () => number }} [deps]
 * @returns {Promise<BootstrapStatus>}
 */
export async function runBootstrap(userId, deps = {}) {
  const db = deps.db ?? defaultDb;
  const near = deps.near ?? getNear();
  const claimed = await claim(db, userId);
  if (!claimed) return { ...(await bootstrapStatus(userId, { db, near })), busy: true };

  /** @type {Ctx} */
  const ctx = {
    db,
    near,
    userId,
    token: /** @type {Date} */ (claimed.bootstrapClaimedAt),
    pickModTemplate: deps.pickModTemplate ?? (() => randomInt(1, 11)),
  };
  try {
    let user = claimed;
    if (user.bootstrapState === 'none') {
      user = await createAccount(ctx, user);
    } else if (user.bootstrapState === 'account') {
      await ensureStarterKit(ctx, /** @type {string} */ (user.nearAccountId));
      user = await advance(ctx, 'account', { bootstrapState: 'minted' });
    } else if (user.bootstrapState === 'minted') {
      const points = await bindStarterKit(ctx, user);
      user = await advance(ctx, 'minted', { bootstrapState: 'done', points });
    }
    return statusOf(near, user, await findStarterDrone(db, userId));
  } finally {
    await db
      .update(users)
      .set({ bootstrapClaimedAt: null })
      .where(and(eq(users.id, userId), eq(users.bootstrapClaimedAt, ctx.token)));
  }
}

/**
 * The current bootstrap state without acting.
 * @param {string} userId
 * @param {{ db?: any, near?: import('@/lib/near').NearAdapter }} [deps]
 * @returns {Promise<BootstrapStatus>}
 */
export async function bootstrapStatus(userId, deps = {}) {
  const db = deps.db ?? defaultDb;
  const near = deps.near ?? getNear();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return statusOf(near, user, await findStarterDrone(db, userId));
}

/**
 * @param {import('@/lib/near').NearAdapter} near
 * @param {UserRow | undefined} user
 * @param {{ id: string } | null} drone
 * @returns {BootstrapStatus}
 */
function statusOf(near, user, drone) {
  const accountId = user?.nearAccountId ?? null;
  return {
    state: user?.bootstrapState ?? 'none',
    accountId,
    explorerUrl: accountId ? near.explorerAccount(accountId) : null,
    droneId: drone?.id ?? null,
  };
}

/**
 * Take the lease when the user is not done and no live claim exists.
 * @param {any} db
 * @param {string} userId
 * @returns {Promise<UserRow | undefined>}
 */
async function claim(db, userId) {
  const now = new Date();
  const [row] = await db
    .update(users)
    .set({ bootstrapClaimedAt: now })
    .where(
      and(
        eq(users.id, userId),
        ne(users.bootstrapState, 'done'),
        or(
          isNull(users.bootstrapClaimedAt),
          lt(users.bootstrapClaimedAt, new Date(now.getTime() - CLAIM_LEASE_MS))
        )
      )
    )
    .returning();
  return row;
}

/**
 * Move from `from` with `set`; fails if the row left `from` (another runner advanced it).
 * @param {Ctx} ctx
 * @param {'none' | 'account' | 'minted'} from
 * @param {Partial<UserRow>} set
 * @returns {Promise<UserRow>}
 */
async function advance(ctx, from, set) {
  const [row] = await ctx.db
    .update(users)
    .set(set)
    .where(and(eq(users.id, ctx.userId), eq(users.bootstrapState, from)))
    .returning();
  if (!row) throw new BootstrapConflictError(from);
  return row;
}

/**
 * Step 1, `none -> account`: resolve stored unknown-outcome attempts first, then create.
 * @param {Ctx} ctx
 * @param {UserRow} user
 * @returns {Promise<UserRow>}
 */
async function createAccount(ctx, user) {
  const stored = /** @type {PendingAttempt[]} */ (user.bootstrapPending ?? []);
  let pending = stored;

  /**
   * Resolve stored attempts: adopt the first that landed, drop the ones that failed.
   * @param {PendingAttempt[]} attempts
   */
  const resolveStored = async (attempts) => {
    for (const attempt of attempts) {
      const resolved = await resolveAttempt(ctx, attempt);
      if (resolved === 'failed') {
        pending = pending.filter((a) => a !== attempt);
        await advance(ctx, 'none', { bootstrapPending: pending.length > 0 ? pending : null });
      } else if (resolved) {
        return resolved;
      }
    }
    return null;
  };

  const adopted = await resolveStored(stored);
  if (adopted) return adopted;

  const base = stored.at(-1)?.slug ?? slugFromUsername(user.username);
  let slug = base;
  for (let i = 0; i < SLUG_ATTEMPTS; i += 1) {
    try {
      const created = await ctx.near.createPlayerAccount({ slug, isTeam: false });
      return keysStored(ctx, created);
    } catch (err) {
      if (err instanceof RpcUnknownOutcomeError && /** @type {any} */ (err).pending) {
        const attempt = { .../** @type {any} */ (err).pending, txHash: err.txHash, slug };
        await advance(ctx, 'none', { bootstrapPending: [...pending, attempt] });
        throw new BootstrapPendingError();
      }
      const taken = err instanceof ContractPanicError && err.panic === 'exists';
      if (!taken && !(err instanceof AccountCreateError)) throw err;
      // A stored attempt with this slug may have landed after all.
      const late = await resolveStored(pending.filter((a) => a.slug === slug));
      if (late) return late;
      slug = slugWithSuffix(base);
    }
  }
  throw new Error(`no free player slug after ${SLUG_ATTEMPTS} attempts`);
}

/**
 * Resolve a stored attempt: adopt it (the stored row) if its `create_player` executed and returned
 * true; `'failed'` if it executed and failed (a panic such as `exists` when another player took
 * the slug, a non-panic failure, or a false callback), so it can be dropped; null while unknown.
 * @param {Ctx} ctx
 * @param {PendingAttempt} attempt
 * @returns {Promise<UserRow | 'failed' | null>}
 */
async function resolveAttempt(ctx, attempt) {
  let outcome;
  try {
    outcome = await ctx.near.resolveOutcome(attempt.accountId, 0, attempt.txHash, {
      senderId: ctx.near.ownerId,
    });
  } catch (err) {
    if (err instanceof ContractPanicError || err instanceof TransactionFailedError) return 'failed';
    throw err;
  }
  if (!outcome.applied) return null;
  if (outcome.result !== true) return 'failed';
  return keysStored(ctx, attempt);
}

/**
 * Store the account and its sealed keys, and move to `account`.
 * @param {Ctx} ctx
 * @param {{ accountId: string, playKeyEnc: string, adminKeyEnc: string, keyVersion: number }} keys
 */
function keysStored(ctx, keys) {
  return advance(ctx, 'none', {
    nearAccountId: keys.accountId,
    playKeyEnc: keys.playKeyEnc,
    adminKeyEnc: keys.adminKeyEnc,
    keyVersion: keys.keyVersion,
    bootstrapPending: null,
    bootstrapState: 'account',
  });
}
