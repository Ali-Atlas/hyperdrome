/**
 * The scheduler (services/scheduler.service.js, batch.service.js, settle.service.js; SPEC.md 3,
 * 4.4, 6; ENGINEERING.md 3 and 5) against the mock adapter's chain and a real Postgres: the slot
 * guard, commit then settle, the paused tick and the server-side replay. The failure paths are in
 * recovery.test.js.
 */
import { createHash, randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { schema } from '../../lib/db/index.js';
import { verifyRace } from '../../services/race-schedule.service.js';
import { dbEnabled, testDb } from '../gameplay/setup.js';
import { schedulerHarness } from './setup.js';

const { races, users } = schema;

describe.skipIf(!dbEnabled)('scheduler ticks', () => {
  const db = testDb();
  afterAll(async () => {
    await db?.$client?.end?.();
  });
  const { world, racer, batchRow, raceRows, droneRow, settlementCalls } = schedulerHarness(db);

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
