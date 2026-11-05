/**
 * The scheduler's failure paths (services/batch.service.js, settle.service.js; SPEC.md 6) against
 * the mock adapter's chain and a real Postgres: chunked retries from the chain's `settled_count`,
 * a settle with an unknown outcome, `exists` on commit, state drift, the abort after three
 * failures, and the abort of a failed batch whose commit landed late.
 */
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { schema } from '../../lib/db/index.js';
import { ContractPanicError, RpcUnknownOutcomeError } from '../../lib/near/errors.js';
import { verifyRace } from '../../services/race-schedule.service.js';
import { slotStartMs } from '../../services/scheduler-deps.js';
import { runTick } from '../../services/scheduler.service.js';
import { dbEnabled, testDb } from '../gameplay/setup.js';
import { schedulerHarness } from './setup.js';

const { batches, users } = schema;

describe.skipIf(!dbEnabled)('scheduler recovery', () => {
  const db = testDb();
  afterAll(async () => {
    await db?.$client?.end?.();
  });
  const { world, racer, batchRow, raceRows, droneRow, settlementCalls, wrapped } =
    schedulerHarness(db);

  // 82 players and 41 races: slow next to the other suites, so it gets its own timeout.
  it(
    'a retry after the chain settled a chunk starts from settled_count and sends only the rest',
    { timeout: 30_000 },
    async () => {
      const { near, slot, deps } = await world();
      for (let i = 0; i < 82; i++) await racer(near, { elo: 1000 + i });
      let settles = 0;
      const flaky = wrapped(near, async (method, args, forward) => {
        if (method === 'settle_batch' && ++settles === 2) {
          throw new RpcUnknownOutcomeError({ txHash: 'lost' });
        }
        return forward();
      });
      // Ticks after the first only settle, so the drones chunk 1 unlocks are not committed again.
      const run = (/** @type {number} */ offset, /** @type {any} */ chain) =>
        runTick(
          { now: slotStartMs(slot + offset) + 1_000, commit: offset === 0 },
          { ...deps, near: chain }
        );

      expect((await run(0, flaky)).commit).toMatchObject({ races: 41 });
      expect((await run(1, flaky)).settle).toMatchObject({ [slot]: 'retry' });
      expect((await batchRow(slot)).attempts).toBe(0);
      expect(near.mock.chain.batches.get(slot)?.settled_count).toBe(40);
      const rowsAfterFirst = await raceRows(slot);
      expect(rowsAfterFirst.filter((r) => r.status === 'completed')).toHaveLength(40);

      expect((await run(2, flaky)).settle).toMatchObject({ [slot]: 'settled' });
      const sent = settlementCalls(near, 'settle_batch').map((c) => [
        c.args.from,
        /** @type {unknown[]} */ (c.args.results).length,
      ]);
      expect(sent).toEqual([
        [0, 40],
        [40, 1],
      ]);
      expect((await batchRow(slot)).status).toBe('settled');
      expect((await raceRows(slot)).every((r) => r.status === 'completed' && r.seed)).toBe(true);
    }
  );

  it('finishes a batch the chain settled while the outcome was unknown, without settling it twice', async () => {
    const { near, slot, tick } = await world();
    const a = await racer(near, { stats: [40, 40, 40, 40, 40, 40, 40, 40, 40], elo: 1100 });
    await racer(near, { stats: [20, 20, 20, 20, 20, 20, 20, 20, 20] });
    await tick();
    // The settle lands on chain, but the send reports an unknown outcome (a timeout).
    near.mock.failNextSend('applied');
    expect((await tick(1, { commit: false })).settle).toMatchObject({ [slot]: 'retry' });
    expect(await batchRow(slot)).toMatchObject({ status: 'committed', attempts: 0 });
    expect((await raceRows(slot))[0].status).toBe('pending');

    expect((await tick(2, { commit: false })).settle).toMatchObject({ [slot]: 'settled' });
    expect(settlementCalls(near, 'settle_batch')).toHaveLength(1);
    const after = await batchRow(slot);
    expect(after.status).toBe('settled');
    const [race] = await raceRows(slot);
    expect(race).toMatchObject({ status: 'completed', seed: after.seed, settleTx: null });
    expect(race.winnerDroneId).toBe(a.drone.id);
    expect(await droneRow(a.drone.id)).toMatchObject({
      wins: 1,
      totalRaces: 1,
      xp: 10,
      inBatch: null,
    });
    const [owner] = await db.select().from(users).where(eq(users.id, a.user.id));
    expect(owner).toMatchObject({
      totalRaces: 1,
      totalWins: 1,
      points: near.mock.chain.balances.get(a.accountId),
    });
    expect((await verifyRace(race.id, { db })).body).toMatchObject({ match: true });
  });

  it('treats `exists` on commit as a landed commit', async () => {
    const { near, slot, deps } = await world();
    const a = await racer(near);
    await racer(near);
    const retried = wrapped(near, async (method, args, forward) => {
      const res = await forward();
      if (method === 'commit_batch') throw new ContractPanicError('exists', { method });
      return res;
    });
    const first = await runTick({ now: slotStartMs(slot) + 1_000 }, { ...deps, near: retried });
    expect(first.commit).toEqual({ slot, races: 1, txHash: null });
    expect(await batchRow(slot)).toMatchObject({ status: 'committed', commitTx: null });
    expect((await droneRow(a.drone.id)).inBatch).toBe(slot);

    const second = await runTick(
      { now: slotStartMs(slot + 1) + 1_000 },
      { ...deps, near: retried }
    );
    expect(second.settle).toMatchObject({ [slot]: 'settled' });
    expect((await raceRows(slot))[0].status).toBe('completed');
  });

  it('re-reads and recomputes after state drift, and settles on the next tick', async () => {
    const { near, slot, deps } = await world();
    const a = await racer(near, { stats: [10, 10, 10, 10, 10, 10, 10, 10, 10], elo: 1100 });
    await racer(near);
    let drifted = false;
    const drifting = wrapped(near, async (method, args, forward) => {
      if (method === 'settle_batch' && !drifted) {
        drifted = true;
        const d = near.mock.chain.drones.get(a.token);
        if (d) d.cold.stats[0] = 11;
      }
      return forward();
    });
    const run = (/** @type {number} */ offset) =>
      runTick({ now: slotStartMs(slot + offset) + 1_000 }, { ...deps, near: drifting });

    await run(0);
    expect((await run(1)).settle).toMatchObject({ [slot]: 'retry' });
    expect(await batchRow(slot)).toMatchObject({ status: 'committed', attempts: 1 });
    expect((await raceRows(slot))[0].status).toBe('pending');

    expect((await run(2)).settle).toMatchObject({ [slot]: 'settled' });
    const [race] = await raceRows(slot);
    expect(race.status).toBe('completed');
    expect(race.snapshotA.stats[0]).toBe(11);
    expect(settlementCalls(near, 'settle_batch')).toHaveLength(2);
  });

  it('aborts the batch after three failed settle attempts and unlocks the drones', async () => {
    const { near, slot, deps } = await world();
    const a = await racer(near);
    const b = await racer(near);
    let bump = 0;
    const broken = wrapped(near, async (method, args, forward) => {
      if (method === 'settle_batch') {
        const d = near.mock.chain.drones.get(a.token);
        if (d) d.cold.stats[1] = 2 + ++bump;
      }
      return forward();
    });
    // Ticks after the first only settle, so the abort's unlock is what the assertions see.
    const run = (/** @type {number} */ offset) =>
      runTick(
        { now: slotStartMs(slot + offset) + 1_000, commit: offset === 0 },
        { ...deps, near: broken }
      );

    await run(0);
    expect((await run(1)).settle).toMatchObject({ [slot]: 'retry' });
    expect((await run(2)).settle).toMatchObject({ [slot]: 'retry' });
    expect((await batchRow(slot)).attempts).toBe(2);
    expect((await run(3)).settle).toMatchObject({ [slot]: 'failed' });

    const [abort] = settlementCalls(near, 'abort_batch');
    expect(await batchRow(slot)).toMatchObject({
      status: 'failed',
      attempts: 3,
      settleTxs: [abort.txHash],
    });
    expect((await raceRows(slot))[0].status).toBe('failed');
    expect(settlementCalls(near, 'abort_batch')).toHaveLength(1);
    expect(near.mock.chain.batches.get(slot)).toMatchObject({ aborted: true, matchups: [] });
    for (const r of [a, b]) {
      expect(near.mock.chain.drones.get(r.token)?.hot.in_batch).toBeNull();
      expect((await droneRow(r.drone.id)).inBatch).toBeNull();
      expect(near.mock.chain.balances.get(r.accountId)).toBeUndefined();
    }
    const [ownerA] = await db.select().from(users).where(eq(users.id, a.user.id));
    expect(ownerA).toMatchObject({ points: 0, totalRaces: 0 });
  });

  it('aborts a failed batch whose commit landed late, and its drones unlock', async () => {
    const { near, slot, deps } = await world();
    const a = await racer(near);
    const b = await racer(near);
    /** @type {(() => Promise<any>) | null} */
    let land = null;
    const slow = wrapped(near, async (method, args, forward) => {
      if (method !== 'commit_batch') return forward();
      land = forward;
      throw new RpcUnknownOutcomeError({ txHash: 'slow' });
    });
    const run = (/** @type {number} */ offset) =>
      runTick(
        { now: slotStartMs(slot + offset) + 1_000, commit: offset === 0 },
        { ...deps, near: slow }
      );

    await run(0);
    // A full cadence later the batch is still not on chain, so the database fails it.
    const old = new Date(Date.now() - 181_000);
    await db.update(batches).set({ committedAt: old }).where(eq(batches.slot, slot));
    expect((await run(1)).settle).toMatchObject({ [slot]: 'failed' });
    expect((await droneRow(a.drone.id)).inBatch).toBeNull();

    // The commit lands after all: the drones are locked under a batch nobody will settle.
    await /** @type {() => Promise<any>} */ (/** @type {unknown} */ (land))();
    expect(near.mock.chain.drones.get(a.token)?.hot.in_batch).toBe(slot);

    expect((await run(2)).settle).toMatchObject({ [slot]: 'aborted' });
    const [abort] = settlementCalls(near, 'abort_batch');
    expect(await batchRow(slot)).toMatchObject({ status: 'failed', settleTxs: [abort.txHash] });
    expect(near.mock.chain.batches.get(slot)).toMatchObject({ aborted: true });
    for (const r of [a, b]) {
      expect(near.mock.chain.drones.get(r.token)?.hot.in_batch).toBeNull();
      expect((await droneRow(r.drone.id)).inBatch).toBeNull();
    }
    expect((await run(3)).settle).not.toHaveProperty(String(slot));
    expect(settlementCalls(near, 'abort_batch')).toHaveLength(1);
  });
});
