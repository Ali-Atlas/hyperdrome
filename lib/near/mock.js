/**
 * In-memory chain adapter with the same interface as `adapter.js` (SPEC.md 6), for service and
 * route tests without RPC. It keeps players and their seq, panics `bad seq`, `not player` and
 * `not owner` the way the contract does, seals keys for real (so a blob moved to another row fails)
 * and records every call in an inspectable log.
 */

import { randomBytes } from 'node:crypto';
import { ContractPanicError, RpcUnknownOutcomeError } from './errors.js';
import { explorerAccountUrl, explorerTxUrl } from './explorer.js';
import { openSecret, sealSecret } from './keys.js';

/** @typedef {import('./index.js').NearAdapter} NearAdapter */
/** @typedef {import('./index.js').CallResult} CallResult */
/** @typedef {import('./events.js').NearEvent} NearEvent */

/** Owner methods (SPEC.md 4.4); a player calling one panics `not owner`. */
const OWNER_METHODS = new Set([
  'create_player',
  'register_player',
  'mint_drone',
  'mint_item',
  'mint_volts',
  'set_team_budget',
  'set_paused',
  'set_base_uri',
]);

/** Test-only key material; never a real secret. */
const MOCK_PLAY_KEY = '11'.repeat(32);
const MOCK_ADMIN_KEY = '22'.repeat(32);

/**
 * @typedef {object} MockCall
 * @property {'create' | 'player' | 'ops' | 'settlement' | 'view' | 'rotate'} kind
 * @property {string} method
 * @property {Record<string, unknown>} args
 * @property {string | null} accountId
 * @property {string | null} txHash
 */

/**
 * @typedef {(args: Record<string, unknown>, ctx: { accountId: string | null }) => { result?: unknown, events?: NearEvent[] } | void} MockHandler
 */

/**
 * @typedef {object} MockControls
 * @property {MockCall[]} calls every call so far, in order
 * @property {(method: string, handler: MockHandler) => void} on result and events for a method; throw `ContractPanicError` to panic
 * @property {(accountId: string, method: string, args: Record<string, unknown>) => CallResult} applyPlayerCall the contract-side player call: checks registration, owner methods and `seq`
 * @property {(mode: 'applied' | 'lost') => void} failNextSend the next send (create, ops or player) throws `RpcUnknownOutcomeError` after applying (`applied`) or without applying (`lost`); a create carries `err.pending`
 * @property {(accountId: string) => { seq: number, isTeam: boolean, keyVersion: number } | undefined} player
 */

/**
 * A fresh mock adapter.
 * @param {{ constants?: unknown, gameId?: string, ownerId?: string, explorerUrl?: string }} [options]
 * @returns {NearAdapter & { mock: MockControls }}
 */
export function createMockNear(options = {}) {
  const gameId = options.gameId ?? 'game.mock.testnet';
  const explorerUrl = options.explorerUrl ?? 'https://testnet.nearblocks.io';
  /** @type {Map<string, { seq: number, isTeam: boolean, keyVersion: number, playKeyEnc: string }>} */
  const players = new Map();
  /** @type {Map<string, MockHandler>} */
  const handlers = new Map();
  /** @type {Map<string, CallResult>} */
  const txs = new Map();
  /** @type {MockCall[]} */
  const calls = [];
  /** @type {'applied' | 'lost' | null} */
  let nextSendFailure = null;
  let txCounter = 0;

  const newTxHash = () => `mocktx${String(++txCounter).padStart(6, '0')}`;

  /** The pending `failNextSend` mode, consumed by the next create, ops or player send. */
  function takeSendFailure() {
    const mode = nextSendFailure;
    nextSendFailure = null;
    return mode;
  }

  /**
   * @param {MockCall['kind']} kind
   * @param {string} method
   * @param {Record<string, unknown>} args
   * @param {string | null} accountId
   * @returns {CallResult}
   */
  function run(kind, method, args, accountId) {
    const txHash = newTxHash();
    calls.push({ kind, method, args, accountId, txHash });
    const out = handlers.get(method)?.(args, { accountId }) ?? {};
    const result = { txHash, result: out.result ?? null, events: out.events ?? [] };
    txs.set(txHash, result);
    return result;
  }

  /** @type {MockControls['applyPlayerCall']} */
  function applyPlayerCall(accountId, method, args) {
    if (OWNER_METHODS.has(method)) throw new ContractPanicError('not owner', { method });
    const player = players.get(accountId);
    if (!player) throw new ContractPanicError('not player', { method });
    if (args.seq !== player.seq + 1) throw new ContractPanicError('bad seq', { method });
    player.seq += 1;
    return run('player', method, args, accountId);
  }

  /**
   * @param {string} accountId
   * @param {boolean} isTeam
   */
  function register(accountId, isTeam) {
    if (!players.has(accountId)) {
      players.set(accountId, { seq: 0, isTeam, keyVersion: 1, playKeyEnc: '' });
    }
  }

  /** @type {NearAdapter} */
  const adapter = {
    async createPlayerAccount({ slug, isTeam }) {
      if (!/^[a-z0-9]{3,20}$/.test(slug))
        throw new ContractPanicError('bad slug', { method: 'create_player' });
      const accountId = `${isTeam ? '' : 'p-'}${slug}.${gameId}`;
      if (players.has(accountId))
        throw new ContractPanicError('exists', { method: 'create_player' });
      const playKeyEnc = sealSecret(randomBytes(32), MOCK_PLAY_KEY, accountId);
      const adminKeyEnc = sealSecret(randomBytes(32), MOCK_ADMIN_KEY, accountId);
      const pending = { accountId, playKeyEnc, adminKeyEnc, keyVersion: 1 };
      const mode = takeSendFailure();
      if (mode === 'lost') {
        throw Object.assign(
          new RpcUnknownOutcomeError({ txHash: newTxHash(), accountId, seq: 0 }),
          {
            pending,
          }
        );
      }
      const created = run('create', 'create_player', { slug, is_team: isTeam }, null);
      created.result = true;
      const { txHash } = created;
      register(accountId, isTeam);
      const player = players.get(accountId);
      if (player) player.playKeyEnc = playKeyEnc;
      if (mode === 'applied') {
        throw Object.assign(new RpcUnknownOutcomeError({ txHash, accountId, seq: 0 }), { pending });
      }
      return { ...pending, txHash };
    },

    async callAsPlayer(accountId, playKeyEnc, method, args = {}) {
      const player = players.get(accountId);
      openSecret(playKeyEnc, MOCK_PLAY_KEY, accountId);
      if (player && player.playKeyEnc !== playKeyEnc)
        throw new Error('play key is not on the account');
      const sent = { ...args, seq: (player?.seq ?? 0) + 1 };
      const mode = takeSendFailure();
      if (mode) {
        const txHash =
          mode === 'applied' ? applyPlayerCall(accountId, method, sent).txHash : newTxHash();
        throw new RpcUnknownOutcomeError({ txHash, accountId, seq: sent.seq });
      }
      return applyPlayerCall(accountId, method, sent);
    },

    async callAsOps(method, args = {}) {
      const mode = takeSendFailure();
      if (mode === 'lost') throw new RpcUnknownOutcomeError({ txHash: newTxHash() });
      if (method === 'register_player') register(String(args.account_id), false);
      const res = run('ops', method, args, null);
      if (mode === 'applied') throw new RpcUnknownOutcomeError({ txHash: res.txHash });
      return res;
    },

    async callAsSettlement(method, args = {}) {
      return run('settlement', method, args, null);
    },

    async view(method, args = {}) {
      calls.push({ kind: 'view', method, args, accountId: null, txHash: null });
      if (method === 'get_player') {
        const p = players.get(String(args.account));
        return p ? { seq: p.seq, created_at_ms: 0, is_team: p.isTeam } : null;
      }
      if (method === 'get_constants') return options.constants ?? {};
      return handlers.get(method)?.(args, { accountId: null })?.result ?? null;
    },

    async getConstants() {
      return options.constants ?? {};
    },

    async nextSeq(accountId) {
      const p = players.get(accountId);
      if (!p) throw new ContractPanicError('not player', { method: 'get_player' });
      return p.seq + 1;
    },

    async resolveOutcome(accountId, seq, txHash) {
      const p = players.get(accountId);
      const applied = p !== undefined && p.seq >= seq && txs.has(txHash);
      if (!applied) return { applied: false };
      const found = /** @type {CallResult} */ (txs.get(txHash));
      return { applied: true, ...found };
    },

    async rotatePlayKey(accountId, adminKeyEnc, { keyVersion = 1 } = {}) {
      openSecret(adminKeyEnc, MOCK_ADMIN_KEY, accountId);
      const p = players.get(accountId);
      if (!p) throw new ContractPanicError('not player', { method: 'rotate_play_key' });
      const { txHash } = run('rotate', 'rotate_play_key', { key_version: keyVersion }, accountId);
      p.keyVersion = keyVersion + 1;
      p.playKeyEnc = sealSecret(randomBytes(32), MOCK_PLAY_KEY, accountId);
      return { playKeyEnc: p.playKeyEnc, keyVersion: p.keyVersion, txHash };
    },

    ownerId: options.ownerId ?? 'owner.mock.testnet',
    gameId,
    explorerTx: (hash) => explorerTxUrl(explorerUrl, hash),
    explorerAccount: (id) => explorerAccountUrl(explorerUrl, id),
    sealSecret,
    openSecret,
  };

  return {
    ...adapter,
    mock: {
      calls,
      on: (method, handler) => void handlers.set(method, handler),
      applyPlayerCall,
      failNextSend: (mode) => {
        nextSendFailure = mode;
      },
      player: (accountId) => {
        const p = players.get(accountId);
        return p ? { seq: p.seq, isTeam: p.isTeam, keyVersion: p.keyVersion } : undefined;
      },
    },
  };
}
