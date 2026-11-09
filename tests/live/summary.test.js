/**
 * The landing strip's arithmetic (lib/live/summary.js, SPEC.md 8).
 */
import { describe, expect, it } from 'vitest';
import { raceMarginMs, summarizeDay, utcDayStart } from '../../lib/live/summary.js';

const prices = {
  packs: [
    { id: 0, skin_pack_price: '2000', mod_capsule_price: '1000' },
    { id: 1, skin_pack_price: '12000', mod_capsule_price: '6000' },
  ],
  vendor: '3500',
};
const empty = { winnerVolts: 0, loserVolts: 0, packs: [], vendorDrones: 0, fees: 0, trades: 0 };

describe('summarizeDay', () => {
  it('is all zeros for an empty day', () => {
    expect(summarizeDay(empty, prices)).toEqual({
      voltsMinted: 0,
      voltsBurned: 0,
      voltsFees: 0,
      trades: 0,
    });
  });

  it('mints the winners and losers race rewards', () => {
    expect(summarizeDay({ ...empty, winnerVolts: 120, loserVolts: 45 }, prices).voltsMinted).toBe(
      165
    );
  });

  it('burns packs at their kind and tier price, and vendor drones', () => {
    const day = {
      ...empty,
      packs: [
        { kind: 'skin', tier: 0, count: 2 },
        { kind: 'mod', tier: 1, count: 1 },
      ],
      vendorDrones: 2,
    };
    expect(summarizeDay(day, prices).voltsBurned).toBe(2 * 2000 + 6000 + 2 * 3500);
  });

  it('skips a tier the contract does not list', () => {
    const day = { ...empty, packs: [{ kind: 'skin', tier: 9, count: 3 }] };
    expect(summarizeDay(day, prices).voltsBurned).toBe(0);
  });

  it('keeps fees apart from burns, since the rake goes to the treasury', () => {
    const summary = summarizeDay({ ...empty, fees: 50, trades: 4 }, prices);
    expect(summary).toMatchObject({ voltsBurned: 0, voltsFees: 50, trades: 4 });
  });
});

describe('utcDayStart', () => {
  it('floors to midnight UTC', () => {
    expect(utcDayStart(Date.UTC(2026, 10, 9, 13, 45, 7)).toISOString()).toBe(
      '2026-11-09T00:00:00.000Z'
    );
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
