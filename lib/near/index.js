/**
 * Chain adapter (SPEC.md 6): the only module that talks to NEAR. `getNear()` returns the process
 * singleton: the real adapter, or the in-memory mock when `NEAR_ADAPTER=mock`.
 */

import { createRealNear } from './adapter.js';
import { readAdapterKind, readConfig } from './config.js';
import { createMockNear } from './mock.js';

export {
  AccountCreateError,
  ContractPanicError,
  KeyAllowanceError,
  NonceError,
  RpcUnknownOutcomeError,
} from './errors.js';
export { openSecret, sealSecret } from './keys.js';

/** @typedef {import('./events.js').NearEvent} NearEvent */

/**
 * @typedef {object} CallResult
 * @property {string} txHash
 * @property {unknown} result the method's JSON return value, or null
 * @property {NearEvent[]} events parsed `EVENT_JSON` logs in receipt order
 */

/**
 * @typedef {{ gas?: bigint, seq?: number }} CallOptions `gas` in gas units (defaults per call kind);
 *   `seq` (player calls only) pins the seq the call carries instead of reading the next one, so a
 *   resend of one action can never apply under a second seq
 */

/**
 * @typedef {object} NearAdapter
 * @property {(input: { slug: string, isTeam: boolean }) => Promise<{ accountId: string, playKeyEnc: string, adminKeyEnc: string, keyVersion: number, txHash: string }>} createPlayerAccount
 *   Generates the admin and play keypairs, calls `create_player` with the ops key and returns the
 *   keys sealed under their encryption keys (AAD = account id).
 * @property {(accountId: string, playKeyEnc: string, method: string, args?: Record<string, unknown>, options?: CallOptions) => Promise<CallResult>} callAsPlayer
 *   Reads the on-chain seq and sends `seq + 1` with the args, or the pinned `options.seq`.
 * @property {(method: string, args?: Record<string, unknown>, options?: CallOptions) => Promise<CallResult>} callAsOps
 * @property {(method: string, args?: Record<string, unknown>, options?: CallOptions) => Promise<CallResult>} callAsSettlement
 * @property {(method: string, args?: Record<string, unknown>) => Promise<unknown>} view
 * @property {() => Promise<unknown>} getConstants `get_constants()`, cached for the process
 * @property {(accountId: string) => Promise<number>} nextSeq the seq the next player call will carry
 * @property {(accountId: string, seq: number, txHash: string, options?: { senderId?: string }) => Promise<({ applied: true } & CallResult) | { applied: false }>} resolveOutcome
 *   `senderId` is the transaction's signer when it is not `accountId` (`create_player` is signed by the owner).
 *   After `RpcUnknownOutcomeError`: applied if the account's seq reached `seq`, then the call's result.
 * @property {(accountId: string, adminKeyEnc: string, options?: { keyVersion?: number }) => Promise<{ playKeyEnc: string, keyVersion: number, txHash: string }>} rotatePlayKey
 *   The only path that opens an admin key: one transaction deleting the old play key and adding a new one.
 * @property {string} ownerId the owner account that signs ops calls (`create_player` among them)
 * @property {string} gameId the game contract account
 * @property {(hash: string) => string} explorerTx
 * @property {(id: string) => string} explorerAccount
 * @property {typeof import('./keys.js').sealSecret} sealSecret
 * @property {typeof import('./keys.js').openSecret} openSecret
 */

/** @type {NearAdapter | null} */
let singleton = null;

/**
 * The process-wide adapter. Reads and validates the environment on first use.
 * @returns {NearAdapter}
 */
export function getNear() {
  singleton ??= readAdapterKind() === 'mock' ? createMockNear() : createRealNear(readConfig());
  return singleton;
}
