/**
 * The gas attached to `withdraw` (lib/wallet/withdraw-gas.js, SPEC.md 13): twice the measured line,
 * capped at the budget.
 */
import { describe, expect, it } from 'vitest';
import { withdrawGas } from '../../lib/wallet/withdraw-gas.js';

const TGAS = 1_000_000_000_000n;

describe('withdrawGas', () => {
  it('scales with the moved tokens at twice the measured line', () => {
    expect(withdrawGas(0)).toBe(8n * TGAS);
    expect(withdrawGas(3)).toBe((191n * TGAS) / 10n);
  });

  it('keeps at least 2x over the 40-token measurement and stops at the budget', () => {
    const measured = 73_500_000_000_000n;
    expect(withdrawGas(40)).toBe(150n * TGAS);
    expect(withdrawGas(40)).toBeGreaterThanOrEqual(2n * measured);
    expect(withdrawGas(1000)).toBe(150n * TGAS);
  });
});
