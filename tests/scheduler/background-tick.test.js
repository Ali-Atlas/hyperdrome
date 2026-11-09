/**
 * `/api/races/run?mode=background` (SPEC.md 8): the claim happens before the answer and the phases
 * wait for `after()`. A second call in the slot claims nothing and schedules nothing.
 */
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '../../lib/db/index.js';
import { slotStartMs } from '../../services/scheduler-deps.js';
import { TEST_SECRET_KEY, dbEnabled, testDb } from '../gameplay/setup.js';

const scheduled = vi.hoisted(() => /** @type {(() => Promise<void>)[]} */ ([]));

vi.mock('next/server', () => ({
  after: (/** @type {() => Promise<void>} */ callback) => scheduled.push(callback),
}));
// lib/api/response.js imports the Auth.js handlers, which this unauthenticated-by-session route never calls.
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

const { POST } = await import('../../app/api/races/run/route.js');
const { batches, cronTicks } = schema;
const db = /** @type {any} */ (testDb());

// A slot far past any real tick, so the test owns its cron_ticks row.
const SLOT = 90_000_000 + Math.floor(Math.random() * 1_000_000);
const SECRET = 'background-tick-test-secret';

/** @param {string} query */
function tick(query) {
  return POST(
    new Request(`http://localhost/api/races/run${query}`, {
      method: 'POST',
      headers: { 'x-cron-secret': SECRET },
    })
  );
}

describe.skipIf(!dbEnabled)('background tick', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: slotStartMs(SLOT) + 1_000 });
    vi.stubEnv('CRON_SECRET', SECRET);
    vi.stubEnv('NEAR_ADAPTER', 'mock');
    vi.stubEnv('KEY_ENCRYPTION_KEY', TEST_SECRET_KEY);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await db.delete(cronTicks).where(eq(cronTicks.slot, SLOT));
  });

  it('claims the slot, answers 202 and leaves the phases to after()', async () => {
    const first = await tick('?mode=background');
    expect(first.status).toBe(202);
    expect((await first.json()).data).toMatchObject({
      slot: SLOT,
      claimed: true,
      background: true,
    });
    expect(scheduled).toHaveLength(1);
    expect(await db.select().from(cronTicks).where(eq(cronTicks.slot, SLOT))).toHaveLength(1);
    expect(await db.select().from(batches).where(eq(batches.slot, SLOT))).toHaveLength(0);

    const second = await tick('?mode=background');
    expect(second.status).toBe(200);
    expect((await second.json()).data).toMatchObject({ slot: SLOT, claimed: false });
    expect(scheduled).toHaveLength(1);
  });
});
