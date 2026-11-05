/**
 * One scheduler tick (SPEC.md 3, 6; ENGINEERING.md 5): claim the slot's `cron_ticks` row (a second
 * tick in the same slot exits), then phase 0 (AI teams, T12), phase 1 (settle the batches of
 * earlier slots) and phase 2 (commit this slot's batch). Each phase leaves a batch in a state the
 * next tick can resume from.
 */
import { schema } from '@/lib/db';
import { commitBatch } from './batch.service.js';
import { resolveDeps, slotFor } from './scheduler-deps.js';
import { settleDueBatches } from './settle.service.js';

const { cronTicks } = schema;

/** @typedef {import('./scheduler-deps.js').Deps} Deps */

/**
 * Phase 0: the AI teams act on their open matchups and the economy (SPEC.md 10). T12 fills this
 * in; until then the hook does nothing.
 * @returns {Promise<void>}
 */
export async function runTeamsPhase() {}

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
 * Run the tick for the slot of `now`.
 * @param {{ now?: number, commit?: boolean }} [options] `commit: false` (racing paused) settles due batches and commits nothing
 * @param {Deps} [deps]
 * @returns {Promise<{ slot: number, claimed: boolean, settle?: Record<string, string>, commit?: Awaited<ReturnType<typeof commitBatch>> | { skipped: 'paused' } }>}
 */
export async function runTick({ now = Date.now(), commit = true } = {}, deps = {}) {
  const full = resolveDeps(deps);
  const slot = slotFor(now);
  if (!(await claimTick(full.db, slot))) return { slot, claimed: false };
  await runTeamsPhase();
  const settle = await settleDueBatches(slot, full);
  const committed = commit
    ? await commitBatch(slot, full)
    : { skipped: /** @type {const} */ ('paused') };
  return { slot, claimed: true, settle, commit: committed };
}
