/**
 * The security demo's spend planner and report (lib/security/attack-demo.js). The run itself is
 * recorded on testnet (docs/security-demo.md).
 */
import { describe, expect, it } from 'vitest';
import {
  calculatePerStatCap,
  calculateTSB,
  calculateTotalUpgradeCost,
} from '../../lib/game-engine/economy.js';
import { planBeyond, planWithin, renderReport } from '../../lib/security/attack-demo.js';

const ones = () => Array.from({ length: 9 }, () => 1);

/**
 * What raising `from` to `to` costs, stat by stat (SPEC.md 2.1).
 * @param {number[]} from @param {number[]} to
 */
const costOf = (from, to) =>
  from.reduce((sum, v, i) => sum + calculateTotalUpgradeCost(v, to[i]), 0);

describe('planWithin', () => {
  it('buys as many points as the budget pays for, and its cost is what the contract charges', () => {
    const plan = planWithin(ones(), 20, 500);
    expect(plan).not.toBeNull();
    const p = /** @type {NonNullable<typeof plan>} */ (plan);
    expect(p.cost).toBe(costOf(ones(), p.stats));
    expect(p.cost).toBeLessThanOrEqual(500);
    // One more point on the stat it raises would pass the budget.
    const next = 1 + Math.floor(Math.max(...p.stats.filter((s) => s < 100)) / 10);
    expect(p.cost + next).toBeGreaterThan(500);
    expect(p.points).toBe(p.stats.reduce((a, b) => a + b, 0) - 9);
  });

  it('raises the highest stat first, so points cost as much as they can', () => {
    const p = /** @type {NonNullable<ReturnType<typeof planWithin>>} */ (
      planWithin(ones(), 20, 60)
    );
    expect(p.stats.slice(1)).toEqual(ones().slice(1));
    expect(p.stats[0]).toBeGreaterThan(1);
  });

  it('respects the per-stat cap and the TSB, and returns null when not one point fits', () => {
    const capped = Array.from({ length: 9 }, () => calculatePerStatCap(1));
    expect(planWithin(capped, 1, 10_000)).toBeNull();
    const plan = planWithin(ones(), 1, 10_000);
    expect(plan?.stats.reduce((a, b) => a + b, 0)).toBe(calculateTSB(1));
    expect(Math.max(...(plan?.stats ?? []))).toBeLessThanOrEqual(calculatePerStatCap(1));
    expect(planWithin(ones(), 20, 0)).toBeNull();
  });
});

describe('planBeyond', () => {
  it('passes what is left of the day by the fewest points, within the per-transaction cap', () => {
    const plan = planBeyond(ones(), 20, 4, 500);
    const p = /** @type {NonNullable<typeof plan>} */ (plan);
    expect(p.cost).toBeGreaterThan(4);
    expect(p.cost).toBeLessThanOrEqual(500);
    expect(p.cost).toBe(costOf(ones(), p.stats));
    // Without its last point it would fit in the 4 left.
    expect(p.cost - 1 - Math.floor((Math.max(...p.stats) - 1) / 10)).toBeLessThanOrEqual(4);
  });

  it('is one point when nothing is left of the day', () => {
    expect(planBeyond(ones(), 20, 0, 500)).toMatchObject({ points: 1, cost: 1 });
  });

  it('is null when passing the day would break the per-transaction cap or the headroom', () => {
    expect(planBeyond(ones(), 20, 600, 500)).toBeNull();
    expect(planBeyond(ones(), 1, 1_000, 5_000)).toBeNull();
  });
});

describe('renderReport', () => {
  /** @type {import('../../lib/security/attack-demo.js').DemoRun} */
  const run = {
    at: '2026-11-09T23:59:00.000Z',
    accountId: 'testrogueagent.game.hyperdrome.testnet',
    accountUrl: 'https://testnet.nearblocks.io/address/testrogueagent.game.hyperdrome.testnet',
    contractId: 'game.hyperdrome.testnet',
    playKey: {
      publicKey: 'ed25519:abc',
      receiver: 'game.hyperdrome.testnet',
      methods: ['equip', 'open_pack'],
      allowanceNear: '0.9900 NEAR',
    },
    caps: { perTx: 500, perDay: 1000 },
    before: { volts: 5000, spentToday: 0, allowanceNear: '1.0000 NEAR' },
    after: { volts: 4004, spentToday: 996, allowanceNear: '0.9900 NEAR' },
    attempts: [
      {
        n: 1,
        title: 'Spend over the per-transaction cap',
        tried: 'tries',
        expected: 'the contract (`cap exceeded`)',
        asExpected: true,
        steps: [
          {
            label: 'open_pack',
            status: 'failed',
            error: 'Smart contract panicked: cap exceeded',
            txUrl: 'https://testnet.nearblocks.io/txns/H1',
          },
        ],
      },
      {
        n: 3,
        title: 'Move its Volts or its drone out',
        tried: 'tries',
        expected: 'the protocol',
        asExpected: false,
        remark: 'Both methods need 1 yocto.',
        steps: [
          {
            label: 'ft_transfer',
            status: 'rejected',
            error: 'AccessKeyMethodNameMismatchActionError: x',
            txUrl: null,
          },
        ],
      },
    ],
  };

  it('lists every attempt with its verdict, exact error, and link or the reason it has none', () => {
    const text = renderReport(run);
    expect(text).toContain(
      '| 1 | Spend over the per-transaction cap | the contract (`cap exceeded`) | yes |'
    );
    expect(text).toContain('| 3 | Move its Volts or its drone out | the protocol | no |');
    expect(text).toContain(
      '- open_pack: failed, [transaction](https://testnet.nearblocks.io/txns/H1).'
    );
    expect(text).toContain('  Smart contract panicked: cap exceeded');
    expect(text).toContain(
      '- ft_transfer: rejected, no transaction: the RPC refused it before any block'
    );
    expect(text).toContain('  AccessKeyMethodNameMismatchActionError: x');
    expect(text).toContain('Both methods need 1 yocto.');
    expect(text).toContain('gas allowance 0.9900 NEAR');
    expect(text).not.toMatch(/[–—]/);
  });
});
