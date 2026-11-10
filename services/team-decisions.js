/**
 * The record of what each AI team decided and why (SPEC.md 7 `team_decisions`, 10), read by the
 * economy page. A public statistic never stops a team's action, so every write here is logged on
 * failure and never thrown.
 */
import { eq } from 'drizzle-orm';
import { schema } from '@/lib/db';
import { explainPlan, planNumbers } from '@/lib/teams/explain.js';

const { teamDecisions } = schema;

/**
 * @typedef {import('@/lib/teams/policy.js').Plan} Plan
 * @typedef {import('@/lib/teams/policy.js').TeamState} TeamState
 * @typedef {'pending' | 'applied' | 'refused' | 'error'} DecisionStatus
 */

/**
 * Write the decision before its action is sent, with the reason built from the state it was made
 * from. The row is keyed by the action id, so a second write for the same action changes nothing.
 * @param {any} db
 * @param {{ actionId: string, teamUserId: string, slot: number, plan: Plan, state: TeamState }} decision
 */
export async function recordDecision(db, { actionId, teamUserId, slot, plan, state }) {
  try {
    await db
      .insert(teamDecisions)
      .values({
        actionId,
        teamUserId,
        slot,
        step: plan.step,
        subject: plan.subject,
        method: plan.method,
        status: 'pending',
        reason: explainPlan(plan, state),
        numbers: planNumbers(plan, state),
      })
      .onConflictDoNothing();
  } catch (err) {
    console.error({ scope: 'teams', msg: 'decision record failed', actionId, err: String(err) });
  }
}

/**
 * Store how the action ended (and its transaction, once there is one). An action recorded before
 * this table existed has no row, and nothing is written for it.
 * @param {any} db
 * @param {string} actionId
 * @param {{ status: DecisionStatus, txHash?: string | null }} outcome
 */
export async function updateDecision(db, actionId, { status, txHash = null }) {
  try {
    await db
      .update(teamDecisions)
      .set(txHash ? { status, txHash } : { status })
      .where(eq(teamDecisions.actionId, actionId));
  } catch (err) {
    console.error({ scope: 'teams', msg: 'decision update failed', actionId, err: String(err) });
  }
}

/**
 * The transaction an action answer names: the call's hash, or a capsule's commit while its reveal
 * has none yet.
 * @param {Record<string, unknown>} body
 * @returns {string | null}
 */
export function answerTxHash(body) {
  const hash = body.txHash ?? body.commitTxHash;
  return typeof hash === 'string' && hash ? hash : null;
}
