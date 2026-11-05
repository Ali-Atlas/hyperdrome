import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GAS, createRealNear } from '../../lib/near/adapter.js';
import {
  AccountCreateError,
  ContractPanicError,
  KeyAllowanceError,
  NonceError,
  RpcUnknownOutcomeError,
} from '../../lib/near/errors.js';
import { generateKeyPair, openKey, sealKey } from '../../lib/near/keys.js';
import {
  ZERO_HASH,
  chainBasics,
  decodeFunctionCall,
  outcome,
  startFakeRpc,
  viewResult,
} from './fake-rpc.js';

/** @typedef {import('./fake-rpc.js').FakeRpcHandler} FakeRpcHandler */

const GAME = 'game.test.testnet';
const PLAYER = 'p-alice.game.test.testnet';
const keyEncryptionKey = randomBytes(32).toString('hex');
const adminKeyEncryptionKey = randomBytes(32).toString('hex');
const playKey = generateKeyPair();
const playKeyEnc = sealKey(playKey.secretKey, keyEncryptionKey, PLAYER);

/** @type {Array<{ close: () => Promise<void> }>} */
const servers = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

/**
 * A real adapter over fake RPC servers (primary, failover).
 * @param {FakeRpcHandler} primary
 * @param {FakeRpcHandler} [failover]
 */
async function adapterOver(primary, failover = () => 'hang') {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const a = await startFakeRpc(primary);
  const b = await startFakeRpc(failover);
  servers.push(a, b);
  const near = createRealNear(
    {
      network: 'testnet',
      rpcUrl: a.url,
      rpcFailoverUrl: b.url,
      ownerId: 'owner.test.testnet',
      gameId: GAME,
      opsKey: /** @type {any} */ (generateKeyPair().secretKey),
      settlementKey: /** @type {any} */ (generateKeyPair().secretKey),
      keyEncryptionKey,
      adminKeyEncryptionKey,
      explorerUrl: 'https://testnet.nearblocks.io',
    },
    { timeoutMs: 300 }
  );
  return { near, primary: a, failover: b };
}

/**
 * Routes reads to fixtures; `send` answers `send_tx`.
 * @param {{ seq?: number | null, send?: (tx: ReturnType<typeof decodeFunctionCall>) => any, tx?: () => any }} opts
 * @returns {FakeRpcHandler}
 */
const chain =
  ({ seq = 4, send, tx }) =>
  ({ method, params }) => {
    if (method === 'block') return chainBasics.block();
    if (method === 'query' && params.request_type === 'view_access_key')
      return chainBasics.accessKey();
    if (method === 'query' && params.request_type === 'call_function') {
      return viewResult(seq === null ? null : { seq, created_at_ms: 0, is_team: false });
    }
    if (method === 'send_tx' && send) return send(decodeFunctionCall(params.signed_tx_base64));
    if (method === 'tx' && tx) return tx();
    return undefined;
  };

/** @param {string} message */
const panicStatus = (message) => ({
  Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: message } } } },
});
const invalidTx = (/** @type {object} */ data) => ({
  error: {
    name: 'HANDLER_ERROR',
    cause: { name: 'INVALID_TRANSACTION', info: {} },
    code: -32000,
    message: 'Server error',
    data: { TxExecutionError: { InvalidTxError: data } },
  },
});

describe('real adapter over a fake RPC', () => {
  it('callAsPlayer reads seq, sends seq + 1 with zero deposit and default gas, and returns events', async () => {
    /** @type {ReturnType<typeof decodeFunctionCall> | null} */
    let sent = null;
    const event = {
      standard: 'hyperdrome',
      version: '1.0.0',
      event: 'item_bound',
      data: { drone: 'd:1', item: 'm:1' },
    };
    const { near } = await adapterOver(
      chain({
        seq: 4,
        send: (decoded) => {
          sent = decoded;
          return {
            result: outcome({
              hash: 'x',
              status: { SuccessValue: '' },
              receiptLogs: [[`EVENT_JSON:${JSON.stringify(event)}`, 'log']],
            }),
          };
        },
      })
    );
    const res = await near.callAsPlayer(PLAYER, playKeyEnc, 'bind', { drone: 'd:1', item: 'm:1' });
    expect(sent).toMatchObject({
      signerId: PLAYER,
      receiverId: GAME,
      methodName: 'bind',
      args: { drone: 'd:1', item: 'm:1', seq: 5 },
      gas: DEFAULT_GAS.player,
      deposit: 0n,
      nonce: 6n,
    });
    expect(res.txHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(res.events.map((e) => e.event)).toEqual(['item_bound']);
  });

  it('callAsPlayer hands the hash to onSigned before the broadcast, and sends nothing if it throws', async () => {
    /** @type {string[]} */
    const order = [];
    const { near } = await adapterOver(
      chain({
        send: () => {
          order.push('send');
          return { result: outcome({ hash: 'x', status: { SuccessValue: '' } }) };
        },
      })
    );
    const signed = async (/** @type {string} */ hash) => {
      order.push(`signed:${hash}`);
    };
    const res = await near.callAsPlayer(PLAYER, playKeyEnc, 'bind', {}, { onSigned: signed });
    expect(order).toEqual([`signed:${res.txHash}`, 'send']);

    order.length = 0;
    const fail = async () => {
      throw new Error('db down');
    };
    const err = await near
      .callAsPlayer(PLAYER, playKeyEnc, 'bind', {}, { onSigned: fail })
      .catch((e) => e);
    expect(err.message).toBe('db down');
    expect(order).toEqual([]);
  });

  it('maps a contract panic to ContractPanicError carrying the SPEC 4.8 string and tx hash', async () => {
    const { near } = await adapterOver(
      chain({
        send: () => ({
          result: outcome({ hash: 'x', status: panicStatus('Smart contract panicked: bad seq') }),
        }),
      })
    );
    const err = await near.callAsPlayer(PLAYER, playKeyEnc, 'bind', {}).catch((e) => e);
    expect(err).toBeInstanceOf(ContractPanicError);
    expect(err).toMatchObject({ panic: 'bad seq', method: 'bind' });
    expect(err.txHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  });

  it('maps NotEnoughAllowance to KeyAllowanceError and InvalidNonce to NonceError', async () => {
    const allowance = invalidTx({
      InvalidAccessKeyError: {
        NotEnoughAllowance: {
          account_id: PLAYER,
          public_key: playKey.publicKey,
          allowance: '1',
          cost: '2',
        },
      },
    });
    const { near } = await adapterOver(
      chain({ send: () => allowance }),
      chain({ send: () => allowance })
    );
    await expect(near.callAsPlayer(PLAYER, playKeyEnc, 'bind', {})).rejects.toBeInstanceOf(
      KeyAllowanceError
    );

    const nonce = invalidTx({ InvalidNonce: { tx_nonce: 6, ak_nonce: 9 } });
    const second = await adapterOver(chain({ send: () => nonce }), chain({ send: () => nonce }));
    await expect(
      second.near.callAsOps('mint_volts', { to: PLAYER, amount: '1' })
    ).rejects.toBeInstanceOf(NonceError);
  });

  it('turns a send timeout on every provider into RpcUnknownOutcomeError with hash and seq', async () => {
    const hangSend = chain({ send: () => 'hang' });
    const { near } = await adapterOver(hangSend, hangSend);
    const err = await near.callAsPlayer(PLAYER, playKeyEnc, 'bind', {}).catch((e) => e);
    expect(err).toBeInstanceOf(RpcUnknownOutcomeError);
    expect(err).toMatchObject({ accountId: PLAYER, seq: 5 });
    expect(err.txHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  });

  it('recovers a timed-out send by looking the transaction up by its hash', async () => {
    const event = { standard: 'hyperdrome', version: '1.0.0', event: 'item_bound', data: {} };
    const handler = chain({
      send: () => 'hang',
      tx: () => ({
        result: outcome({
          hash: 'x',
          status: { SuccessValue: '' },
          receiptLogs: [[`EVENT_JSON:${JSON.stringify(event)}`]],
        }),
      }),
    });
    const { near } = await adapterOver(handler, handler);
    const res = await near.callAsPlayer(PLAYER, playKeyEnc, 'bind', {});
    expect(res.events.map((e) => e.event)).toEqual(['item_bound']);
  });

  it('resolves InvalidNonce from the failover by the hash when the first node already executed the send', async () => {
    const event = {
      standard: 'nep141',
      version: '1.0.0',
      event: 'ft_mint',
      data: [{ owner_id: PLAYER, amount: '5' }],
    };
    const executed = () => ({
      result: outcome({
        hash: 'x',
        status: { SuccessValue: '' },
        receiptLogs: [[`EVENT_JSON:${JSON.stringify(event)}`]],
      }),
    });
    const nonce = invalidTx({ InvalidNonce: { tx_nonce: 6, ak_nonce: 6 } });
    const { near, primary, failover } = await adapterOver(
      chain({ send: () => 'hang', tx: executed }),
      chain({ send: () => nonce, tx: executed })
    );
    const res = await near.callAsOps('mint_volts', { to: PLAYER, amount: '5' });
    expect(res.events.map((e) => e.event)).toEqual(['ft_mint']);
    expect(res.txHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(failover.requests.filter((r) => r.method === 'send_tx')).toHaveLength(1);
    const lookups = [...primary.requests, ...failover.requests].filter((r) => r.method === 'tx');
    expect(lookups.length).toBeGreaterThan(0);
    expect(lookups.every((r) => JSON.stringify(r.params).includes(res.txHash))).toBe(true);
  });

  it('resends an ops call once with a fresh nonce after InvalidNonce when the hash is unknown', async () => {
    const event = { standard: 'nep141', version: '1.0.0', event: 'ft_mint', data: [] };
    const nonce = invalidTx({ InvalidNonce: { tx_nonce: 6, ak_nonce: 9 } });
    const unknownTx = {
      error: {
        name: 'HANDLER_ERROR',
        cause: { name: 'UNKNOWN_TRANSACTION', info: {} },
        code: -32000,
        message: 'Server error',
        data: 'Transaction unknown',
      },
    };
    let sends = 0;
    // Both providers share this handler: the first round of sends is rejected on each, the
    // by-hash lookups find nothing, and the rebuilt resend succeeds.
    const handler = chain({
      send: () =>
        ++sends <= 2
          ? nonce
          : {
              result: outcome({
                hash: 'x',
                status: { SuccessValue: '' },
                receiptLogs: [[`EVENT_JSON:${JSON.stringify(event)}`]],
              }),
            },
      tx: () => unknownTx,
    });
    const { near, primary, failover } = await adapterOver(handler, handler);
    const res = await near.callAsOps('mint_volts', { to: PLAYER, amount: '5' });
    expect(res.events.map((e) => e.event)).toEqual(['ft_mint']);
    const sent = [...primary.requests, ...failover.requests].filter((r) => r.method === 'send_tx');
    expect(sent).toHaveLength(3);
    expect(sent.map((r) => decodeFunctionCall(r.params.signed_tx_base64).methodName)).toEqual([
      'mint_volts',
      'mint_volts',
      'mint_volts',
    ]);
  });

  it('nextSeq panics `not player` for an unregistered account', async () => {
    const { near } = await adapterOver(chain({ seq: null }));
    await expect(near.nextSeq(PLAYER)).rejects.toMatchObject({ panic: 'not player' });
  });

  it('createPlayerAccount seals both keys to the account and fails when the callback returns false', async () => {
    /** @type {any} */
    let args = null;
    let created = true;
    const handler = chain({
      send: (tx) => {
        args = tx.args;
        expect(tx).toMatchObject({
          methodName: 'create_player',
          gas: DEFAULT_GAS.createPlayer,
          deposit: 0n,
        });
        return {
          result: outcome({
            hash: 'x',
            status: { SuccessValue: Buffer.from(String(created)).toString('base64') },
          }),
        };
      },
    });
    const { near } = await adapterOver(handler);
    const res = await near.createPlayerAccount({ slug: 'alice', isTeam: false });
    expect(res).toMatchObject({ accountId: PLAYER, keyVersion: 1 });
    expect(args).toMatchObject({ slug: 'alice', is_team: false });
    expect(openKey(res.playKeyEnc, keyEncryptionKey, PLAYER)).toMatch(/^ed25519:/);
    expect(openKey(res.adminKeyEnc, adminKeyEncryptionKey, PLAYER)).toMatch(/^ed25519:/);
    expect(() => openKey(res.adminKeyEnc, keyEncryptionKey, PLAYER)).toThrow();
    created = false;
    await expect(near.createPlayerAccount({ slug: 'bob', isTeam: false })).rejects.toBeInstanceOf(
      AccountCreateError
    );
  });

  it('resolveOutcome: applied when seq reached the sent value, otherwise not', async () => {
    const tx = () => ({ result: outcome({ hash: 'x', status: { SuccessValue: '' } }) });
    const { near } = await adapterOver(chain({ seq: 5, tx }));
    expect(await near.resolveOutcome(PLAYER, 5, ZERO_HASH)).toMatchObject({
      applied: true,
      txHash: ZERO_HASH,
    });
    expect(await near.resolveOutcome(PLAYER, 6, ZERO_HASH)).toEqual({ applied: false });
  });

  it('builds explorer links', async () => {
    const { near } = await adapterOver(chain({}));
    expect(near.explorerTx('abc')).toBe('https://testnet.nearblocks.io/txns/abc');
    expect(near.explorerAccount(PLAYER)).toBe(`https://testnet.nearblocks.io/address/${PLAYER}`);
  });
});
