/**
 * The wallet services against the mock adapter and a real Postgres (SPEC.md 8, 13): the challenge
 * is single use and bound to its user, a link is idempotent after an unknown outcome, a withdrawal
 * replays by action id and is never sent twice after an unknown outcome, and sync follows the
 * chain.
 */
import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
// eslint-disable-next-line no-restricted-imports -- test signs NEP-413 with a real ed25519 key
import { KeyPair } from 'near-api-js';
import { afterAll, describe, expect, it } from 'vitest';
import { schema } from '../../lib/db/index.js';
import { NonceError } from '../../lib/near/errors.js';
import { createChallenge, linkWallet, withdrawToWallet } from '../../services/wallet.service.js';
import { syncWallet } from '../../services/wallet-sync.js';
import { createMockNear, dbEnabled, newDrone, newPlayer, testDb } from '../gameplay/setup.js';

const { actions, drones, users, walletChallenges } = schema;
const HOST = 'app.test';
const WALLET = 'alice.testnet';

/** @param {string} s */
const borshString = (s) => {
  const bytes = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
};

/**
 * A NEP-413 signature over `challenge`.
 * @param {any} keyPair
 * @param {{ nonce: string, message: string, recipient: string }} challenge
 */
function signChallenge(keyPair, { nonce, message, recipient }) {
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(2147484061);
  const digest = createHash('sha256')
    .update(
      Buffer.concat([
        prefix,
        borshString(message),
        Buffer.from(nonce, 'hex'),
        borshString(recipient),
        Buffer.from([0]),
      ])
    )
    .digest();
  return Buffer.from(keyPair.sign(digest).signature).toString('base64');
}

describe.skipIf(!dbEnabled)('wallet services', () => {
  const db = testDb();
  afterAll(async () => {
    await db?.$client?.end?.();
  });

  async function player() {
    const near = createMockNear();
    const { user, accountId } = await newPlayer(db, near);
    const keyPair = KeyPair.fromRandom('ed25519');
    const publicKey = keyPair.getPublicKey().toString();
    near.mock.setAccessKey(WALLET, publicKey, 'FullAccess');
    return { near, user, accountId, keyPair, publicKey };
  }

  /** @param {Awaited<ReturnType<typeof player>>} p */
  async function challengeFor(p) {
    const { status, body } = await createChallenge(
      { userId: p.user.id, host: HOST },
      { db, near: p.near }
    );
    expect(status).toBe(200);
    return /** @type {{ nonce: string, message: string, recipient: string }} */ (body);
  }

  it('a challenge links the wallet that signed it, once', async () => {
    const p = await player();
    const c = await challengeFor(p);
    expect(c.message).toContain(p.accountId);
    expect(c.recipient).toBe(HOST);
    const body = {
      accountId: WALLET,
      publicKey: p.publicKey,
      signature: signChallenge(p.keyPair, c),
      nonce: c.nonce,
    };

    const first = await linkWallet({ userId: p.user.id, body }, { db, near: p.near });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ linked: true, wallet: WALLET });
    expect(p.near.mock.chain.walletLinks.get(p.accountId)).toBe(WALLET);

    // Same request again: already linked to this wallet, no second send.
    const sends = p.near.mock.calls.filter((x) => x.method === 'link_wallet').length;
    const again = await linkWallet({ userId: p.user.id, body }, { db, near: p.near });
    expect(again.status).toBe(200);
    expect(p.near.mock.calls.filter((x) => x.method === 'link_wallet').length).toBe(sends);

    // Bound to its user: another user cannot use the signed challenge.
    const other = await player();
    const stolen = await linkWallet({ userId: other.user.id, body }, { db, near: p.near });
    expect(stolen.status).toBe(404);
  });

  it('refuses a bad signature and an expired challenge', async () => {
    const p = await player();
    const c = await challengeFor(p);
    const signature = signChallenge(KeyPair.fromRandom('ed25519'), c);
    const bad = await linkWallet(
      {
        userId: p.user.id,
        body: { accountId: WALLET, publicKey: p.publicKey, signature, nonce: c.nonce },
      },
      { db, near: p.near }
    );
    expect(bad.status).toBe(403);

    const old = await challengeFor(p);
    await db
      .update(walletChallenges)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(walletChallenges.nonce, old.nonce));
    const expired = await linkWallet(
      {
        userId: p.user.id,
        body: {
          accountId: WALLET,
          publicKey: p.publicKey,
          signature: signChallenge(p.keyPair, old),
          nonce: old.nonce,
        },
      },
      { db, near: p.near }
    );
    expect(expired.status).toBe(410);
  });

  it('past its expiry a claimed challenge only confirms a link already on chain', async () => {
    const p = await player();
    const c = await challengeFor(p);
    const body = {
      accountId: WALLET,
      publicKey: p.publicKey,
      signature: signChallenge(p.keyPair, c),
      nonce: c.nonce,
    };
    p.near.mock.failNextSend('lost');
    expect((await linkWallet({ userId: p.user.id, body }, { db, near: p.near })).status).toBe(202);
    await db
      .update(walletChallenges)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(walletChallenges.nonce, c.nonce));
    expect((await linkWallet({ userId: p.user.id, body }, { db, near: p.near })).status).toBe(410);
    p.near.mock.chain.walletLinks.set(p.accountId, WALLET);
    expect((await linkWallet({ userId: p.user.id, body }, { db, near: p.near })).status).toBe(200);
  });

  it('after an unknown outcome the same request reads the link and answers 200', async () => {
    const p = await player();
    const c = await challengeFor(p);
    const body = {
      accountId: WALLET,
      publicKey: p.publicKey,
      signature: signChallenge(p.keyPair, c),
      nonce: c.nonce,
    };

    p.near.mock.failNextSend('applied');
    const first = await linkWallet({ userId: p.user.id, body }, { db, near: p.near });
    expect(first.status).toBe(202);
    const sends = p.near.mock.calls.filter((x) => x.method === 'link_wallet').length;

    const again = await linkWallet({ userId: p.user.id, body }, { db, near: p.near });
    expect(again.status).toBe(200);
    expect(p.near.mock.calls.filter((x) => x.method === 'link_wallet').length).toBe(sends);
  });

  /** A player with a linked wallet, a drone and 20 Volts. */
  async function linkedPlayer() {
    const p = await player();
    p.near.mock.chain.walletLinks.set(p.accountId, WALLET);
    p.near.mock.chain.balances.set(p.accountId, 20);
    const drone = await newDrone(db, p.user.id);
    const token = String(drone.tokenId);
    p.near.mock.chain.addDrone(token, { owner: p.accountId });
    return { ...p, drone, token };
  }

  it('withdraw moves the assets, updates the cache and replays by action id', async () => {
    const p = await linkedPlayer();
    const actionId = randomUUID();
    const input = { userId: p.user.id, actionId, tokens: [p.token], volts: 5 };

    const first = await withdrawToWallet(input, { db, near: p.near });
    expect(first.status).toBe(200);
    expect(p.near.mock.chain.drones.get(p.token)?.owner).toBe(WALLET);
    expect(p.near.mock.chain.balances.get(WALLET)).toBe(5);
    expect(first.body.volts).toBe(15);
    const [row] = await db.select().from(drones).where(eq(drones.id, p.drone.id));
    expect(row).toMatchObject({ userId: null, active: false });

    const sends = p.near.mock.calls.filter((x) => x.method === 'withdraw').length;
    const replay = await withdrawToWallet(input, { db, near: p.near });
    expect(replay.status).toBe(200);
    expect(replay.body.txHash).toBe(first.body.txHash);
    expect(p.near.mock.calls.filter((x) => x.method === 'withdraw').length).toBe(sends);
  });

  it('an unknown outcome is resolved by hash and never sent twice', async () => {
    const p = await linkedPlayer();
    const actionId = randomUUID();
    const input = { userId: p.user.id, actionId, tokens: [p.token], volts: 0 };

    p.near.mock.failNextSend('applied');
    const first = await withdrawToWallet(input, { db, near: p.near });
    expect(first.status).toBe(202);
    const sends = p.near.mock.calls.filter((x) => x.method === 'withdraw').length;

    const resolved = await withdrawToWallet(input, { db, near: p.near });
    expect(resolved.status).toBe(200);
    expect(p.near.mock.calls.filter((x) => x.method === 'withdraw').length).toBe(sends);
    expect(p.near.mock.chain.drones.get(p.token)?.owner).toBe(WALLET);
  });

  it('a lost transaction stays pending under its hash and is not sent again', async () => {
    const p = await linkedPlayer();
    const actionId = randomUUID();
    const input = { userId: p.user.id, actionId, tokens: [p.token], volts: 0 };
    p.near.mock.failNextSend('lost');
    expect((await withdrawToWallet(input, { db, near: p.near })).status).toBe(202);
    const sends = p.near.mock.calls.filter((x) => x.method === 'withdraw').length;

    const again = await withdrawToWallet(input, { db, near: p.near });
    expect(again.status).toBe(202);
    expect(p.near.mock.calls.filter((x) => x.method === 'withdraw').length).toBe(sends);
    expect(p.near.mock.chain.drones.get(p.token)?.owner).toBe(p.accountId);
  });

  it('InvalidNonce keeps the hash: applied if a lookup finds it, failed after 60 s if not', async () => {
    const p = await linkedPlayer();
    let sends = 0;
    /** @type {typeof p.near} */
    const near = {
      ...p.near,
      callAsOps: async (_method, _args, options) => {
        sends += 1;
        await options?.onSigned?.('h1');
        throw new NonceError({ accountId: p.near.ownerId });
      },
    };
    const actionId = randomUUID();
    const input = { userId: p.user.id, actionId, tokens: [p.token], volts: 0 };
    expect((await withdrawToWallet(input, { db, near })).status).toBe(202);
    expect((await withdrawToWallet(input, { db, near })).status).toBe(202);
    expect(sends).toBe(1);

    await db
      .update(actions)
      .set({ createdAt: new Date(Date.now() - 2 * 60 * 1000) })
      .where(eq(actions.id, actionId));
    const failed = await withdrawToWallet(input, { db, near });
    expect(failed.status).toBe(409);
    expect(sends).toBe(1);
  });

  it('a refused withdrawal stores the mapped panic', async () => {
    const p = await linkedPlayer();
    const actionId = randomUUID();
    const input = { userId: p.user.id, actionId, tokens: [], volts: 999 };
    const refused = await withdrawToWallet(input, { db, near: p.near });
    expect(refused).toMatchObject({ status: 402, body: { error: 'Not enough Volts.' } });
    const replay = await withdrawToWallet(input, { db, near: p.near });
    expect(replay).toMatchObject({ status: 402, body: { error: 'Not enough Volts.' } });
  });

  it('sync returns a token from a wallet to the player and re-reads Volts', async () => {
    const p = await linkedPlayer();
    await withdrawToWallet(
      { userId: p.user.id, actionId: randomUUID(), tokens: [p.token], volts: 0 },
      { db, near: p.near }
    );
    // The wallet sends it back: on chain only, as a wallet would.
    const chainDrone = /** @type {NonNullable<ReturnType<typeof p.near.mock.chain.drones.get>>} */ (
      p.near.mock.chain.drones.get(p.token)
    );
    chainDrone.owner = p.accountId;
    p.near.mock.chain.balances.set(p.accountId, 77);

    const synced = await syncWallet({ userId: p.user.id }, { db, near: p.near });
    expect(synced).toMatchObject({ status: 200, body: { volts: 77, tokens: 1 } });
    const [row] = await db.select().from(drones).where(eq(drones.id, p.drone.id));
    expect(row).toMatchObject({ userId: p.user.id });
    const [user] = await db.select().from(users).where(eq(users.id, p.user.id));
    expect(user.points).toBe(77);
  });
});
