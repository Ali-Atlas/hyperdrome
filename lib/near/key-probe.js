/**
 * Key probe for the security demo (SPEC.md 14, `npm run attack:demo`): sends, with a play key, the
 * transactions the adapter never builds (a deposit, a NEAR transfer, a method outside the key's
 * list) and reports how the chain answered. The adapter (`adapter.js`) still sends every app
 * transaction with deposit 0; nothing in the app imports this module, only
 * `scripts/attack-demo.mjs` does. It opens no admin key.
 */

import { Account, KeyPairSigner, actions, baseEncode } from 'near-api-js';
import { RpcError } from 'near-api-js/rpc-errors';
import { readConfig } from './config.js';
import {
  ContractPanicError,
  RpcUnknownOutcomeError,
  TransactionFailedError,
  flattenRpcErrors,
  mapSendError,
} from './errors.js';
import { openKey } from './keys.js';
import { callResultFromOutcome } from './outcome.js';
import { createProvider } from './provider.js';

const TGAS = 1_000_000_000_000n;

/**
 * @typedef {{ type: 'call', method: string, args: Record<string, unknown>, depositYocto?: bigint, gasTgas?: number }
 *   | { type: 'transfer', yocto: bigint }} ProbeAction
 * @typedef {object} ProbeResult
 * @property {'executed' | 'failed' | 'rejected'} status `executed`: it ran and succeeded;
 *   `failed`: it reached a block and failed there (a contract panic); `rejected`: the RPC refused
 *   it before any block, so the hash never appears on chain
 * @property {string} txHash the signed transaction's hash (only on chain unless `rejected`)
 * @property {string | null} panic the contract's panic string, when `failed` by a panic
 * @property {string | null} error the exact error: the panic text, or the RPC error's name and message
 * @property {unknown} [result] the call's return value, when `executed`
 * @typedef {{ publicKey: string, permission: unknown }} AccessKeyView
 */

/**
 * The exact text of an RPC rejection: the error's class name, its message, and its data when the
 * class carries any.
 * @param {unknown} err
 * @returns {string}
 */
function rejectionText(err) {
  const rpc = flattenRpcErrors(err).find((e) => e instanceof RpcError) ?? err;
  const e =
    /** @type {{ name?: string, constructor?: { name?: string }, message?: string, data?: unknown }} */ (
      rpc
    );
  const name = e.constructor?.name ?? e.name ?? 'Error';
  const data = e.data === undefined ? '' : ` ${JSON.stringify(e.data)}`;
  return `${name}: ${e.message ?? String(rpc)}${data}`;
}

/**
 * The probe, on the adapter's config (`readConfig`) and RPC providers.
 * @param {import('./config.js').NearConfig} [config]
 */
export function createKeyProbe(config = readConfig()) {
  const provider = createProvider(config);

  return {
    /**
     * Sign one transaction with the play key of `accountId` and send it, waiting for `EXECUTED`.
     * A transport failure (no answer) throws `RpcUnknownOutcomeError`; every answer is a result.
     * @param {string} accountId
     * @param {string} playKeyEnc the sealed play key (`users.play_key_enc`)
     * @param {{ receiverId: string, action: ProbeAction }} tx
     * @returns {Promise<ProbeResult>}
     */
    async send(accountId, playKeyEnc, { receiverId, action }) {
      const signer = KeyPairSigner.fromSecretKey(
        openKey(playKeyEnc, config.keyEncryptionKey, accountId)
      );
      const account = new Account(accountId, provider, signer);
      const act =
        action.type === 'transfer'
          ? actions.transfer(action.yocto)
          : actions.functionCall(
              action.method,
              action.args,
              BigInt(action.gasTgas ?? 30) * TGAS,
              action.depositYocto ?? 0n
            );
      const publicKey = await signer.getPublicKey();
      const transaction = await account.createTransaction({
        receiverId,
        actions: [act],
        publicKey,
      });
      const { txHash: hashBytes, signedTransaction } = await signer.signTransaction(transaction);
      const txHash = baseEncode(hashBytes);
      let outcome;
      try {
        outcome = await provider.sendTransactionUntil(signedTransaction, 'EXECUTED');
      } catch (err) {
        const mapped = mapSendError(err, { txHash, accountId });
        if (mapped instanceof RpcUnknownOutcomeError) throw mapped;
        return { status: 'rejected', txHash, panic: null, error: rejectionText(err) };
      }
      const method = action.type === 'call' ? action.method : 'transfer';
      try {
        const { result } = callResultFromOutcome(outcome, txHash, method);
        return { status: 'executed', txHash, panic: null, error: null, result };
      } catch (err) {
        if (err instanceof ContractPanicError) {
          return {
            status: 'failed',
            txHash,
            panic: err.panic,
            error: `Smart contract panicked: ${err.panic}`,
          };
        }
        if (err instanceof TransactionFailedError) {
          return { status: 'failed', txHash, panic: null, error: err.message };
        }
        throw err;
      }
    },

    /**
     * The account's access keys, as the chain lists them.
     * @param {string} accountId
     * @returns {Promise<AccessKeyView[]>}
     */
    async accessKeys(accountId) {
      const { keys } = await provider.viewAccessKeyList({ accountId });
      return keys.map((k) => ({
        publicKey: String(k.public_key),
        permission: k.access_key.permission,
      }));
    },
  };
}

/** @typedef {ReturnType<typeof createKeyProbe>} KeyProbe */
