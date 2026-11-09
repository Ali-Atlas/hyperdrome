/**
 * GET /api/health (services/health.service.js, app/api/health/route.js; SPEC.md 8): the shape of a
 * healthy answer from the route against a real Postgres and the mock adapter, the last tick and its
 * age, the report when the database and the RPC are down, and the scheduler check: a stale tick and
 * a stuck batch.
 */
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { schema } from '../../lib/db/index.js';
import { createMockNear } from '../../lib/near/mock.js';
import { MAX_COMMITTED_AGE_S, MAX_TICK_AGE_S, getHealth } from '../../services/health.service.js';
import { dbEnabled, testDb } from '../gameplay/setup.js';

const { adminConfig, batches, cronTicks } = schema;

/**
 * A database double for the scheduler check, so another test file's racing flag or batches cannot
 * change the answer.
 * @param {{ now: number, racing: boolean, tickAgeS?: number, committedAgeS?: number }} state
 */
function schedulerDb({ now, racing, tickAgeS, committedAgeS }) {
  const ago = (/** @type {number} */ seconds) => new Date(now - seconds * 1000);
  const rows = new Map(
    /** @type {[unknown, object[]][]} */ ([
      [cronTicks, tickAgeS === undefined ? [] : [{ slot: 7, startedAt: ago(tickAgeS) }]],
      [batches, committedAgeS === undefined ? [] : [{ committedAt: ago(committedAgeS) }]],
      [adminConfig, racing ? [{ value: 'true' }] : []],
    ])
  );
  const query = (/** @type {unknown} */ table) => {
    const chain = { where: () => chain, orderBy: () => chain, limit: async () => rows.get(table) };
    return chain;
  };
  return { execute: async () => ({}), select: () => ({ from: query }) };
}

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
    // Another test file can switch racing on; this test is about the answer's shape.
    vi.doMock('../../services/race-schedule.service.js', () => ({
      isRacingEnabled: async () => false,
    }));
    vi.resetModules();
    const { GET } = await import('../../app/api/health/route.js');
    vi.doUnmock('../../services/race-schedule.service.js');
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
    expect(Object.keys(body.data.scheduler).sort()).toEqual([
      'lastTickAgeSeconds',
      'lastTickSlot',
      'ok',
      'oldestCommittedAgeSeconds',
    ]);
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
    expect(report.database.ok).toBe(true);
    expect(report.scheduler).toMatchObject({ lastTickSlot: slot, lastTickAgeSeconds: 95 });
    expect(report.checkedAt).toBe('2026-11-05T12:01:35.000Z');
  });
});

describe('scheduler check', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  const check = (/** @type {Omit<Parameters<typeof schedulerDb>[0], 'now'>} */ state) =>
    getHealth({ db: schedulerDb({ now, ...state }), near: () => createMockNear(), now });

  it('is ok at the limits', async () => {
    const report = await check({
      racing: true,
      tickAgeS: MAX_TICK_AGE_S,
      committedAgeS: MAX_COMMITTED_AGE_S,
    });
    expect(report.ok).toBe(true);
    expect(report.scheduler).toEqual({
      ok: true,
      lastTickSlot: 7,
      lastTickAgeSeconds: 300,
      oldestCommittedAgeSeconds: 600,
    });
  });

  it('fails on a stale tick, and on no tick at all', async () => {
    const stale = await check({ racing: true, tickAgeS: MAX_TICK_AGE_S + 1 });
    expect(stale).toMatchObject({ ok: false, scheduler: { ok: false, lastTickAgeSeconds: 301 } });
    expect(stale.database.ok).toBe(true);
    expect(await check({ racing: true })).toMatchObject({ ok: false, scheduler: { ok: false } });
  });

  it('fails on a batch stuck in committed while ticks continue', async () => {
    const stuck = await check({
      racing: true,
      tickAgeS: 30,
      committedAgeS: MAX_COMMITTED_AGE_S + 1,
    });
    expect(stuck).toMatchObject({
      ok: false,
      scheduler: { ok: false, lastTickAgeSeconds: 30, oldestCommittedAgeSeconds: 601 },
    });
  });

  it('is ok while racing is paused, however old the tick and the batch', async () => {
    const paused = await check({ racing: false, tickAgeS: 90_000, committedAgeS: 90_000 });
    expect(paused).toMatchObject({ ok: true, scheduler: { ok: true }, racingEnabled: false });
  });

  it('answers 503, never cached, when the scheduler is not ok', async () => {
    vi.doMock('../../services/health.service.js', () => ({
      getHealth: async () => ({ ok: false, scheduler: { ok: false } }),
    }));
    vi.resetModules();
    const { GET } = await import('../../app/api/health/route.js');
    vi.doUnmock('../../services/health.service.js');
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
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
      scheduler: {
        ok: false,
        lastTickSlot: null,
        lastTickAgeSeconds: null,
        oldestCommittedAgeSeconds: null,
      },
      racingEnabled: null,
      checkedAt: '1970-01-01T00:00:00.000Z',
    });
    expect(logged).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });

  it('fails a check that hangs, and a database that answers select 1 without the tables', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hung = await getHealth({
      db: { execute: () => new Promise(() => {}) },
      near: () => /** @type {any} */ ({ view: () => new Promise(() => {}) }),
      timeoutMs: 20,
    });
    expect(hung).toMatchObject({ ok: false, database: { ok: false }, rpc: { ok: false } });

    const unmigrated = {
      execute: async () => ({ rows: [{ '?column?': 1 }] }),
      select: () => {
        throw new Error('relation "cron_ticks" does not exist');
      },
    };
    const report = await getHealth({ db: unmigrated, near: () => createMockNear() });
    expect(report).toMatchObject({
      ok: false,
      database: { ok: false },
      rpc: { ok: true },
      racingEnabled: null,
    });
    logged.mockRestore();
  });
});
