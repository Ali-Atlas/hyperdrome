/**
 * The per-day record of Volts minted and burned (SPEC.md 7, 8): the event arithmetic, and the
 * upsert on a real Postgres (CI's service; locally any non-Neon DATABASE_URL). Each database test
 * uses its own day far in the past, so test files running at once never share a row.
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { schema } from '../../lib/db/index.js';
import { raceMarginMs, utcDayKey, utcDayStart, voltFlows } from '../../lib/live/summary.js';
import { applyEvents } from '../../services/chain-cache.service.js';
import { fixtureAccounts } from '../../lib/teams/fixtures.js';
import { recordVoltFlows } from '../../services/volt-daily.js';
import { dbEnabled, ev, testDb } from '../gameplay/setup.js';

const { voltDaily } = schema;

const mint = (/** @type {[string, string][]} */ ...entries) =>
  ev(
    'ft_mint',
    entries.map(([owner_id, amount]) => ({ owner_id, amount })),
    'nep141'
  );
const burn = (/** @type {string} */ amount) =>
  ev('ft_burn', [{ owner_id: 'p', amount, memo: 'spend' }], 'nep141');

describe('voltFlows', () => {
  it('sums every entry of an aggregated ft_mint and adds ft_burn apart', () => {
    expect(
      voltFlows([
        mint(['a', '4'], ['b', '1']),
        burn('3500'),
        ev('batch_settled', { batch_id: 1, races: [] }),
      ])
    ).toEqual({ minted: 5, burned: 3500 });
  });

  it('counts a stat upgrade and a starter grant, which no cached row prices', () => {
    expect(voltFlows([burn('75'), mint(['p', '1000'])])).toEqual({ minted: 1000, burned: 75 });
  });

  it('leaves out the entries of excluded accounts (test fixtures)', () => {
    const fixture = 'testrogueagent.game.test';
    const excluded = new Set([fixture]);
    expect(voltFlows([mint(['a', '4'], [fixture, '5000']), burn('10')], excluded)).toEqual({
      minted: 4,
      burned: 10,
    });
    expect(
      voltFlows([ev('ft_burn', [{ owner_id: fixture, amount: '499' }], 'nep141')], excluded)
    ).toEqual({ minted: 0, burned: 0 });
    expect(fixtureAccounts('game.test')).toEqual(new Set([fixture]));
    expect(fixtureAccounts(undefined).size).toBe(0);
  });

  it('ignores transfers (the marketplace rake goes to the treasury) and other standards', () => {
    expect(
      voltFlows([
        ev('ft_transfer', [{ old_owner_id: 'a', new_owner_id: 't', amount: '50' }], 'nep141'),
        ev('ft_transfer', [{ old_owner_id: 'a' }], 'nep141'),
        ev('ft_mint', [{ owner_id: 'a', amount: '9' }], 'other'),
      ])
    ).toEqual({ minted: 0, burned: 0 });
  });
});

describe('utcDayStart and utcDayKey', () => {
  it('floor to the UTC day', () => {
    const now = Date.UTC(2026, 10, 9, 23, 59, 59);
    expect(utcDayStart(now).toISOString()).toBe('2026-11-09T00:00:00.000Z');
    expect(utcDayKey(now)).toBe('2026-11-09');
    expect(utcDayKey(now + 1000)).toBe('2026-11-10');
  });
});

describe('raceMarginMs', () => {
  it('is the absolute difference in milliseconds', () => {
    expect(raceMarginMs('61.2500', '60.0000')).toBe(1250);
    expect(raceMarginMs(60, 61.25)).toBe(1250);
  });

  it('is null without both times', () => {
    expect(raceMarginMs(null, '60')).toBeNull();
  });
});

describe.skipIf(!dbEnabled)('recordVoltFlows', () => {
  const db = testDb();
  /** @param {number} day of January 2001 */
  const at = (day) => Date.UTC(2001, 0, day, 12);
  const row = async (/** @type {number} */ nowMs) =>
    (
      await db
        .select()
        .from(voltDaily)
        .where(eq(voltDaily.day, utcDayKey(nowMs)))
    )[0];

  afterAll(async () => {
    await db?.delete(voltDaily).where(
      inArray(
        voltDaily.day,
        [1, 2, 3, 4, 5, 6].map((d) => utcDayKey(at(d)))
      )
    );
    await db?.$client?.end?.();
  });

  it('adds up across outcomes of one day, and starts a new row on the next', async () => {
    await recordVoltFlows([mint(['a', '4'], ['b', '1'])], db, at(1));
    await recordVoltFlows([burn('3500'), mint(['a', '20'])], db, at(1));
    await recordVoltFlows([burn('10')], db, at(2));
    expect(await row(at(1))).toMatchObject({ minted: 25, burned: 3500 });
    expect(await row(at(2))).toMatchObject({ minted: 0, burned: 10 });
  });

  it('loses nothing to concurrent writers', async () => {
    await Promise.all(
      Array.from({ length: 10 }, () => recordVoltFlows([mint(['a', '7'])], db, at(3)))
    );
    expect((await row(at(3))).minted).toBe(70);
  });

  it('writes no row for an outcome without a mint or burn', async () => {
    await recordVoltFlows([ev('ft_transfer', [{ old_owner_id: 'a' }], 'nep141')], db, at(4));
    expect(await row(at(4))).toBeUndefined();
  });

  it('is written by applyEvents, even when a later step of the outcome fails', async () => {
    const near = /** @type {any} */ ({
      gameId: 'game',
      view: vi.fn(() => Promise.reject(new Error('rpc down'))),
    });
    const events = /** @type {any[]} */ ([mint(['nobody', '4']), burn('3')]);
    await applyEvents(events, { db, near, nowMs: at(5) });
    expect(await row(at(5))).toMatchObject({ minted: 4, burned: 3 });
  });

  it('logs a failed write and never throws into the caches', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = {
      insert: () => ({
        values: () => ({ onConflictDoUpdate: () => Promise.reject(new Error('no table')) }),
      }),
    };
    await expect(recordVoltFlows([burn('1')], broken, at(6))).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'volt daily record failed', burned: 1 })
    );
    log.mockRestore();
  });
});
