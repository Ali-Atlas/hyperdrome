/**
 * The one path from a gameplay mutation to the chain (SPEC.md 8). Every player action carries a
 * client-generated action id and goes through `runPlayerAction`, which
 *
 * 1. requires a finished bootstrap;
 * 2. answers a replayed action id from its stored response (no second chain call);
 * 3. takes a per-user lease (`users.action_claimed_at`, conditional UPDATE, 30 s), so one player
 *    never has two chain calls in flight (they would carry the same seq and access-key nonce);
 * 4. records the action (`actions` row, id = the action id) before sending;
 * 5. sends it with the player's play key, or, for a row left pending with a transaction hash,
 *    resolves that transaction first;
 * 6. stores the outcome: applied with its response, failed with the mapped panic, or pending with
 *    the hash and seq when the outcome is unknown (202; the replay resolves it).
 */
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/lib/db';
import { mapChainError } from '@/lib/http/chain-errors.js';
import { getNear } from '@/lib/near';
import {
  ContractPanicError,
  KeyAllowanceError,
  RpcUnknownOutcomeError,
  TransactionFailedError,
} from '@/lib/near/errors.js';

const { users, actions } = schema;

/** How long one action holds the user's lease before another request may take it. */
export const ACTION_LEASE_MS = 30_000;

/** Panics that say "try again" rather than "this action is wrong"; the row stays retryable. */
const ALWAYS_TRANSIENT = ['bad seq'];

/**
 * @typedef {{ status: number, body: Record<string, unknown> }} ActionResponse
 * @typedef {(events: import('@/lib/near').NearEvent[], result: unknown) => Promise<Record<string, unknown> | void>} OnApplied
 *   updates caches from the transaction's events; may return extra response fields
 * @typedef {object} PlayerAction
 * @property {string} userId
 * @property {string} actionId client-generated uuid, the idempotency key
 * @property {string} method contract method (SPEC.md 4.4, player section)
 * @property {Record<string, unknown>} args method args without `seq` (the adapter adds it)
 * @property {OnApplied} [onApplied]
 * @property {Record<string, unknown>} [recordArgs] what to store in `actions.args` (default `args`;
 *   pass a redacted copy when the args hold a secret)
 * @property {string[]} [transient] extra panics that leave the row retryable (e.g. `too early`)
 * @typedef {{ db?: any, near?: import('@/lib/near').NearAdapter }} Deps
 */

/**
 * @param {number} status
 * @param {string} error
 * @returns {ActionResponse}
 */
const reject = (status, error) => ({ status, body: { error } });

/**
 * Run one player action through the chain, idempotently by `actionId`.
 * @param {PlayerAction} action
 * @param {Deps} [deps]
 * @returns {Promise<ActionResponse>}
 */
export async function runPlayerAction(action, deps = {}) {
  const db = deps.db ?? defaultDb;
  const near = deps.near ?? getNear();
  const { userId, actionId, method } = action;

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.bootstrapState !== 'done' || !user.nearAccountId || !user.playKeyEnc) {
    return reject(409, 'Your racing account is still being set up.');
  }

  const earlier = await findAction(db, actionId);
  if (earlier) {
    const conflict = mismatch(earlier, userId, method);
    if (conflict) return conflict;
    if (earlier.status !== 'pending') return storedResponse(earlier);
  }

  const lease = await claimLease(db, userId);
  if (!lease) return reject(409, 'Another action is still in progress.');

  /** @type {Ctx} */
  const ctx = {
    db,
    near,
    action,
    accountId: user.nearAccountId,
    playKeyEnc: user.playKeyEnc,
  };
  try {
    await db
      .insert(actions)
      .values({
        id: actionId,
        userId,
        method,
        args: action.recordArgs ?? action.args,
        status: 'pending',
      })
      .onConflictDoNothing();
    const row = await findAction(db, actionId);
    const conflict = row ? mismatch(row, userId, method) : null;
    if (!row || conflict) return conflict ?? reject(500, 'The action could not be recorded.');
    if (row.status !== 'pending') return storedResponse(row);
    return await settle(ctx, row);
  } finally {
    await db
      .update(users)
      .set({ actionClaimedAt: null })
      .where(and(eq(users.id, userId), eq(users.actionClaimedAt, lease)));
  }
}

/**
 * @typedef {object} Ctx
 * @property {any} db
 * @property {import('@/lib/near').NearAdapter} near
 * @property {PlayerAction} action
 * @property {string} accountId
 * @property {string} playKeyEnc
 * @typedef {typeof actions.$inferSelect} ActionRow
 */

/**
 * Resolve a pending row's earlier transaction if it has one, else send; store the outcome.
 * @param {Ctx} ctx
 * @param {ActionRow} row
 * @returns {Promise<ActionResponse>}
 */
async function settle(ctx, row) {
  const { near, action, accountId } = ctx;
  try {
    if (row.txHash && row.seq !== null) {
      const outcome = await near.resolveOutcome(accountId, row.seq, row.txHash);
      if (outcome.applied) return await applied(ctx, outcome);
      await update(ctx, { txHash: null, seq: null });
    }
    const sent = await near.callAsPlayer(accountId, ctx.playKeyEnc, action.method, action.args);
    return await applied(ctx, sent);
  } catch (err) {
    return failed(ctx, err);
  }
}

/**
 * Store an applied outcome, update caches through `onApplied`, and answer 200.
 * @param {Ctx} ctx
 * @param {import('@/lib/near').CallResult} res
 * @returns {Promise<ActionResponse>}
 */
async function applied(ctx, res) {
  const { action, near } = ctx;
  const base = {
    actionId: action.actionId,
    txHash: res.txHash,
    explorerUrl: near.explorerTx(res.txHash),
    result: res.result ?? null,
  };
  await update(ctx, {
    status: 'applied',
    txHash: res.txHash,
    result: base,
    error: null,
    httpStatus: 200,
  });
  let extra = {};
  try {
    extra = (await action.onApplied?.(res.events, res.result)) ?? {};
  } catch (err) {
    // The action is on chain; a stale cache is repaired by the next read or reconcile.
    console.error({
      scope: 'action',
      msg: 'cache update failed after an applied action',
      actionId: action.actionId,
      method: action.method,
      err: String(err),
    });
  }
  const body = { ...base, ...extra };
  if (Object.keys(extra).length > 0) await update(ctx, { result: body });
  return { status: 200, body };
}

/**
 * Store (or keep retryable) a failure and answer with its status.
 * @param {Ctx} ctx
 * @param {unknown} err
 * @returns {Promise<ActionResponse>}
 */
async function failed(ctx, err) {
  const { action } = ctx;
  if (err instanceof RpcUnknownOutcomeError) {
    await update(ctx, { txHash: err.txHash, seq: err.seq ?? null });
    return {
      status: 202,
      body: { pending: true, actionId: action.actionId, txHash: err.txHash },
    };
  }
  if (err instanceof ContractPanicError) {
    const mapped = mapChainError(err.panic);
    if ([...ALWAYS_TRANSIENT, ...(action.transient ?? [])].includes(err.panic)) {
      await update(ctx, { txHash: null, seq: null });
      return reject(mapped.status, mapped.error);
    }
    await finish(ctx, mapped.status, mapped.error, err.txHash ?? null);
    return reject(mapped.status, mapped.error);
  }
  if (err instanceof TransactionFailedError) {
    const error = 'The action failed on chain. Try again.';
    await finish(ctx, 502, error, err.txHash);
    return reject(502, error);
  }
  // Not sent, or rejected before execution: the row stays pending without a hash, so a replay
  // of the same action id sends it again.
  console.error({
    scope: 'action',
    msg: 'action not sent',
    actionId: action.actionId,
    method: action.method,
    err: String(err),
  });
  await update(ctx, { txHash: null, seq: null });
  if (err instanceof KeyAllowanceError) {
    return reject(503, 'Your account cannot send actions right now. Try again later.');
  }
  return reject(503, 'The chain is not responding. Try again shortly.');
}

/**
 * Mark the row failed with the answer replays get.
 * @param {Ctx} ctx
 * @param {number} httpStatus
 * @param {string} error
 * @param {string | null} txHash
 */
function finish(ctx, httpStatus, error, txHash) {
  return update(ctx, { status: 'failed', httpStatus, error, txHash, result: null });
}

/**
 * @param {Ctx} ctx
 * @param {Partial<ActionRow>} set
 */
async function update(ctx, set) {
  await ctx.db.update(actions).set(set).where(eq(actions.id, ctx.action.actionId));
}

/**
 * @param {any} db
 * @param {string} actionId
 * @returns {Promise<ActionRow | undefined>}
 */
async function findAction(db, actionId) {
  const [row] = await db.select().from(actions).where(eq(actions.id, actionId)).limit(1);
  return row;
}

/**
 * A replayed action id must belong to the same user and method.
 * @param {ActionRow} row
 * @param {string} userId
 * @param {string} method
 * @returns {ActionResponse | null}
 */
function mismatch(row, userId, method) {
  if (row.userId === userId && row.method === method) return null;
  return reject(409, 'This action id was already used for a different action.');
}

/**
 * The answer a finished action gave the first time.
 * @param {ActionRow} row
 * @returns {ActionResponse}
 */
function storedResponse(row) {
  if (row.status === 'applied') {
    return {
      status: row.httpStatus ?? 200,
      body: /** @type {Record<string, unknown>} */ (row.result ?? { actionId: row.id }),
    };
  }
  return reject(row.httpStatus ?? 422, row.error ?? 'The game rejected this action.');
}

/**
 * Take the user's action lease when no live claim exists.
 * @param {any} db
 * @param {string} userId
 * @returns {Promise<Date | null>} the lease token, or null when another action holds it
 */
async function claimLease(db, userId) {
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
