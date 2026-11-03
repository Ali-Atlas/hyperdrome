/**
 * Adapter errors (SPEC.md 4.8 and 6). Each carries what the caller needs to decide: the contract's
 * short panic string, the transaction hash of an unknown outcome, and so on. Errors not listed here
 * propagate unchanged.
 */

import { FailoverRpcError, TypedError } from 'near-api-js';
import {
  AccessKeyNotEnoughAllowanceActionError,
  HostGuestPanicError,
  InvalidNonceError,
  RpcError,
  TransactionTimeoutError,
} from 'near-api-js/rpc-errors';

/** A contract method panicked; `panic` is the SPEC.md 4.8 string (e.g. `bad seq`). */
export class ContractPanicError extends Error {
  /**
   * @param {string} panic
   * @param {{ method?: string, txHash?: string, cause?: unknown }} [details]
   */
  constructor(panic, details = {}) {
    super(`contract panicked: ${panic}`, { cause: details.cause });
    this.name = 'ContractPanicError';
    this.panic = panic;
    this.method = details.method;
    this.txHash = details.txHash;
  }
}

/** The function-call key's allowance cannot cover the transaction (NotEnoughAllowance). */
export class KeyAllowanceError extends Error {
  /** @param {{ accountId?: string, cause?: unknown }} [details] */
  constructor(details = {}) {
    super(`access key allowance exhausted${details.accountId ? ` for ${details.accountId}` : ''}`, {
      cause: details.cause,
    });
    this.name = 'KeyAllowanceError';
    this.accountId = details.accountId;
  }
}

/** The transaction nonce was rejected (InvalidNonce); safe to rebuild and resend. */
export class NonceError extends Error {
  /** @param {{ accountId?: string, cause?: unknown }} [details] */
  constructor(details = {}) {
    super(`invalid nonce${details.accountId ? ` for ${details.accountId}` : ''}`, {
      cause: details.cause,
    });
    this.name = 'NonceError';
    this.accountId = details.accountId;
  }
}

/**
 * The transaction was sent but its outcome is unknown (timeout). `seq` is the player seq it
 * carried, so the caller can pass `accountId`, `seq` and `txHash` to `resolveOutcome`.
 */
export class RpcUnknownOutcomeError extends Error {
  /** @param {{ txHash: string, accountId?: string, seq?: number, cause?: unknown }} details */
  constructor(details) {
    super(`unknown outcome for transaction ${details.txHash}`, { cause: details.cause });
    this.name = 'RpcUnknownOutcomeError';
    this.txHash = details.txHash;
    this.accountId = details.accountId;
    this.seq = details.seq;
  }
}

/** `create_player` ran but its callback returned false: the account was not created. */
export class AccountCreateError extends Error {
  /** @param {{ accountId: string, txHash: string }} details */
  constructor(details) {
    super(`account ${details.accountId} was not created`);
    this.name = 'AccountCreateError';
    this.accountId = details.accountId;
    this.txHash = details.txHash;
  }
}

/**
 * The short panic string from a contract execution error message. near-sdk panics surface as
 * `Smart contract panicked: <msg>` inside the FunctionCallError text.
 * @param {string} text
 * @returns {string | null}
 */
export function panicMessage(text) {
  const match = /Smart contract panicked: ([^"\\\n]*)/.exec(text);
  return match ? match[1].trim() : null;
}

/** Thrown by the provider when one JSON-RPC call exceeds its per-call timeout. */
export class RpcTimeoutError extends Error {
  /** @param {string} method JSON-RPC method @param {number} ms */
  constructor(method, ms) {
    super(`RPC ${method} timed out after ${ms} ms`);
    this.name = 'RpcTimeoutError';
    this.method = method;
  }
}

/**
 * The individual errors behind `err`: a `FailoverRpcError` carries one per provider tried.
 * @param {unknown} err
 * @returns {unknown[]}
 */
export function flattenRpcErrors(err) {
  return err instanceof FailoverRpcError ? [...err.errors] : [err];
}

/**
 * True for failures that say nothing about whether a sent transaction executed: our timeout, the
 * node's TIMEOUT_ERROR, exhausted retries and transport failures (anything that is not an RPC error).
 * @param {unknown} err
 * @returns {boolean}
 */
function isTransportFailure(err) {
  if (err instanceof RpcTimeoutError || err instanceof TransactionTimeoutError) return true;
  if (err instanceof TypedError && err.type === 'RetriesExceeded') return true;
  return !(err instanceof RpcError);
}

/**
 * Maps an error thrown while sending a signed transaction. Rejections the node reports
 * deterministically become typed errors; transport failures become `RpcUnknownOutcomeError`
 * (the transaction may still execute). Anything else is returned unchanged.
 * @param {unknown} err
 * @param {{ txHash: string, accountId: string, seq?: number }} ctx
 * @returns {unknown}
 */
export function mapSendError(err, ctx) {
  const errors = flattenRpcErrors(err);
  const nonce = errors.find((e) => e instanceof InvalidNonceError);
  if (nonce) return new NonceError({ accountId: ctx.accountId, cause: nonce });
  const allowance = errors.find((e) => e instanceof AccessKeyNotEnoughAllowanceActionError);
  if (allowance) return new KeyAllowanceError({ accountId: ctx.accountId, cause: allowance });
  if (errors.every(isTransportFailure)) {
    console.error({
      scope: 'near',
      msg: 'unknown transaction outcome',
      txHash: ctx.txHash,
      accountId: ctx.accountId,
    });
    return new RpcUnknownOutcomeError({ ...ctx, cause: err });
  }
  return errors.find((e) => e instanceof RpcError) ?? err;
}

/**
 * The panic string inside a failed execution status, if it is a contract panic.
 * @param {unknown} failure the `Failure` value of an execution status
 * @returns {string | null}
 */
export function panicFromFailure(failure) {
  const kind = /** @type {any} */ (failure)?.ActionError?.kind?.FunctionCallError;
  if (typeof kind?.ExecutionError === 'string')
    return panicMessage(kind.ExecutionError) ?? kind.ExecutionError;
  const guest = kind?.HostError?.GuestPanic?.panic_msg;
  return typeof guest === 'string' ? guest : null;
}

/** A transaction failed for a reason other than a contract panic; `failure` is the raw status. */
export class TransactionFailedError extends Error {
  /** @param {{ txHash: string, method?: string, failure: unknown }} details */
  constructor(details) {
    super(`transaction ${details.txHash} failed: ${JSON.stringify(details.failure)}`);
    this.name = 'TransactionFailedError';
    this.txHash = details.txHash;
    this.method = details.method;
    this.failure = details.failure;
  }
}

/**
 * Maps an error thrown by a view call: contract panics become `ContractPanicError`.
 * @param {unknown} err
 * @param {string} method
 * @returns {unknown}
 */
export function mapViewError(err, method) {
  for (const e of flattenRpcErrors(err)) {
    if (e instanceof HostGuestPanicError)
      return new ContractPanicError(e.panicMessage, { method, cause: e });
    const panic = e instanceof Error ? panicMessage(e.message) : null;
    if (panic) return new ContractPanicError(panic, { method, cause: e });
  }
  return err;
}
