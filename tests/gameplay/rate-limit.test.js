/**
 * Fixed-window rate limits in Postgres (services/rate-limit.service.js, SPEC.md 8): exact counts
 * under concurrency, a fresh window resets, and one row per bucket remains.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { schema } from '../../lib/db/index.js';
import { hitRateLimit } from '../../services/rate-limit.service.js';
import { dbEnabled, testDb } from './setup.js';

describe.skipIf(!dbEnabled)('hitRateLimit', () => {
  const db = testDb();
  afterAll(async () => {
    await db?.$client?.end?.();
  });

  it('allows exactly the limit per window, even when hits race', async () => {
    const bucket = `test:${randomUUID()}`;
    const now = new Date('2026-11-03T12:00:10Z');
    const hits = await Promise.all(
      Array.from({ length: 8 }, () => hitRateLimit(bucket, { limit: 5, windowMs: 60_000, now, db }))
    );
    expect(hits.filter(Boolean)).toHaveLength(5);

    const next = new Date('2026-11-03T12:01:00Z');
    expect(await hitRateLimit(bucket, { limit: 5, windowMs: 60_000, now: next, db })).toBe(true);
    const rows = await db
      .select()
      .from(schema.rateLimits)
      .where(eq(schema.rateLimits.bucket, bucket));
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(1);
  });
});
