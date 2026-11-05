/**
 * Stat allocation along a team's persona weights (SPEC.md 10). Pure. The seed uses it to mint a
 * team's drones at TSB(L); the runner's allocate step uses it with the team's spare Volts.
 */

import {
  calculatePerStatCap,
  calculateStatUpgradeCost,
  calculateTSB,
} from '../game-engine/economy.js';
import { STAT_KEYS } from '../game-engine/templates.js';

/** @typedef {import('../game-engine/templates.js').StatKey} StatKey */

/**
 * Raise stats one point at a time along the persona weights. Each point goes to the stat furthest
 * below its share of the level's budget (`weight / total * (TSB - 9)` points above 1); ties go to
 * the larger weight, then to SPEC.md 2.1 order. A stat at cap(L) is skipped, as is a point whose
 * cost (`1 + floor(stat / 10)`) no longer fits `budget`. Stops at TSB(L) or when no point fits.
 * @param {{ stats: number[], level: number, weights: Record<StatKey, number>, budget?: number }} input `budget` in Volts (default: no limit)
 * @returns {{ stats: number[], points: number, cost: number }}
 */
export function allocateAlongPersona({ stats, level, weights, budget = Infinity }) {
  const cap = calculatePerStatCap(level);
  const next = [...stats];
  const total = STAT_KEYS.reduce((sum, key) => sum + (weights[key] ?? 0), 0) || 1;
  const share = calculateTSB(level) - STAT_KEYS.length;
  let headroom = calculateTSB(level) - next.reduce((a, b) => a + b, 0);
  let points = 0;
  let cost = 0;
  while (headroom > 0) {
    const order = STAT_KEYS.map((key, i) => ({
      i,
      weight: weights[key] ?? 0,
      // The deficit times `total`, so the comparison stays in integers.
      deficit: (weights[key] ?? 0) * share - (next[i] - 1) * total,
    }))
      .filter((s) => next[s.i] < cap)
      .sort((a, b) => b.deficit - a.deficit || b.weight - a.weight || a.i - b.i);
    const pick = order.find((s) => cost + calculateStatUpgradeCost(next[s.i]) <= budget);
    if (!pick) break;
    cost += calculateStatUpgradeCost(next[pick.i]);
    next[pick.i] += 1;
    points += 1;
    headroom -= 1;
  }
  return { stats: next, points, cost };
}
