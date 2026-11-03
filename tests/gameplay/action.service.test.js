/**
 * The action path (services/action.service.js, SPEC.md 8) against the mock adapter and a real
 * Postgres: idempotent replay, the per-user lease, unknown outcomes and stored panics.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { schema } from '../../lib/db/index.js';
import { CHAIN_ERRORS } from '../../lib/http/chain-errors.js';
import { ContractPanicError, RpcUnknownOutcomeError } from '../../lib/near/errors.js';
import { runPlayerAction } from '../../services/action.service.js';
import { createMockNear, dbEnabled, ev, newPlayer, testDb } from './setup.js';

const { actions, users } = schema;

describe.skipIf(!dbEnabled)('runPlayerAction', () => {
  const db = testDb();
  afterAll(async () => {
    await db?.$client?.end?.();
  });

  /** A mock chain whose `allocate_stats` emits one event; counts applied calls. */
  function chain() {
    const near = createMockNear();
    near.mock.on('allocate_stats', (args) => ({
      result: null,
      events: [ev('stats_allocated', { drone: args.drone, stats: args.stats, cost: 3 })],
    }));
    const applied = () =>
      near.mock.calls.filter((c) => c.kind === 'player' && c.method === 'allocate_stats').length;
    return { near, applied };
  }

  /**
   * @param {string} userId
   * @param {string} actionId
   * @param {any} near
   * @param {Partial<import('../../services/action.service.js').PlayerAction>} [extra]
   */
  const allocate = (userId, actionId, near, extra = {}) =>
    runPlayerAction(
      {
        userId,
        actionId,
        method: 'allocate_stats',
        args: { drone: 'd:1', stats: [2, 1, 1, 1, 1, 1, 1, 1, 1] },
        ...extra,
      },
      { db, near }
    );

  /** @param {string} id */
  const row = async (id) => (await db.select().from(actions).where(eq(actions.id, id)))[0];

  it('stores an applied action and answers a replay from the store, with one chain call', async () => {
    const { near, applied } = chain();
    const { user } = await newPlayer(db, near);
    const actionId = randomUUID();
    /** @type {unknown[]} */
    const seen = [];
    const onApplied = async (/** @type {any[]} */ events) => {
      seen.push(...events.map((e) => e.event));
      return { volts: 997 };
    };

    const first = await allocate(user.id, actionId, near, { onApplied });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ actionId, volts: 997 });
    expect(seen).toEqual(['stats_allocated']);
    expect(await row(actionId)).toMatchObject({
      status: 'applied',
      txHash: first.body.txHash,
      httpStatus: 200,
    });

    const replay = await allocate(user.id, actionId, near, { onApplied });
    expect(replay).toEqual(first);
    expect(applied()).toBe(1);
    expect(seen).toEqual(['stats_allocated']);
  });

  it('answers 409 to a second action while the first is in flight', async () => {
    const { near, applied } = chain();
    const { user } = await newPlayer(db, near);
    /** @type {() => void} */
    let release = () => {};
    const gate = new Promise((r) => {
      release = () => r(undefined);
    });
    const slow = {
      ...near,
      /** @type {typeof near.callAsPlayer} */
      callAsPlayer: async (...args) => {
        await gate;
        return near.callAsPlayer(...args);
      },
    };

    const first = allocate(user.id, randomUUID(), slow);
    await new Promise((r) => setTimeout(r, 200));
    const second = await allocate(user.id, randomUUID(), slow);
    expect(second).toEqual({
      status: 409,
      body: { error: 'Another action is still in progress.' },
    });
    release();
    expect((await first).status).toBe(200);
    expect(applied()).toBe(1);

    const [after] = await db.select().from(users).where(eq(users.id, user.id));
    expect(after.actionClaimedAt).toBeNull();
  });

  it('keeps an unknown outcome pending (202) and resolves it on the replay', async () => {
    const { near, applied } = chain();
    const { user } = await newPlayer(db, near);
    const actionId = randomUUID();

    near.mock.failNextSend('applied');
    const first = await allocate(user.id, actionId, near);
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ pending: true, actionId });
    const pending = await row(actionId);
    expect(pending).toMatchObject({ status: 'pending', seq: 1 });
    expect(pending.txHash).toBe(first.body.txHash);

    const replay = await allocate(user.id, actionId, near);
    expect(replay.status).toBe(200);
    expect(replay.body.txHash).toBe(pending.txHash);
    expect(applied()).toBe(1);
    expect(near.mock.player(String(user.nearAccountId))?.seq).toBe(1);
  });

  it('sends again on the replay when the pending transaction never landed', async () => {
    const { near, applied } = chain();
    const { user } = await newPlayer(db, near);
    const actionId = randomUUID();

    near.mock.failNextSend('lost');
    expect((await allocate(user.id, actionId, near)).status).toBe(202);
    expect(applied()).toBe(0);

    const replay = await allocate(user.id, actionId, near);
    expect(replay.status).toBe(200);
    expect(applied()).toBe(1);
    expect((await row(actionId)).status).toBe('applied');
  });

  it('stores a panic as failed with the mapped status and replays it without a chain call', async () => {
    const near = createMockNear();
    let sends = 0;
    near.mock.on('allocate_stats', () => {
      sends += 1;
      throw new ContractPanicError('locked', { method: 'allocate_stats', txHash: 'tx-locked' });
    });
    const { user } = await newPlayer(db, near);
    const actionId = randomUUID();

    const first = await allocate(user.id, actionId, near);
    expect(first).toEqual({ status: 409, body: { error: CHAIN_ERRORS.locked.error } });
    expect(await row(actionId)).toMatchObject({
      status: 'failed',
      httpStatus: 409,
      error: CHAIN_ERRORS.locked.error,
      txHash: 'tx-locked',
    });
    expect(await allocate(user.id, actionId, near)).toEqual(first);
    expect(sends).toBe(1);
  });

  it('leaves a transient panic retryable', async () => {
    const near = createMockNear();
    let tries = 0;
    near.mock.on('allocate_stats', () => {
      tries += 1;
      if (tries === 1) throw new ContractPanicError('too early', { method: 'allocate_stats' });
      return { result: null, events: [] };
    });
    const { user } = await newPlayer(db, near);
    const actionId = randomUUID();

    const first = await allocate(user.id, actionId, near, { transient: ['too early'] });
    expect(first.status).toBe(409);
    expect((await row(actionId)).status).toBe('pending');
    expect((await allocate(user.id, actionId, near)).status).toBe(200);
  });

  it('refuses a user whose bootstrap is not done, and an action id another user used', async () => {
    const { near } = chain();
    const { user } = await newPlayer(db, near);
    const other = await newPlayer(db, near);
    const actionId = randomUUID();
    expect((await allocate(user.id, actionId, near)).status).toBe(200);

    const reused = await allocate(other.user.id, actionId, near);
    expect(reused.status).toBe(409);

    await db.update(users).set({ bootstrapState: 'minted' }).where(eq(users.id, other.user.id));
    const early = await allocate(other.user.id, randomUUID(), near);
    expect(early).toEqual({
      status: 409,
      body: { error: 'Your racing account is still being set up.' },
    });
  });

  it('resends under the pinned seq, never a new one', async () => {
    const { near, applied } = chain();
    const { user, accountId } = await newPlayer(db, near);
    const actionId = randomUUID();

    near.mock.failNextSend('lost');
    expect((await allocate(user.id, actionId, near)).status).toBe(202);
    const pinned = (await row(actionId)).seq;
    expect(pinned).toBe(1);

    expect((await allocate(user.id, actionId, near)).status).toBe(200);
    const sends = near.mock.calls.filter((c) => c.kind === 'player');
    expect(sends.map((c) => c.args.seq)).toEqual([1]);
    expect(applied()).toBe(1);
    expect(near.mock.player(accountId)?.seq).toBe(1);
  });

  it('finishes from the first transaction when it lands while the resend is in flight', async () => {
    const { near, applied } = chain();
    const { user, accountId } = await newPlayer(db, near);
    const actionId = randomUUID();
    /** @type {string | null} */
    let landed = null;
    let call = 0;
    const racy = {
      ...near,
      /** @type {typeof near.callAsPlayer} */
      callAsPlayer: async (acct, key, method, args, options) => {
        call += 1;
        // First send: broadcast, outcome unknown.
        if (call === 1) throw new RpcUnknownOutcomeError({ txHash: 'H1', accountId: acct, seq: 1 });
        // The replay's resend: H1 lands first, so the resend (same seq) is rejected.
        landed = (await near.callAsPlayer(acct, key, method, args, options)).txHash;
        return near.callAsPlayer(acct, key, method, args, options);
      },
      /** @type {typeof near.resolveOutcome} */
      resolveOutcome: (acct, seq, hash, opts) =>
        near.resolveOutcome(acct, seq, hash === 'H1' && landed ? landed : hash, opts),
    };

    expect((await allocate(user.id, actionId, racy)).status).toBe(202);
    const replay = await allocate(user.id, actionId, racy);
    expect(replay.status).toBe(200);
    expect(replay.body.txHash).toBe(landed);
    expect(applied()).toBe(1);
    expect(near.mock.player(accountId)?.seq).toBe(1);
    expect(await allocate(user.id, actionId, racy)).toEqual(replay);
  });

  it('never sends under a new seq once its seq was used by another action', async () => {
    const { near, applied } = chain();
    const { user, accountId } = await newPlayer(db, near);
    const actionId = randomUUID();

    near.mock.failNextSend('lost');
    expect((await allocate(user.id, actionId, near)).status).toBe(202);
    near.mock.applyPlayerCall(accountId, 'equip', { seq: 1 });

    const replay = await allocate(user.id, actionId, near);
    expect(replay.status).toBe(409);
    expect(String(replay.body.error)).toMatch(/could not be confirmed/);
    expect(applied()).toBe(0);
    expect((await row(actionId)).status).toBe('failed');
  });

  it('keeps the hashes and answers 202 when the chain cannot be read', async () => {
    const { near, applied } = chain();
    const { user } = await newPlayer(db, near);
    const actionId = randomUUID();

    near.mock.failNextSend('applied');
    const first = await allocate(user.id, actionId, near);
    const down = {
      ...near,
      nextSeq: async () => {
        throw new Error('rpc timeout');
      },
    };
    const replay = await allocate(user.id, actionId, down);
    expect(replay).toEqual({
      status: 202,
      body: { pending: true, actionId, txHash: first.body.txHash },
    });
    expect((await row(actionId)).txHashes).toEqual([first.body.txHash]);

    expect((await allocate(user.id, actionId, near)).status).toBe(200);
    expect(applied()).toBe(1);
  });

  it('refuses a replayed action id with different args', async () => {
    const { near } = chain();
    const { user } = await newPlayer(db, near);
    const actionId = randomUUID();
    expect((await allocate(user.id, actionId, near)).status).toBe(200);
    const changed = await runPlayerAction(
      {
        userId: user.id,
        actionId,
        method: 'allocate_stats',
        args: { drone: 'd:2', stats: [2, 1, 1, 1, 1, 1, 1, 1, 1] },
      },
      { db, near }
    );
    expect(changed.status).toBe(409);
  });
});
