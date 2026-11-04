/**
 * Fixed-window rate limits in Postgres (ENGINEERING.md 4: limits hold across serverless
 * instances). One row per bucket and window; a hit is one upsert that increments and returns the
 * count, so concurrent requests on any instance are counted exactly.
 */
import { and, eq, lt, sql } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/lib/db';

const { rateLimits } = schema;

/** Mutations per user per minute (SPEC.md 8). */
export const MUTATION_LIMIT = 30;
export const MUTATION_WINDOW_MS = 60_000;

/**
 * Count one request against `bucket` and say whether it is within `limit` for the current window.
 * The first hit of a window also deletes the bucket's older windows, so a bucket keeps one row.
 * @param {string} bucket e.g. `mutation:<userId>`
 * @param {{ limit: number, windowMs: number, now?: Date, db?: any }} options
 * @returns {Promise<boolean>} true when allowed
 */
export async function hitRateLimit(bucket, { limit, windowMs, now = new Date(), db = defaultDb }) {
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const [row] = await db
    .insert(rateLimits)
    .values({ bucket, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.bucket, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });
  const count = Number(row?.count ?? 1);
  if (count === 1) {
    await db
      .delete(rateLimits)
      .where(and(eq(rateLimits.bucket, bucket), lt(rateLimits.windowStart, windowStart)));
  }
  return count <= limit;
}

/**
 * The per-user mutation limit: 30 per minute.
 * @param {string} userId
 * @param {{ db?: any }} [deps]
 */
export function hitMutationLimit(userId, deps = {}) {
  return hitRateLimit(`mutation:${userId}`, {
    limit: MUTATION_LIMIT,
    windowMs: MUTATION_WINDOW_MS,
    db: deps.db,
  });
}
