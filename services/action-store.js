/**
 * The `actions` table helpers shared by the player action path (services/action.service.js) and
 * the ops-key action path (services/ops-action.service.js): rows by id, the replay checks and the
 * stored answer a replay gets (SPEC.md 8).
 */
import { eq } from 'drizzle-orm';
import { schema } from '@/lib/db';

const { actions } = schema;

/**
 * @typedef {{ status: number, body: Record<string, unknown> }} ActionResponse
 * @typedef {typeof actions.$inferSelect} ActionRow
 * @typedef {{ userId: string, method: string, args: Record<string, unknown>, recordArgs?: Record<string, unknown> }} ActionIdentity
 */

/**
 * @param {number} status
 * @param {string} error
 * @returns {ActionResponse}
 */
export const reject = (status, error) => ({ status, body: { error } });

/**
 * @param {any} db
 * @param {string} actionId
 * @returns {Promise<ActionRow | undefined>}
 */
export async function findAction(db, actionId) {
  const [row] = await db.select().from(actions).where(eq(actions.id, actionId)).limit(1);
  return row;
}

/**
 * A replayed action id must come from the same user with the same method and args.
 * @param {ActionRow} row
 * @param {ActionIdentity} action
 * @returns {ActionResponse | null}
 */
export function mismatch(row, action) {
  const same =
    row.userId === action.userId &&
    row.method === action.method &&
    canonical(row.args) === canonical(action.recordArgs ?? action.args);
  return same ? null : reject(409, 'This action id was already used for a different action.');
}

/**
 * JSON with sorted object keys (jsonb does not keep key order).
 * @param {unknown} value
 * @returns {string}
 */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * The answer a finished action gave the first time.
 * @param {ActionRow} row
 * @returns {ActionResponse}
 */
export function storedResponse(row) {
  if (row.status === 'applied') {
    return {
      status: row.httpStatus ?? 200,
      body: /** @type {Record<string, unknown>} */ (row.result ?? { actionId: row.id }),
    };
  }
  return reject(row.httpStatus ?? 422, row.error ?? 'The game rejected this action.');
}
