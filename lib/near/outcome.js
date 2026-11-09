/**
 * Reading a final execution outcome (SPEC.md 6): the call result, or the typed error for a failed
 * status.
 */
import { getTransactionLastResult } from 'near-api-js';
import { ContractPanicError, TransactionFailedError, panicFromFailure } from './errors.js';
import { parseEvents } from './events.js';

/** @typedef {import('./index.js').CallResult} CallResult */

/**
 * Turns a final execution outcome into a call result. A failed status throws `ContractPanicError`
 * for a contract panic (SPEC.md 4.8 string) and `TransactionFailedError` otherwise.
 * @param {any} outcome RPC final execution outcome
 * @param {string} txHash
 * @param {string} method
 * @returns {CallResult}
 */
export function callResultFromOutcome(outcome, txHash, method) {
  const status = outcome.status;
  if (status && typeof status === 'object' && 'Failure' in status) {
    const panic = panicFromFailure(status.Failure);
    if (panic) throw new ContractPanicError(panic, { method, txHash });
    throw new TransactionFailedError({ txHash, method, failure: status.Failure });
  }
  return {
    txHash,
    result: getTransactionLastResult(outcome) ?? null,
    events: parseEvents(outcome),
  };
}
