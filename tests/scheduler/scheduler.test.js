/**
 * The scheduler (services/scheduler.service.js, batch.service.js, settle.service.js; SPEC.md 3,
 * 4.4, 6; ENGINEERING.md 3 and 5) against the mock adapter's chain and a real Postgres: the slot
 * guard, commit then settle, chunked retries from the chain's `settled_count`, `exists` on commit,
 * state drift, the abort after three failures, and the server-side replay.
 */
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { schema } from '../../lib/db/index.js';
import { ContractPanicError, RpcUnknownOutcomeError } from '../../lib/near/errors.js';
import { verifyRace } from '../../services/race-schedule.service.js';
import { slotStartMs } from '../../services/scheduler-deps.js';
import { runTick } from '../../services/scheduler.service.js';
import {
  TEST_SECRET_KEY,
  createMockNear,
  dbEnabled,
  newDrone,
  newPlayer,
  testDb,
} from '../gameplay/setup.js';
import { seedTracks } from './setup.js';

const { batches, drones, races, users } = schema;

describe.skipIf(!dbEnabled)('scheduler ticks', () => {
  const db = testDb();
  afterAll(async () => {
    await db?.$client?.end?.();
  });

  /** A fresh mock chain, a slot nobody else ticks, and the deps every tick takes. */
  async function world() {
    await seedTracks(db);
    const near = createMockNear();
    const slot = 60_000_000 + randomInt(1_000_000_000);
    const deps = { db, near, secretKey: TEST_SECRET_KEY };
    /** @param {number} offset slots after `slot` */
    const tick = (offset = 0, extra = {}) =>
      runTick({ now: slotStartMs(slot + offset) + 1_000, ...extra }, deps);
    return { near, slot, deps, tick };
  }

  /**
   * An active player drone that exists on the mock chain.
   * @param {ReturnType<typeof createMockNear>} near
   * @param {{ stats?: number[], elo?: number }} [opts]
   */
  async function racer(near, opts = {}) {
    const { user, accountId } = await newPlayer(db, near);
    const drone = await newDrone(db, user.id);
    const stats = opts.stats ?? [5, 5, 5, 5, 5, 5, 5, 5, 5];
    await db
      .update(drones)
      .set({ active: true, eloRating: opts.elo ?? 1000 })
      .where(eq(drones.id, drone.id));
    near.mock.chain.addDrone(String(drone.tokenId), {
      owner: accountId,
      stats,
      elo: opts.elo ?? 1000,
    });
    return { user, accountId, drone, token: String(drone.tokenId) };
  }

  /** @param {number} slot */
  const batchRow = async (slot) =>
    (await db.select().from(batches).where(eq(batches.slot, slot)))[0];
  /** @param {number} slot @returns {Promise<any[]>} */
  const raceRows = (slot) =>
    db.select().from(races).where(eq(races.batchSlot, slot)).orderBy(races.raceIndex);
  /** @param {string} id */
  const droneRow = async (id) => (await db.select().from(drones).where(eq(drones.id, id)))[0];
  /** @param {ReturnType<typeof createMockNear>} near @param {string} method */
  const settlementCalls = (near, method) =>
    near.mock.calls.filter((c) => c.kind === 'settlement' && c.method === method);

  /**
   * The mock adapter with `callAsSettlement` wrapped.
   * @param {ReturnType<typeof createMockNear>} near
   * @param {(method: string, args: any, forward: () => Promise<any>) => Promise<any>} wrap
   */
  const wrapped = (near, wrap) => ({
    ...near,
    /** @type {typeof near.callAsSettlement} */
    callAsSettlement: (method, args = {}, options) =>
      wrap(method, args, () => near.callAsSettlement(method, args, options)),
  });

  it('a second tick in the same slot exits without acting', async () => {
    const { near, slot, tick } = await world();
    await racer(near);
    await racer(near);
    const first = await tick();
    expect(first).toMatchObject({ slot, claimed: true, commit: { races: 1 } });
    const calls = near.mock.calls.length;
    expect(await tick()).toEqual({ slot, claimed: false });
    expect(near.mock.calls.length).toBe(calls);
    expect(await raceRows(slot)).toHaveLength(1);
  });

  it('commits a batch, then settles it on the next tick with the caches updated and the seed stored plain', async () => {
    const { near, slot, tick } = await world();
    const a = await racer(near, { stats: [40, 40, 40, 40, 40, 40, 40, 40, 40], elo: 1100 });
    const b = await racer(near, { stats: [20, 20, 20, 20, 20, 20, 20, 20, 20], elo: 1000 });

    const committed = await tick();
    expect(committed.commit).toMatchObject({ slot, races: 1, txHash: expect.any(String) });
    const [commitCall] = settlementCalls(near, 'commit_batch');
    const row = await batchRow(slot);
    expect(row).toMatchObject({ status: 'committed', commitTx: commitCall.txHash, attempts: 0 });
    expect(row.seed).toBeNull();
    expect(row.seedEnc).toEqual(expect.any(String));
    const [race] = await raceRows(slot);
    expect(race).toMatchObject({
      status: 'pending',
      raceIndex: 0,
      drone1EloBefore: 1100,
      drone2EloBefore: 1000,
    });
    expect(race.drone1Id).toBe(a.drone.id);
    expect((await droneRow(a.drone.id)).inBatch).toBe(slot);
    expect(near.mock.chain.drones.get(a.token)?.hot.in_batch).toBe(slot);
    expect(settlementCalls(near, 'commit_batch')[0].args).toMatchObject({
      batch_id: slot,
      matchups: [{ a: a.token, b: b.token }],
    });

    // The same tick settles slot S and commits S + 1 with the drones the settle unlocked.
    const settled = await tick(1);
    expect(settled.settle).toMatchObject({ [slot]: 'settled' });
    expect(settled.commit).toMatchObject({ slot: slot + 1, races: 1 });
    const after = await batchRow(slot);
    expect(after).toMatchObject({
      status: 'settled',
      seedEnc: null,
      settleTxs: [expect.any(String)],
    });
    expect(after.seed).toMatch(/^[0-9a-f]{64}$/);
    expect(createHash('sha256').update(Buffer.from(after.seed, 'hex')).digest('hex')).toBe(
      after.seedHash
    );
    const [done] = await raceRows(slot);
    expect(done).toMatchObject({
      status: 'completed',
      seed: after.seed,
      settleTx: after.settleTxs[0],
    });
    expect(done.winnerDroneId).toBe(a.drone.id);
    expect(done.snapshotA).toEqual({
      stats: [40, 40, 40, 40, 40, 40, 40, 40, 40],
      modTemplate: 0,
      skinTemplate: 0,
      level: 1,
      elo: 1100,
    });
    expect(Number(done.drone1Time)).toBeLessThan(Number(done.drone2Time));
    expect(done.log.length).toBeGreaterThan(0);

    const winner = await droneRow(a.drone.id);
    const loser = await droneRow(b.drone.id);
    const chainA = near.mock.chain.drones.get(a.token)?.hot;
    expect(winner).toMatchObject({
      wins: 1,
      losses: 0,
      totalRaces: 1,
      xp: 10,
      eloRating: chainA?.elo,
      inBatch: slot + 1,
    });
    expect(winner.eloRating).toBeGreaterThan(1100);
    expect(loser).toMatchObject({ wins: 0, losses: 1, totalRaces: 1, xp: 4, inBatch: slot + 1 });
    expect(loser.eloRating).toBeLessThan(1000);
    const [ownerA] = await db.select().from(users).where(eq(users.id, a.user.id));
    const [ownerB] = await db.select().from(users).where(eq(users.id, b.user.id));
    expect(ownerA).toMatchObject({
      totalRaces: 1,
      totalWins: 1,
      points: near.mock.chain.balances.get(a.accountId),
    });
    expect(ownerA.points).toBeGreaterThanOrEqual(3);
    expect(ownerB).toMatchObject({ totalRaces: 1, totalWins: 0, points: 1 });
    expect(await verifyRace(done.id, { db })).toEqual({
      status: 200,
      body: { match: true, raceId: done.id },
    });
  });

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

    expect(await batchRow(slot)).toMatchObject({ status: 'failed', attempts: 3 });
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

  it('verify replays a settled race: true as stored, false once a snapshot is altered', async () => {
    const { near, slot, tick } = await world();
    await racer(near, { stats: [30, 30, 30, 30, 30, 30, 30, 30, 30] });
    await racer(near);
    await tick();
    await tick(1);
    const [race] = await raceRows(slot);
    expect(race.status).toBe('completed');
    expect(await verifyRace(race.id, { db })).toEqual({
      status: 200,
      body: { match: true, raceId: race.id },
    });

    const altered = { ...race.snapshotA, stats: [...race.snapshotA.stats] };
    altered.stats[0] = 1;
    await db.update(races).set({ snapshotA: altered }).where(eq(races.id, race.id));
    expect(await verifyRace(race.id, { db })).toEqual({
      status: 200,
      body: { match: false, raceId: race.id },
    });
    expect((await verifyRace(randomUUID(), { db })).status).toBe(404);
  });

  it('settles due batches but commits nothing while racing is paused', async () => {
    const { near, slot, tick } = await world();
    const a = await racer(near);
    await racer(near);
    await tick();
    expect((await droneRow(a.drone.id)).inBatch).toBe(slot);
    const paused = await tick(1, { commit: false });
    expect((await droneRow(a.drone.id)).inBatch).toBeNull();
    expect(near.mock.chain.drones.get(a.token)?.hot.in_batch).toBeNull();
    expect(paused).toMatchObject({ settle: { [slot]: 'settled' }, commit: { skipped: 'paused' } });
    expect(await batchRow(slot + 1)).toBeUndefined();
    const ids = (await raceRows(slot)).map((r) => r.id);
    expect(ids).toHaveLength(1);
    expect((await db.select().from(races).where(inArray(races.id, ids)))[0].status).toBe(
      'completed'
    );
  });
});
