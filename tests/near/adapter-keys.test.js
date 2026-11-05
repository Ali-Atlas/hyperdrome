/**
 * The real adapter's key paths over a fake RPC: `createPlayerAccount` handing its sealed keys to
 * `onSigned`, the play key rotation (decoded from the signed transaction) and `accountBalance`.
 */
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRealNear } from '../../lib/near/adapter.js';
import { generateKeyPair, openKey, sealKey } from '../../lib/near/keys.js';
import { PLAY_KEY_ALLOWANCE, PLAY_KEY_METHODS } from '../../lib/near/play-key.js';
import {
  ZERO_HASH,
  chainBasics,
  decodeKeyRotation,
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

/** @type {Array<{ close: () => Promise<void> }>} */
const servers = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

/**
 * A real adapter over a fake RPC (the failover hangs).
 * @param {FakeRpcHandler} primary
 */
async function adapterOver(primary) {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const a = await startFakeRpc(primary);
  const b = await startFakeRpc(() => 'hang');
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
  return { near };
}

/**
 * The reads every transaction needs, plus `send` for `send_tx`.
 * @param {(signedTxBase64: string) => any} [send]
 * @returns {FakeRpcHandler}
 */
const chain =
  (send) =>
  ({ method, params }) => {
    if (method === 'block') return chainBasics.block();
    if (method === 'query' && params.request_type === 'view_access_key')
      return chainBasics.accessKey();
    if (method === 'query' && params.request_type === 'call_function') {
      return viewResult({ seq: 0, created_at_ms: 0, is_team: false });
    }
    if (method === 'send_tx' && send) return send(params.signed_tx_base64);
    return undefined;
  };

describe('real adapter key paths over a fake RPC', () => {
  it('createPlayerAccount hands the sealed keys and the hash to onSigned before the broadcast', async () => {
    let sends = 0;
    const handler = chain(() => {
      sends += 1;
      return {
        result: outcome({
          hash: 'x',
          status: { SuccessValue: Buffer.from('true').toString('base64') },
        }),
      };
    });
    const { near } = await adapterOver(handler);
    /** @type {any[]} */
    const signed = [];
    const res = await near.createPlayerAccount({
      slug: 'carol',
      isTeam: true,
      onSigned: async (attempt) => {
        signed.push({ ...attempt, sendsSoFar: sends });
      },
    });
    expect(res.accountId).toBe('carol.game.test.testnet');
    // The same keys and hash the call returns, handed over while nothing was sent yet.
    expect(signed).toEqual([{ ...res, sendsSoFar: 0 }]);
    expect(sends).toBe(1);

    await expect(
      near.createPlayerAccount({
        slug: 'dave',
        isTeam: true,
        onSigned: async () => {
          throw new Error('store failed');
        },
      })
    ).rejects.toThrow('store failed');
    expect(sends).toBe(1);
  });

  it('rotatePlayKey deletes the old play key and adds one with the given allowance (default 1 NEAR)', async () => {
    const admin = generateKeyPair();
    const adminKeyEnc = sealKey(admin.secretKey, adminKeyEncryptionKey, PLAYER);
    /** @type {ReturnType<typeof decodeKeyRotation>[]} */
    const sent = [];
    /** @type {FakeRpcHandler} */
    const handler = ({ method, params }) => {
      if (method === 'query' && params.request_type === 'view_access_key_list') {
        const fc = { allowance: '1', receiver_id: GAME, method_names: ['bind'] };
        return {
          result: {
            keys: [
              { public_key: admin.publicKey, access_key: { nonce: 1, permission: 'FullAccess' } },
              {
                public_key: playKey.publicKey,
                access_key: { nonce: 2, permission: { FunctionCall: fc } },
              },
            ],
            block_height: 100,
            block_hash: ZERO_HASH,
          },
        };
      }
      if (method === 'send_tx') {
        sent.push(decodeKeyRotation(params.signed_tx_base64));
        return { result: outcome({ hash: 'x', status: { SuccessValue: '' } }) };
      }
      return chain()({ method, params });
    };
    const { near } = await adapterOver(handler);

    const twoNear = 2n * PLAY_KEY_ALLOWANCE;
    const rotated = await near.rotatePlayKey(PLAYER, adminKeyEnc, {
      keyVersion: 1,
      allowance: twoNear,
    });
    expect(rotated.keyVersion).toBe(2);
    expect(openKey(rotated.playKeyEnc, keyEncryptionKey, PLAYER)).toMatch(/^ed25519:/);
    expect(sent[0]).toMatchObject({ signerId: PLAYER, receiverId: PLAYER });
    expect(sent[0].deleted).toHaveLength(1);
    expect(sent[0].added).toMatchObject({
      allowance: twoNear,
      receiverId: GAME,
      methodNames: PLAY_KEY_METHODS,
    });
    expect(sent[0].added.publicKey).not.toBe(sent[0].deleted[0]);

    await near.rotatePlayKey(PLAYER, adminKeyEnc, { keyVersion: 2 });
    expect(sent[1].added.allowance).toBe(PLAY_KEY_ALLOWANCE);
  });

  it('accountBalance returns the account amount in yoctoNEAR', async () => {
    /** @type {FakeRpcHandler} */
    const handler = ({ method, params }) =>
      method === 'query' && params.request_type === 'view_account'
        ? {
            result: {
              amount: '2050000000000000000000000',
              locked: '0',
              code_hash: ZERO_HASH,
              storage_usage: 182,
              storage_paid_at: 0,
              block_height: 100,
              block_hash: ZERO_HASH,
            },
          }
        : undefined;
    const { near } = await adapterOver(handler);
    expect(await near.accountBalance(PLAYER)).toBe(2_050_000_000_000_000_000_000_000n);
  });
});
