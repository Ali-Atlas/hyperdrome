/**
 * Wallet ownership proof (SPEC.md 6): verifies a NEP-413 signed message and that its public key is
 * a full-access key of the account on chain, through near-api-js's `verifyMessage`. Returns false
 * for a signature or key that does not hold up; RPC failures throw, so a chain outage is never
 * reported as a bad signature.
 */

import { verifyMessage } from 'near-api-js/nep413';
import {
  AccessKeyDoesNotExistError,
  AccountDoesNotExistError,
  InvalidAccountError,
} from 'near-api-js/rpc-errors';
import { flattenRpcErrors } from './errors.js';

/** A failed proof, as `verifyMessage` reports it (no typed error for these two). */
const REFUSED = /does not have FullAccess permission|Signature verification failed/;
/** ed25519 signature length in bytes. */
const SIGNATURE_LENGTH = 64;
const NONCE_LENGTH = 32;

/**
 * @typedef {object} WalletSignatureInput
 * @property {string} accountId the wallet account
 * @property {string} publicKey `ed25519:<base58>`
 * @property {string} signature base64 ed25519 signature
 * @property {string} message
 * @property {Uint8Array} nonce 32 bytes
 * @property {string} recipient
 * @property {string} [callbackUrl] only when the wallet signed one (NEP-413 `callbackUrl`)
 */

/**
 * True when `signature` is a valid NEP-413 signature over this message by a full-access key of
 * `accountId`.
 * @param {Pick<import('near-api-js').Provider, 'viewAccessKey'>} provider
 * @param {WalletSignatureInput} input
 * @returns {Promise<boolean>}
 */
export async function verifyNep413(provider, input) {
  const { accountId, publicKey, signature, message, nonce, recipient, callbackUrl } = input;
  const signatureBytes = Buffer.from(signature, 'base64');
  if (signatureBytes.length !== SIGNATURE_LENGTH || nonce.length !== NONCE_LENGTH) return false;
  try {
    await verifyMessage({
      signerAccountId: accountId,
      signerPublicKey: publicKey,
      signature: signatureBytes,
      payload: { message, recipient, nonce, callbackUrl },
      provider: /** @type {import('near-api-js').Provider} */ (provider),
    });
    return true;
  } catch (err) {
    if (err instanceof Error && REFUSED.test(err.message)) return false;
    const known = flattenRpcErrors(err).some(
      (e) =>
        e instanceof AccessKeyDoesNotExistError ||
        e instanceof AccountDoesNotExistError ||
        e instanceof InvalidAccountError
    );
    if (known) return false;
    throw err;
  }
}
