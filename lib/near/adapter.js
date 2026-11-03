/**
 * Real chain adapter (SPEC.md 6) over near-api-js 7.4.0. Transactions are built and signed here so
 * the hash is known before sending, then sent with `waitUntil: 'EXECUTED'` (the transaction's block
 * is final and every non-refund receipt has executed). Deposits are always 0.
 */

import {
  Account,
  KeyPairSigner,
  PublicKey,
  actions,
  baseEncode,
  getTransactionLastResult,
} from 'near-api-js';
import { UnknownTransactionError } from 'near-api-js/rpc-errors';
import {
  AccountCreateError,
  ContractPanicError,
  NonceError,
  RpcUnknownOutcomeError,
  TransactionFailedError,
  flattenRpcErrors,
  mapSendError,
  mapViewError,
  panicFromFailure,
} from './errors.js';
import { parseEvents } from './events.js';
import { explorerAccountUrl, explorerTxUrl } from './explorer.js';
import { generateKeyPair, openKey, openSecret, sealKey, sealSecret } from './keys.js';
import { createProvider } from './provider.js';

/** @typedef {import('./config.js').NearConfig} NearConfig */
/** @typedef {import('./index.js').NearAdapter} NearAdapter */
/** @typedef {import('./index.js').CallResult} CallResult */
/** @typedef {import('near-api-js').Signer} Signer */

const TGAS = 1_000_000_000_000n;
/** Default gas per call kind (SPEC.md 6). */
export const DEFAULT_GAS = {
  player: 30n * TGAS,
  ops: 30n * TGAS,
  createPlayer: 60n * TGAS,
  settlement: 200n * TGAS,
};
/** Play key scope (SPEC.md 4.1). */
export const PLAY_KEY_METHODS = [
  'allocate_stats',
  'equip',
  'bind',
  'list',
  'buy',
  'cancel',
  'open_pack',
  'reveal_pack',
  'vendor_buy_drone',
];
export const PLAY_KEY_ALLOWANCE = 1_000_000_000_000_000_000_000_000n;
const WAIT_UNTIL = 'EXECUTED';
/** Lookups by hash after a send timeout before reporting an unknown outcome. */
const RECOVERY_ATTEMPTS = 3;
/** Failover rounds for an idempotent view before giving up. */
const VIEW_ROUNDS = 2;

/**
 * Player or team account id for a slug (SPEC.md 4.1).
 * @param {string} slug
 * @param {boolean} isTeam
 * @param {string} gameId
 * @returns {string}
 */
export function playerAccountId(slug, isTeam, gameId) {
  return `${isTeam ? '' : 'p-'}${slug}.${gameId}`;
}

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

/**
 * The real adapter for `config`.
 * @param {NearConfig} config
 * @param {{ timeoutMs?: number }} [options] per-call RPC timeout (tests shorten it)
 * @returns {NearAdapter}
 */
export function createRealNear(config, options = {}) {
  const provider = createProvider({ ...config, timeoutMs: options.timeoutMs });
  const signers = {
    ops: KeyPairSigner.fromSecretKey(
      /** @type {import('near-api-js').KeyPairString} */ (config.opsKey)
    ),
    settlement: KeyPairSigner.fromSecretKey(
      /** @type {import('near-api-js').KeyPairString} */ (config.settlementKey)
    ),
  };
  /** Long-lived accounts so their nonce caches serve concurrent ops and settlement calls. */
  /** @type {{ ops: Account | null, settlement: Account | null }} */
  const shared = { ops: null, settlement: null };
  /** @type {Promise<unknown> | null} */
  let constants = null;

  /**
   * @param {'ops' | 'settlement'} kind
   * @returns {Account}
   */
  function sharedAccount(kind) {
    const id = kind === 'ops' ? config.ownerId : config.gameId;
    shared[kind] ??= new Account(id, provider, signers[kind]);
    return shared[kind];
  }

  /**
   * Builds, signs and sends one transaction.
   * @param {{ account: Account, signer: Signer, receiverId: string, actions: import('near-api-js').Action[], method: string, seq?: number }} tx
   * @returns {Promise<CallResult>}
   */
  async function send({ account, signer, receiverId, actions: acts, method, seq }) {
    const publicKey = await signer.getPublicKey();
    const transaction = await account.createTransaction({ receiverId, actions: acts, publicKey });
    const { txHash: hashBytes, signedTransaction } = await signer.signTransaction(transaction);
    const txHash = baseEncode(hashBytes);
    let outcome;
    try {
      outcome = await provider.sendTransactionUntil(signedTransaction, WAIT_UNTIL);
    } catch (err) {
      const mapped = mapSendError(err, { txHash, accountId: account.accountId, seq });
      // A timeout leaves the outcome unknown. InvalidNonce after a failover usually means the
      // first node already executed this same signed transaction; an ops call has no seq to stop a
      // rebuilt resend from applying twice. Either way, look the hash up before reporting.
      if (!(mapped instanceof RpcUnknownOutcomeError || mapped instanceof NonceError)) throw mapped;
      outcome = await recoverByHash(txHash, account.accountId);
      if (!outcome) throw mapped;
    }
    return callResultFromOutcome(outcome, txHash, method);
  }

  /**
   * After a send timeout, looks the transaction up by its hash (docs.near.org: recover a timed-out
   * transaction by its original hash). Returns the outcome, or null if it is still unknown.
   * @param {string} txHash
   * @param {string} senderId
   * @returns {Promise<any | null>}
   */
  async function recoverByHash(txHash, senderId) {
    for (let attempt = 1; attempt <= RECOVERY_ATTEMPTS; attempt++) {
      try {
        return await provider.viewTransactionStatus({
          txHash,
          accountId: senderId,
          waitUntil: WAIT_UNTIL,
        });
      } catch (err) {
        console.error({
          scope: 'near',
          msg: 'transaction not resolved yet',
          txHash,
          attempt,
          error: String(err),
        });
      }
    }
    return null;
  }

  /**
   * A function call on the game contract.
   * @param {Account} account
   * @param {Signer} signer
   * @param {string} method
   * @param {Record<string, unknown>} args
   * @param {bigint} gas
   * @param {number} [seq]
   * @returns {Promise<CallResult>}
   */
  function call(account, signer, method, args, gas, seq) {
    const act = actions.functionCall(method, args, gas, 0n);
    return send({ account, signer, receiverId: config.gameId, actions: [act], method, seq });
  }

  /**
   * An ops or settlement call; a nonce error resets the shared account's nonce cache.
   * @param {'ops' | 'settlement'} kind
   * @param {string} method
   * @param {Record<string, unknown>} args
   * @param {bigint} gas
   * @returns {Promise<CallResult>}
   */
  async function sharedCall(kind, method, args, gas) {
    try {
      return await call(sharedAccount(kind), signers[kind], method, args, gas);
    } catch (err) {
      if (err instanceof NonceError) shared[kind] = null;
      throw err;
    }
  }

  /**
   * A view call. Views are idempotent, so when every provider fails, the whole failover round is
   * tried once more; a contract panic is never retried.
   * @type {NearAdapter['view']}
   */
  async function view(method, args = {}) {
    for (let round = 1; ; round++) {
      try {
        const result = await provider.callFunction({
          contractId: config.gameId,
          method,
          args,
          blockQuery: { finality: 'optimistic' },
        });
        return result ?? null;
      } catch (err) {
        const mapped = mapViewError(err, method);
        if (mapped instanceof ContractPanicError || round >= VIEW_ROUNDS) throw mapped;
        console.error({
          scope: 'near',
          msg: 'view failed on every provider, retrying',
          method,
          round,
        });
      }
    }
  }

  /** @type {NearAdapter['nextSeq']} */
  async function nextSeq(accountId) {
    const player = /** @type {{ seq: number } | null} */ (
      await view('get_player', { account: accountId })
    );
    if (!player) throw new ContractPanicError('not player', { method: 'get_player' });
    return player.seq + 1;
  }

  return {
    async createPlayerAccount({ slug, isTeam }) {
      const accountId = playerAccountId(slug, isTeam, config.gameId);
      const admin = generateKeyPair();
      const play = generateKeyPair();
      const pending = {
        accountId,
        playKeyEnc: sealKey(play.secretKey, config.keyEncryptionKey, accountId),
        adminKeyEnc: sealKey(admin.secretKey, config.adminKeyEncryptionKey, accountId),
        keyVersion: 1,
      };
      const args = { slug, admin_pk: admin.publicKey, play_pk: play.publicKey, is_team: isTeam };
      let res;
      try {
        res = await sharedCall('ops', 'create_player', args, DEFAULT_GAS.createPlayer);
      } catch (err) {
        if (err instanceof RpcUnknownOutcomeError) Object.assign(err, { pending });
        throw err;
      }
      if (res.result !== true) throw new AccountCreateError({ accountId, txHash: res.txHash });
      return { ...pending, txHash: res.txHash };
    },

    async callAsPlayer(accountId, playKeyEnc, method, args = {}, options = {}) {
      const key = openKey(playKeyEnc, config.keyEncryptionKey, accountId);
      const signer = KeyPairSigner.fromSecretKey(key);
      const seq = await nextSeq(accountId);
      const account = new Account(accountId, provider, signer);
      return call(
        account,
        signer,
        method,
        { ...args, seq },
        options.gas ?? DEFAULT_GAS.player,
        seq
      );
    },

    callAsOps: (method, args = {}, options = {}) =>
      sharedCall('ops', method, args, options.gas ?? DEFAULT_GAS.ops),

    callAsSettlement: (method, args = {}, options = {}) =>
      sharedCall('settlement', method, args, options.gas ?? DEFAULT_GAS.settlement),

    view,

    getConstants() {
      constants ??= view('get_constants').catch((err) => {
        constants = null;
        throw err;
      });
      return constants;
    },

    nextSeq,

    async resolveOutcome(accountId, seq, txHash) {
      const player = /** @type {{ seq: number } | null} */ (
        await view('get_player', { account: accountId })
      );
      if (!player || player.seq < seq) return { applied: false };
      let outcome;
      try {
        outcome = await provider.viewTransactionStatus({
          txHash,
          accountId,
          waitUntil: WAIT_UNTIL,
        });
      } catch (err) {
        if (flattenRpcErrors(err).some((e) => e instanceof UnknownTransactionError))
          return { applied: false };
        throw err;
      }
      try {
        return { applied: true, ...callResultFromOutcome(outcome, txHash, 'resolve_outcome') };
      } catch (err) {
        if (err instanceof ContractPanicError && err.panic === 'bad seq') return { applied: false };
        throw err;
      }
    },

    async rotatePlayKey(accountId, adminKeyEnc, { keyVersion = 1 } = {}) {
      const signer = KeyPairSigner.fromSecretKey(
        openKey(adminKeyEnc, config.adminKeyEncryptionKey, accountId)
      );
      const { keys } = await provider.viewAccessKeyList({ accountId });
      const oldPlayKeys = keys
        .filter(({ access_key: { permission } }) => {
          const fc =
            typeof permission === 'object' && 'FunctionCall' in permission
              ? permission.FunctionCall
              : null;
          return fc?.receiver_id === config.gameId;
        })
        .map((k) => PublicKey.fromString(String(k.public_key)));
      const next = generateKeyPair();
      const pending = {
        playKeyEnc: sealKey(next.secretKey, config.keyEncryptionKey, accountId),
        keyVersion: keyVersion + 1,
      };
      const acts = [
        ...oldPlayKeys.map((pk) => actions.deleteKey(pk)),
        actions.addFunctionCallAccessKey(
          PublicKey.fromString(next.publicKey),
          config.gameId,
          PLAY_KEY_METHODS,
          PLAY_KEY_ALLOWANCE
        ),
      ];
      const account = new Account(accountId, provider, signer);
      try {
        const { txHash } = await send({
          account,
          signer,
          receiverId: accountId,
          actions: acts,
          method: 'rotate_play_key',
        });
        return { ...pending, txHash };
      } catch (err) {
        if (err instanceof RpcUnknownOutcomeError) Object.assign(err, { pending });
        throw err;
      }
    },

    explorerTx: (hash) => explorerTxUrl(config.explorerUrl, hash),
    explorerAccount: (id) => explorerAccountUrl(config.explorerUrl, id),
    sealSecret,
    openSecret,
  };
}
