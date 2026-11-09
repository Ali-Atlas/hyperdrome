/**
 * The one path from a gameplay mutation to the chain (SPEC.md 8). Every player action carries a
 * client-generated action id and goes through `runPlayerAction`, which
 *
 * 1. requires a finished bootstrap;
 * 2. answers a replayed action id from its stored response (no second chain call);
 * 3. takes a per-user lease (`users.action_claimed_at`, conditional UPDATE, 30 s), so one player
 *    never has two chain calls in flight (they would carry the same seq and access-key nonce);
 * 4. records the action (`actions` row, id = the action id) and pins its seq before sending;
 * 5. sends it with the player's play key under that seq, storing each transaction's hash on the
 *    row after signing and before the broadcast (`onSigned`), so a process killed mid-call leaves
 *    the hash behind. Every resend of the action carries the same seq, so at most one of its
 *    transactions can ever apply; once the seq is used on chain, the action is resolved from its
 *    own transaction hashes and never sent under another seq;
 * 6. stores the outcome: applied with its response, failed with the mapped panic, or pending with
 *    the hashes when the outcome is unknown (202; the replay resolves it).
 */
import { eq } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/lib/db';
import { mapChainError } from '@/lib/http/chain-errors.js';
import { getNear } from '@/lib/near';
import {
  ContractPanicError,
  KeyAllowanceError,
  RpcUnknownOutcomeError,
  TransactionFailedError,
} from '@/lib/near/errors.js';
import { claimLease, releaseLease } from './action-lease.js';
import { findAction, mismatch, reject, storedResponse } from './action-store.js';

const { users, actions } = schema;

/**
 * Answer for an action whose seq was used on chain by none of its transactions. Every hash is
 * stored before its broadcast, so the action did not apply and never can.
 */
const NOT_APPLIED = 'This action did not go through. Try again.';

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
    const conflict = mismatch(earlier, action);
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
    hashes: [],
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
    const conflict = row ? mismatch(row, action) : null;
    if (!row || conflict) return conflict ?? reject(500, 'The action could not be recorded.');
    if (row.status !== 'pending') return storedResponse(row);
    return await settle(ctx, row);
  } finally {
    await releaseLease(db, userId, lease);
  }
}

/**
 * @typedef {object} Ctx
 * @property {any} db
 * @property {import('@/lib/near').NearAdapter} near
 * @property {PlayerAction} action
 * @property {string} accountId
 * @property {string} playKeyEnc
 * @property {string[]} hashes every transaction of the action, oldest first (`actions.tx_hashes`)
 * @typedef {typeof actions.$inferSelect} ActionRow
 */

/**
 * Pin the action's seq on its first send; on a resend, check that seq on chain first. While the
 * seq is unused, (re)send under it; once it is used, finish from whichever of the action's own
 * transactions applied, or answer that the action did not apply.
 * @param {Ctx} ctx
 * @param {ActionRow} row
 * @returns {Promise<ActionResponse>}
 */
async function settle(ctx, row) {
  const { near, action, accountId } = ctx;
  ctx.hashes = /** @type {string[]} */ (row.txHashes ?? []);
  let seq = row.seq;
  try {
    const next = await near.nextSeq(accountId);
    if (seq === null) {
      seq = next;
      await update(ctx, { seq });
    } else if (next > seq) {
      const found = await appliedAttempt(ctx, seq);
      if (found) return await applied(ctx, found);
      await finish(ctx, 409, NOT_APPLIED, row.txHash);
      return reject(409, NOT_APPLIED);
    } else if (next < seq) {
      return pendingAnswer(ctx, row.txHash);
    }
  } catch (err) {
    console.error({
      scope: 'action',
      msg: 'seq check failed',
      actionId: action.actionId,
      err: String(err),
    });
    return ctx.hashes.length > 0
      ? pendingAnswer(ctx, row.txHash)
      : reject(503, 'The chain is not responding. Try again shortly.');
  }
  const pinned = seq;
  /** @param {string} txHash */
  const onSigned = async (txHash) => {
    ctx.hashes = [...ctx.hashes, txHash];
    await update(ctx, { seq: pinned, txHash, txHashes: ctx.hashes });
  };
  try {
    const sent = await near.callAsPlayer(accountId, ctx.playKeyEnc, action.method, action.args, {
      seq,
      onSigned,
    });
    return await applied(ctx, sent);
  } catch (err) {
    return failed(ctx, err, seq);
  }
}

/**
 * The applied outcome among the action's transactions, all sent under `seq`, or null. A
 * transaction that executed and failed (a panic reverts it), or was signed and never broadcast,
 * did not apply.
 * @param {Ctx} ctx
 * @param {number} seq
 */
async function appliedAttempt(ctx, seq) {
  for (const hash of ctx.hashes) {
    try {
      const outcome = await ctx.near.resolveOutcome(ctx.accountId, seq, hash);
      if (outcome.applied) return outcome;
    } catch (err) {
      if (!(err instanceof ContractPanicError) && !(err instanceof TransactionFailedError))
        throw err;
    }
  }
  return null;
}

/**
 * 202 for an action whose outcome is not known yet; the same request again resolves it.
 * @param {Ctx} ctx
 * @param {string | null} txHash
 * @returns {ActionResponse}
 */
function pendingAnswer(ctx, txHash) {
  return { status: 202, body: { pending: true, actionId: ctx.action.actionId, txHash } };
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
 * Store a failure, or keep the row pending (seq and hashes kept) when the action may still apply
 * or may be sent again under its seq.
 * @param {Ctx} ctx
 * @param {unknown} err
 * @param {number} seq the action's pinned seq
 * @returns {Promise<ActionResponse>}
 */
async function failed(ctx, err, seq) {
  const { action } = ctx;
  if (err instanceof RpcUnknownOutcomeError) {
    // `onSigned` stored the hash already; an adapter that skipped it is covered here.
    if (err.txHash && !ctx.hashes.includes(err.txHash)) {
      ctx.hashes = [...ctx.hashes, err.txHash];
      await update(ctx, { txHash: err.txHash, txHashes: ctx.hashes });
    }
    return pendingAnswer(ctx, err.txHash);
  }
  if (err instanceof ContractPanicError) {
    const mapped = mapChainError(err.panic);
    if (err.panic === 'bad seq') {
      // The seq was used meanwhile: by an earlier transaction of this action, or by another.
      try {
        const found = await appliedAttempt(ctx, seq);
        if (found) return await applied(ctx, found);
      } catch {
        return pendingAnswer(ctx, ctx.hashes.at(-1) ?? null);
      }
      return reject(mapped.status, mapped.error);
    }
    if ((action.transient ?? []).includes(err.panic)) return reject(mapped.status, mapped.error);
    await finish(ctx, mapped.status, mapped.error, err.txHash ?? ctx.hashes.at(-1) ?? null);
    return reject(mapped.status, mapped.error);
  }
  if (err instanceof TransactionFailedError) {
    const error = 'The action failed on chain. Try again.';
    await finish(ctx, 502, error, err.txHash);
    return reject(502, error);
  }
  // Not sent, or rejected before execution: the row stays pending under its seq with every signed
  // hash, so the same request resolves or resends it and can still apply it only once.
  console.error({
    scope: 'action',
    msg: 'action not sent',
    actionId: action.actionId,
    method: action.method,
    err: String(err),
  });
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
