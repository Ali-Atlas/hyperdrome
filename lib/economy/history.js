/**
 * How long the economy history is kept and shown (SPEC.md 7 `economy_snapshots`, 8
 * `GET /api/economy`). Pure, shared by the tick's snapshot write and the route.
 */

const HOUR_MS = 3_600_000;

/** Snapshots older than this are pruned by the write that adds a new one. */
export const SNAPSHOT_RETENTION_MS = 7 * 24 * HOUR_MS;

/** The window the economy page shows and replays. */
export const ECONOMY_WINDOW_MS = 24 * HOUR_MS;

/** Decisions the route sends, newest first. */
export const DECISION_LIMIT = 200;

/**
 * The oldest snapshot time a write at `nowMs` keeps: anything before it is pruned.
 * @param {number} nowMs
 * @returns {Date}
 */
export function snapshotCutoff(nowMs) {
  return new Date(nowMs - SNAPSHOT_RETENTION_MS);
}
