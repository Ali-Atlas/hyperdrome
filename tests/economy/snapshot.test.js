/**
 * Economy snapshot pruning (SPEC.md 7 `economy_snapshots`): the write that adds a tick's row
 * deletes the rows older than 7 days, on a real Postgres (CI's service; locally any non-Neon
 * DATABASE_URL). Slots here are far above any real or test slot, so files running at once never
 * share a row.
 */
import { inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { schema } from '../../lib/db/index.js';
import { SNAPSHOT_RETENTION_MS, snapshotCutoff } from '../../lib/economy/history.js';
import { writeEconomySnapshot } from '../../services/economy-snapshot.js';
import { dbEnabled, testDb } from '../gameplay/setup.js';

const { economySnapshots } = schema;

const DAY_MS = 86_400_000;

describe('snapshotCutoff', () => {
  it('keeps exactly 7 days', () => {
    const now = Date.UTC(2026, 10, 10, 12);
    expect(SNAPSHOT_RETENTION_MS).toBe(7 * DAY_MS);
    expect(snapshotCutoff(now).toISOString()).toBe('2026-11-03T12:00:00.000Z');
  });
});

describe.skipIf(!dbEnabled)('writeEconomySnapshot', () => {
  const db = testDb();
  const base = 900_000_000;
  const slots = [base, base + 1, base + 2, base + 3];
  const row = (/** @type {number} */ slot, /** @type {Date} */ at) => ({
    slot,
    at,
    teams: [],
    supply: 1,
    minted: 0,
    burned: 0,
    openListings: 0,
    trades: 0,
  });
  /** @param {unknown} supply what `ft_total_supply` answers; an Error is thrown */
  const near = (supply) =>
    /** @type {any} */ ({
      view: async () => {
        if (supply instanceof Error) throw supply;
        return supply;
      },
    });

  afterAll(async () => {
    await db.delete(economySnapshots).where(inArray(economySnapshots.slot, slots));
  });

  it('adds the tick, prunes rows past 7 days and keeps the rest', async () => {
    const now = Date.now();
    await db
      .insert(economySnapshots)
      .values([
        row(slots[0], new Date(now - 7 * DAY_MS - 60_000)),
        row(slots[1], new Date(now - 6 * DAY_MS)),
      ]);

    expect(await writeEconomySnapshot(slots[2], { db, near: near('113394') }, now)).toBe(true);

    const kept = await db
      .select()
      .from(economySnapshots)
      .where(inArray(economySnapshots.slot, slots));
    expect(kept.map((/** @type {{ slot: number }} */ r) => r.slot).sort()).toEqual([
      slots[1],
      slots[2],
    ]);
    const written = kept.find((/** @type {{ slot: number }} */ r) => r.slot === slots[2]);
    expect(written).toMatchObject({ supply: 113_394, at: new Date(now) });
    expect(Array.isArray(written?.teams)).toBe(true);
  });

  it('writes the row without the supply when the view fails, and never throws', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await writeEconomySnapshot(slots[3], { db, near: near(new Error('rpc down')) })).toBe(
      true
    );
    const [written] = await db
      .select()
      .from(economySnapshots)
      .where(inArray(economySnapshots.slot, [slots[3]]));
    expect(written.supply).toBeNull();

    // A database that refuses the write: logged, false, no throw.
    const broken = /** @type {any} */ ({
      select: () => {
        throw new Error('db down');
      },
    });
    expect(await writeEconomySnapshot(slots[3] + 1, { db: broken, near: near('1') })).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ msg: 'economy snapshot failed' }));
    log.mockRestore();
  });
});
