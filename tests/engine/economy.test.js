import { describe, expect, it } from 'vitest';
import {
  STARTER_VOLTS,
  analyzeDronePerformance,
  calculateNewElo,
  calculatePerStatCap,
  calculateStatUpgradeCost,
  calculateTSB,
  calculateTotalUpgradeCost,
  calculateXPToNextLevel,
  computeLoserPayout,
  computeWinnerPayout,
  validateStatAllocation,
} from '../../lib/game-engine/economy.js';

describe('stat costs and budgets (SPEC.md 2.1)', () => {
  it('upgrade cost is 1 + floor(x / 10)', () => {
    expect([1, 9, 10, 50, 99].map(calculateStatUpgradeCost)).toEqual([1, 1, 2, 6, 10]);
  });

  it('total upgrade cost sums each step and never refunds', () => {
    expect(calculateTotalUpgradeCost(1, 100)).toBe(549);
    expect(calculateTotalUpgradeCost(1, 10)).toBe(9);
    expect(calculateTotalUpgradeCost(10, 20)).toBe(20);
    expect(calculateTotalUpgradeCost(5, 5)).toBe(0);
    expect(calculateTotalUpgradeCost(10, 5)).toBe(0);
  });

  it('TSB is 9 + 20 * L and the per-stat cap is min(100, 10 + floor(4.5 * L))', () => {
    expect([1, 5, 10, 20].map((l) => calculateTSB(l))).toEqual([29, 109, 209, 409]);
    expect([1, 5, 10, 15, 20].map((l) => calculatePerStatCap(l))).toEqual([14, 32, 55, 77, 100]);
  });

  it('XP to next level is 200 * L * L', () => {
    expect([1, 5, 10, 19].map(calculateXPToNextLevel)).toEqual([200, 5000, 20000, 72200]);
  });

  it('the starter grant is 1,000 Volts (SPEC.md 2.2)', () => {
    expect(STARTER_VOLTS).toBe(1000);
  });
});

describe('race payouts (SPEC.md 2.3)', () => {
  const race = {
    winnerLevel: 1,
    difficulty: 1,
    winnerElo: 1000,
    loserElo: 1000,
    winnerTimeMs: 50_000,
    loserTimeMs: 55_000,
  };

  it('winner: 3 + floor(L / 2) + floor(difficulty / 2) + upset + dominance', () => {
    expect(computeWinnerPayout(race)).toBe(3);
    expect(computeWinnerPayout({ ...race, winnerLevel: 9, difficulty: 7 })).toBe(3 + 4 + 3);
    expect(computeWinnerPayout({ ...race, winnerElo: 900, loserElo: 1150 })).toBe(3 + 2);
    expect(computeWinnerPayout({ ...race, winnerElo: 1200, loserElo: 1000 })).toBe(3);
  });

  it('dominance is 5 above a 40% margin and 2 above 20%, compared exactly', () => {
    expect(computeWinnerPayout({ ...race, loserTimeMs: 60_000 })).toBe(3);
    expect(computeWinnerPayout({ ...race, loserTimeMs: 60_001 })).toBe(5);
    expect(computeWinnerPayout({ ...race, loserTimeMs: 70_000 })).toBe(5);
    expect(computeWinnerPayout({ ...race, loserTimeMs: 70_001 })).toBe(8);
    expect(computeWinnerPayout({ ...race, winnerTimeMs: 0, loserTimeMs: 0 })).toBe(3);
  });

  it('loser: 1 + floor(L / 4)', () => {
    expect([1, 3, 4, 20].map((loserLevel) => computeLoserPayout({ loserLevel }))).toEqual([
      1, 1, 2, 6,
    ]);
  });
});

describe('ELO (SPEC.md 2.3, floating-point app view)', () => {
  it('even match moves 16 each way; an upset moves more', () => {
    expect(calculateNewElo(1000, 1000)).toEqual({ newWinnerElo: 1016, newLoserElo: 984 });
    const upset = calculateNewElo(900, 1100);
    expect(upset.newWinnerElo).toBeGreaterThan(916);
    expect(upset.newLoserElo).toBeLessThan(1084);
  });
});

describe('validateStatAllocation', () => {
  const base = {
    level: 1,
    speed: 1,
    turning: 1,
    acceleration: 1,
    durability: 1,
    nightVision: 1,
    batteryCapacity: 1,
    rainHandling: 1,
    windResistance: 1,
    consistency: 1,
  };

  it('accepts an affordable raise within cap and budget', () => {
    expect(validateStatAllocation(base, { speed: 5 }, { availablePoints: 20 })).toEqual({
      valid: true,
      errors: [],
      totalCost: 4,
    });
  });

  it('rejects over cap, unaffordable and decreasing allocations', () => {
    expect(validateStatAllocation(base, { speed: 20 }, { availablePoints: 100 }).valid).toBe(false);
    expect(validateStatAllocation(base, { speed: 5 }, { availablePoints: 2 }).valid).toBe(false);
    expect(
      validateStatAllocation({ ...base, speed: 5 }, { speed: 3 }, { availablePoints: 20 }).valid
    ).toBe(false);
  });

  it('accepts snake_case keys', () => {
    expect(
      validateStatAllocation(base, { night_vision: 3, rain_handling: 2 }, { availablePoints: 20 })
        .valid
    ).toBe(true);
  });
});

describe('analyzeDronePerformance', () => {
  it('classifies a speed build', () => {
    const analysis = analyzeDronePerformance({
      speed: 80,
      turning: 10,
      acceleration: 70,
      durability: 10,
      nightVision: 5,
      batteryCapacity: 10,
      rainHandling: 5,
      windResistance: 60,
      consistency: 20,
    });
    expect(analysis.optimal).toContain('Straight Lines');
    expect(analysis.poor).toContain('Rain');
  });
});
