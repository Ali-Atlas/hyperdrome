/**
 * One scheduler tick (SPEC.md 3, 6; ENGINEERING.md 5): claim the slot's `cron_ticks` row (a second
 * tick in the same slot exits), then phase 1 (settle the batches of earlier slots), phase 2 (commit
 * this slot's batch) and phase 3 (the AI teams act on the committed matchups, SPEC.md 10). Each
 * phase leaves a batch in a state the next tick can resume from.
 */
import { schema } from '@/lib/db';
import { commitBatch } from './batch.service.js';
import { resolveDeps, slotFor } from './scheduler-deps.js';
import { settleDueBatches } from './settle.service.js';
import { runTeamPhase } from './teams.service.js';

const { cronTicks } = schema;

/** @typedef {import('./scheduler-deps.js').Deps} Deps */

/**
 * No team starts its turn later than this after the tick started: the route allows 60 s, and a
 * team's one action (a capsule is two transactions) must fit in what is left.
 */
export const TEAM_PHASE_BUDGET_MS = 40_000;

/**
 * Claim the tick for `slot`: true when this call inserted the row, false when a tick already ran.
 * @param {any} db
 * @param {number} slot
 * @returns {Promise<boolean>}
 */
export async function claimTick(db, slot) {
  const rows = await db
    .insert(cronTicks)
    .values({ slot })
    .onConflictDoNothing()
    .returning({ slot: cronTicks.slot });
  return rows.length === 1;
}

/**
 * @typedef {Awaited<ReturnType<typeof runTeamPhase>>['teams'] | { error: string }} TeamsOutcome
 *   each team's result, or the error that stopped the team phase (the tick itself stands)
 */

/**
 * @typedef {{ slot: number, claimed: true, settle: Record<string, string>, commit: Omit<Awaited<ReturnType<typeof commitBatch>>, 'matchups'> | { skipped: 'paused' }, teams?: TeamsOutcome }} TickResult
 */

/**
 * Claim the slot of `now` and hand back the phases still to run. `/api/races/run?mode=background`
 * answers between the two, so a scheduler with a short request timeout sees the claim at once.
 * @param {{ now?: number, commit?: boolean }} [options] `commit: false` (racing paused) settles due batches, commits nothing and runs no team phase
 * @param {Deps} [deps]
 * @returns {Promise<{ slot: number, claimed: boolean, run: (() => Promise<TickResult>) | null }>} `run` is null when a tick already holds the slot
 */
export async function beginTick({ now = Date.now(), commit = true } = {}, deps = {}) {
  // The deadline counts from the wall clock; `now` only names the slot.
  const startedAt = Date.now();
  const full = resolveDeps(deps);
  const slot = slotFor(now);
  if (!(await claimTick(full.db, slot))) return { slot, claimed: false, run: null };
  return {
    slot,
    claimed: true,
    run: () => runPhases({ slot, commit, startedAt }, deps, full),
  };
}

/**
 * Run the tick for the slot of `now`, start to finish.
 * @param {{ now?: number, commit?: boolean }} [options] see `beginTick`
 * @param {Deps} [deps]
 * @returns {Promise<{ slot: number, claimed: boolean } & Partial<Omit<TickResult, 'slot' | 'claimed'>>>}
 */
export async function runTick(options = {}, deps = {}) {
  const { slot, run } = await beginTick(options, deps);
  return run ? run() : { slot, claimed: false };
}

/**
 * Phases 1 to 3 of a claimed tick.
 * @param {{ slot: number, commit: boolean, startedAt: number }} tick
 * @param {Deps} deps
 * @param {import('./scheduler-deps.js').FullDeps} full
 * @returns {Promise<TickResult>}
 */
async function runPhases({ slot, commit, startedAt }, deps, full) {
  const settle = await settleDueBatches(slot, full);
  if (!commit) {
    return { slot, claimed: true, settle, commit: { skipped: /** @type {const} */ ('paused') } };
  }
  const { matchups = [], ...committed } = await commitBatch(slot, full);
  const teams = await teamsPhase(
    { slot, matchups, deadlineMs: startedAt + TEAM_PHASE_BUDGET_MS },
    deps.teamPhase === undefined ? runTeamPhase : deps.teamPhase,
    full
  );
  return { slot, claimed: true, settle, commit: committed, ...(teams ? { teams } : {}) };
}

/**
 * Phase 3: the AI teams act on the matchups just committed. A failure here never fails the tick:
 * the batch is committed and the next tick settles it.
 * @param {Parameters<typeof runTeamPhase>[0]} input
 * @param {typeof runTeamPhase | null} run
 * @param {import('./scheduler-deps.js').FullDeps} deps
 * @returns {Promise<TeamsOutcome | null>}
 */
async function teamsPhase(input, run, deps) {
  if (!run) return null;
  try {
    return (await run(input, deps)).teams;
  } catch (err) {
    console.error({
      scope: 'scheduler',
      msg: 'team phase failed',
      slot: input.slot,
      error: String(err),
    });
    return { error: String(err) };
  }
}
