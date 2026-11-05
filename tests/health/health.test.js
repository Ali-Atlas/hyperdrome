/**
 * GET /api/health (services/health.service.js, app/api/health/route.js; SPEC.md 8): the shape of a
 * healthy answer from the route against a real Postgres and the mock adapter, the last tick and its
 * age, and the report when the database and the RPC are down.
 */
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { schema } from '../../lib/db/index.js';
import { createMockNear } from '../../lib/near/mock.js';
import { getHealth } from '../../services/health.service.js';
import { dbEnabled, testDb } from '../gameplay/setup.js';

const { cronTicks } = schema;

describe.skipIf(!dbEnabled)('GET /api/health', () => {
  const db = testDb();
  // Above every slot the scheduler tests use, and above earlier runs of this file.
  const slot = 2_000_000_000 + Math.floor(Date.now() / 1000);
  const startedAt = new Date('2026-11-05T12:00:00Z');
  afterAll(async () => {
    await db.delete(cronTicks).where(eq(cronTicks.slot, slot));
    await db?.$client?.end?.();
    vi.unstubAllEnvs();
  });

  it('answers 200 with the report, cached for 60 s, and nothing else', async () => {
    vi.stubEnv('NEAR_ADAPTER', 'mock');
    const { GET } = await import('../../app/api/health/route.js');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=60');
    const body = await res.json();
    expect(Object.keys(body)).toEqual(['data']);
    expect(Object.keys(body.data).sort()).toEqual([
      'checkedAt',
      'database',
      'ok',
      'racingEnabled',
      'rpc',
      'scheduler',
    ]);
    expect(body.data).toMatchObject({ ok: true, database: { ok: true }, rpc: { ok: true } });
    expect(Object.keys(body.data.scheduler).sort()).toEqual(['lastTickAgeSeconds', 'lastTickSlot']);
    expect(typeof body.data.racingEnabled).toBe('boolean');
    expect(new Date(body.data.checkedAt).toISOString()).toBe(body.data.checkedAt);
  });

  it('reports the newest tick slot and its age', async () => {
    await db.insert(cronTicks).values({ slot, startedAt });
    const report = await getHealth({
      db,
      near: () => createMockNear(),
      now: startedAt.getTime() + 95_000,
    });
    expect(report.ok).toBe(true);
    expect(report.scheduler).toEqual({ lastTickSlot: slot, lastTickAgeSeconds: 95 });
    expect(report.checkedAt).toBe('2026-11-05T12:01:35.000Z');
  });
});

describe('health report when a dependency is down', () => {
  it('is not ok, with each failed check false and the rest null', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const down = {
      execute: async () => {
        throw new Error('connection refused');
      },
    };
    const report = await getHealth({
      db: down,
      near: () => {
        throw new Error('invalid NEAR adapter config');
      },
      now: 0,
    });
    expect(report).toEqual({
      ok: false,
      database: { ok: false },
      rpc: { ok: false },
      scheduler: { lastTickSlot: null, lastTickAgeSeconds: null },
      racingEnabled: null,
      checkedAt: '1970-01-01T00:00:00.000Z',
    });
    expect(logged).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });
});
