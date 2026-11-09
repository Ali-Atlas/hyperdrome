/**
 * The action path for ops-key mutations (SPEC.md 8): the guarantees of the player path without a
 * seq (the ops key is the signer). A replayed action id gets its stored answer; the hash is stored
 * after signing and before the broadcast; an unknown outcome is resolved from the stored hashes
 * and the transaction is never built and sent again.
 */
import { eq } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/lib/db';
import { mapChainError } from '@/lib/http/chain-errors.js';
import { getNear } from '@/lib/near';
import {
  ContractPanicError,
  KeyAllowanceError,
  NonceError,
  RpcUnknownOutcomeError,
  TransactionFailedError,
} from '@/lib/near/errors.js';
import { claimLease, releaseLease } from './action-lease.js';
import { findAction, mismatch, reject, storedResponse } from './action-store.js';

const { users, actions } = schema;

/** A hash unknown to the RPC after this long is treated as never broadcast (SPEC.md 10 uses the same). */
const UNKNOWN_HASH_MS = 10 * 60 * 1000;
/**
 * InvalidNonce means the key's nonce was used: by this transaction, which a lookup then finds
 * within seconds, or by another, and this one can never execute. A shorter wait is safe.
 */
const NONCE_REJECTED = 'nonce rejected';
const NONCE_REJECTED_MS = 60 * 1000;
const NOT_APPLIED = 'This action did not go through. Try again.';

/**
 * @typedef {import('./action-store.js').ActionResponse} ActionResponse
 * @typedef {import('./action-store.js').ActionRow} ActionRow
 * @typedef {object} OpsAction
 * @property {string} userId
 * @property {string} actionId client-generated uuid, the idempotency key
 * @property {string} method contract method (SPEC.md 4.4, owner section)
 * @property {Record<string, unknown>} args
 * @property {bigint} [gas]
 * @property {import('./action.service.js').OnApplied} [onApplied]
 * @typedef {object} Ctx
 * @property {any} db
 * @property {import('@/lib/near').NearAdapter} near
 * @property {OpsAction} action
 * @property {string[]} hashes
 */

/**
 * Run one ops-key action through the chain, idempotently by `actionId`.
 * @param {OpsAction} action
 * @param {{ db?: any, near?: import('@/lib/near').NearAdapter }} [deps]
 * @returns {Promise<ActionResponse>}
 */
export async function runOpsAction(action, deps = {}) {
  const db = deps.db ?? defaultDb;
  const near = deps.near ?? getNear();
  const { userId, actionId, method } = action;

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.bootstrapState !== 'done' || !user.nearAccountId) {
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
  const ctx = { db, near, action, hashes: [] };
  try {
    await db
      .insert(actions)
      .values({ id: actionId, userId, method, args: action.args, status: 'pending' })
      .onConflictDoNothing();
    const row = await findAction(db, actionId);
    const conflict = row ? mismatch(row, action) : null;
    if (!row || conflict) return conflict ?? reject(500, 'The action could not be recorded.');
    if (row.status !== 'pending') return storedResponse(row);
    ctx.hashes = /** @type {string[]} */ (row.txHashes ?? []);
    if (ctx.hashes.length > 0) return await resolveStored(ctx, row);
    return await send(ctx);
  } finally {
    await releaseLease(db, userId, lease);
  }
}

/**
 * A row with stored hashes has been signed and maybe sent: it is resolved from those hashes only.
 * @param {Ctx} ctx
 * @param {ActionRow} row
 * @returns {Promise<ActionResponse>}
 */
async function resolveStored(ctx, row) {
  const { near } = ctx;
  for (const txHash of ctx.hashes) {
    try {
      const events = await near.transactionEvents(txHash, { senderId: near.ownerId });
      if (events) return await applied(ctx, { txHash, result: null, events });
    } catch (err) {
      if (err instanceof ContractPanicError || err instanceof TransactionFailedError) {
        return failed(ctx, err);
      }
      return pendingAnswer(ctx, txHash);
    }
  }
  const waitMs = row.error === NONCE_REJECTED ? NONCE_REJECTED_MS : UNKNOWN_HASH_MS;
  if (Date.now() - new Date(row.createdAt).getTime() < waitMs) {
    return pendingAnswer(ctx, ctx.hashes.at(-1) ?? null);
  }
  await finish(ctx, 409, NOT_APPLIED, ctx.hashes.at(-1) ?? null);
  return reject(409, NOT_APPLIED);
}

/**
 * Sign, store the hash, broadcast.
 * @param {Ctx} ctx
 * @returns {Promise<ActionResponse>}
 */
async function send(ctx) {
  const { near, action } = ctx;
  /** @param {string} txHash */
  const onSigned = async (txHash) => {
    ctx.hashes = [...ctx.hashes, txHash];
    await update(ctx, { txHash, txHashes: ctx.hashes });
  };
  try {
    const sent = await near.callAsOps(action.method, action.args, { gas: action.gas, onSigned });
    return await applied(ctx, sent);
  } catch (err) {
    return failed(ctx, err);
  }
}

/**
 * @param {Ctx} ctx
 * @param {string | null} txHash
 * @returns {ActionResponse}
 */
function pendingAnswer(ctx, txHash) {
  return { status: 202, body: { pending: true, actionId: ctx.action.actionId, txHash } };
}

/**
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
 * @param {Ctx} ctx
 * @param {unknown} err
 * @returns {Promise<ActionResponse>}
 */
async function failed(ctx, err) {
  const { action } = ctx;
  if (err instanceof RpcUnknownOutcomeError) {
    if (err.txHash && !ctx.hashes.includes(err.txHash)) {
      ctx.hashes = [...ctx.hashes, err.txHash];
      await update(ctx, { txHash: err.txHash, txHashes: ctx.hashes });
    }
    return pendingAnswer(ctx, err.txHash);
  }
  if (err instanceof NonceError && ctx.hashes.length > 0) {
    await update(ctx, { error: NONCE_REJECTED });
    return pendingAnswer(ctx, ctx.hashes.at(-1) ?? null);
  }
  if (err instanceof ContractPanicError) {
    const mapped = mapChainError(err.panic);
    await finish(ctx, mapped.status, mapped.error, err.txHash ?? ctx.hashes.at(-1) ?? null);
    return reject(mapped.status, mapped.error);
  }
  if (err instanceof TransactionFailedError) {
    const error = 'The action failed on chain. Try again.';
    await finish(ctx, 502, error, err.txHash);
    return reject(502, error);
  }
  console.error({
    scope: 'action',
    msg: 'action not sent',
    actionId: action.actionId,
    method: action.method,
    err: String(err),
  });
  if (err instanceof KeyAllowanceError) {
    return reject(503, 'The game cannot send this right now. Try again later.');
  }
  return reject(503, 'The chain is not responding. Try again shortly.');
}

/**
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
