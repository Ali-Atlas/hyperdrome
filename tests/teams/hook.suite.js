/**
 * The team phase inside a scheduler tick (services/scheduler.service.js `runTick`): it runs after
 * the commit with the slot, the committed matchups and the deadline, and never fails the tick.
 * Run from tests/teams/teams.test.js.
 */
import { eq } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../../lib/db/index.js';
import { slotStartMs } from '../../services/scheduler-deps.js';
import { TEAM_PHASE_BUDGET_MS, runTick } from '../../services/scheduler.service.js';
import { runTeamPhase } from '../../services/teams.service.js';
import { TEST_SECRET_KEY, dbEnabled, testDb } from '../gameplay/setup.js';
import { seedTracks } from '../scheduler/setup.js';
import { createTeamChain } from './fake-chain.js';
import { seedTestTeam, testTeam, wipeTeams } from './setup.js';

const { batches, races, drones, cronTicks } = schema;

describe.skipIf(!dbEnabled)('team phase in the scheduler tick', () => {
  const db = testDb();
  beforeEach(() => wipeTeams(db));
  afterAll(() => wipeTeams(db));

  /**
   * A chain that accepts `commit_batch`, and a slot below every slot the scheduler suites use, so
   * this tick's settle phase never sees their batches.
   */
  async function world() {
    await seedTracks(db);
    const chain = createTeamChain();
    chain.near.mock.on('commit_batch', () => ({}));
    const slot = 1_000_000 + randomInt(8_000_000);
    /** Remove what the tick wrote, so no other suite's tick finds a batch to settle. */
    const cleanup = async () => {
      await db.update(drones).set({ inBatch: null }).where(eq(drones.inBatch, slot));
      await db.delete(races).where(eq(races.batchSlot, slot));
      await db.delete(batches).where(eq(batches.slot, slot));
      await db.delete(cronTicks).where(eq(cronTicks.slot, slot));
    };
    return { chain, slot, cleanup, deps: { db, near: chain.near, secretKey: TEST_SECRET_KEY } };
  }

  it('runs after the commit with the slot, the committed matchups and tick start + 40 s', async () => {
    const { chain, slot, cleanup, deps } = await world();
    const a = await seedTestTeam(db, chain, testTeam());
    const b = await seedTestTeam(db, chain, testTeam());
    const tokens = [...a.drones, ...b.drones].map((d) => d.tokenId).sort();
    const seeded = chain.near.mock.calls.length;
    /** @type {Parameters<typeof runTeamPhase>[0][]} */
    const inputs = [];
    /** @type {typeof runTeamPhase} */
    const teamPhase = (input, d) => {
      inputs.push(input);
      return runTeamPhase(input, d);
    };

    const before = Date.now();
    const tick = await runTick({ now: slotStartMs(slot) + 1_000 }, { ...deps, teamPhase });
    const after = Date.now();
    await cleanup();

    // Teams of one owner never meet: level 4 and 5 against the other team's, and the two level 8s.
    expect(tick).toMatchObject({ slot, claimed: true, commit: { slot, races: 3 } });
    expect(tick.commit).not.toHaveProperty('matchups');
    expect(inputs).toHaveLength(1);
    expect(inputs[0].slot).toBe(slot);
    expect(inputs[0].matchups.flatMap((m) => [m.a, m.b]).sort()).toEqual(tokens);
    for (const m of inputs[0].matchups) {
      expect([m.track, m.weather, m.tod].every(Number.isInteger)).toBe(true);
    }
    expect(inputs[0].deadlineMs).toBeGreaterThanOrEqual(before + TEAM_PHASE_BUDGET_MS);
    expect(inputs[0].deadlineMs).toBeLessThanOrEqual(after + TEAM_PHASE_BUDGET_MS);
    expect(TEAM_PHASE_BUDGET_MS).toBe(40_000);

    // The commit is sent first; then each team takes one action (a capsule is two transactions).
    const sent = chain.near.mock.calls.slice(seeded).filter((c) => c.kind !== 'view');
    expect(sent[0]).toMatchObject({ kind: 'settlement', method: 'commit_batch' });
    expect(sent[0].args.matchups).toEqual(inputs[0].matchups);
    expect(sent.slice(1).every((c) => c.kind === 'player')).toBe(true);
    const teams = /** @type {any[]} */ (tick.teams);
    expect(teams.map((t) => t.outcome)).toEqual(['applied', 'applied']);
    expect(teams.map((t) => t.team).sort()).toEqual(
      [a, b].map((t) => t.accountId.split('.')[0]).sort()
    );
  });

  it('is skipped while racing is paused, and a failing team phase does not fail the tick', async () => {
    const { slot, cleanup, deps } = await world();
    let calls = 0;
    /** @type {typeof runTeamPhase} */
    const teamPhase = async () => {
      calls += 1;
      throw new Error('teams down');
    };

    const paused = await runTick(
      { now: slotStartMs(slot) + 1_000, commit: false },
      { ...deps, teamPhase }
    );
    expect(paused).toMatchObject({ claimed: true, commit: { skipped: 'paused' } });
    expect(paused).not.toHaveProperty('teams');
    expect(calls).toBe(0);
    await cleanup();

    // No drone of this chain is active, so nothing is committed; the phase still runs, with no
    // matchups, and its failure is reported in the tick's answer.
    const ticked = await runTick({ now: slotStartMs(slot) + 1_000 }, { ...deps, teamPhase });
    await cleanup();
    expect(ticked).toMatchObject({
      claimed: true,
      commit: { slot, races: 0 },
      teams: { error: 'Error: teams down' },
    });
    expect(calls).toBe(1);
  });
});
