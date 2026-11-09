/**
 * The matchup numbers the race page and the dashboard panel share (lib/game-engine/race-edge.js,
 * SPEC.md 11).
 */
import { describe, expect, it } from 'vitest';
import {
  computeRaceEdge,
  statDeltas,
  trackEdges,
  trackScore,
} from '../../lib/game-engine/race-edge.js';
import { MOD_TEMPLATES, STAT_KEYS } from '../../lib/game-engine/templates.js';

/** @param {Partial<Record<typeof STAT_KEYS[number], number>>} [over] */
const stats = (over = {}) =>
  /** @type {Record<typeof STAT_KEYS[number], number>} */ ({
    ...Object.fromEntries(STAT_KEYS.map((k) => [k, 50])),
    ...over,
  });
const clear = { track: { straights: 4, turns: 4 }, weather: 'clear', timeOfDay: 'day' };
/** @param {string} name */
const templateId = (name) => {
  const t = MOD_TEMPLATES.find((m) => m.name === name);
  if (!t) throw new Error(name);
  return t.id;
};

describe('computeRaceEdge', () => {
  it('names the favorite and its probability from ELO', () => {
    const left = { eloRating: 1000 };
    const right = { eloRating: 1200 };
    const edge = computeRaceEdge(left, right);
    expect(edge.viewer).toBe(right);
    expect(edge.prob).toBeCloseTo(0.7597, 3);
    expect([edge.viewerElo, edge.oppElo]).toEqual([1200, 1000]);
  });

  it('calls a dead heat for the left side', () => {
    const left = { eloRating: 1000 };
    expect(computeRaceEdge(left, { eloRating: 1000 }).viewer).toBe(left);
  });
});

describe('statDeltas', () => {
  it('lists strengths and gaps largest first and leaves ties out', () => {
    const { strengths, gaps } = statDeltas(
      stats({ speed: 60, turning: 55 }),
      stats({ durability: 80, consistency: 70 })
    );
    expect(strengths.map((d) => [d.stat, d.delta])).toEqual([
      ['speed', 10],
      ['turning', 5],
    ]);
    expect(gaps.map((d) => [d.stat, d.delta])).toEqual([
      ['durability', -30],
      ['consistency', -20],
    ]);
  });
});

describe('trackEdges', () => {
  it('is even for equal drones and opposite for unequal ones', () => {
    const even = trackEdges({ stats: stats() }, { stats: stats() }, clear);
    expect(even).toEqual({ a: 0, b: 0 });
    const ahead = trackEdges({ stats: stats({ speed: 80 }) }, { stats: stats() }, clear);
    expect(ahead.a).toBeGreaterThan(0);
    expect(ahead.b).toBe(-ahead.a);
  });

  it('applies the conditions: rain makes rain handling count', () => {
    const wet = stats({ rainHandling: 90 });
    const dry = trackEdges({ stats: wet }, { stats: stats() }, clear);
    const rain = trackEdges({ stats: wet }, { stats: stats() }, { ...clear, weather: 'rain' });
    expect(dry.a).toBe(0);
    expect(rain.a).toBeCloseTo(0.5 * 40, 5);
  });

  it('applies the equipped mod, bonus and penalty', () => {
    const base = trackScore(stats(), null, clear);
    expect(trackScore(stats(), templateId('Aero Shell'), clear)).not.toBe(base);
    const shell = trackEdges(
      { stats: stats(), modTemplate: templateId('Aero Shell') },
      { stats: stats() },
      clear
    );
    // +4% speed is +2 and -2% turning is -1 at stat 50; each weighs 0.25 on an even track.
    expect(shell.a).toBeCloseTo(0.3, 1);
  });

  it('counts a legendary special, which has no stat bonus', () => {
    const phantom = templateId('Phantom Drive');
    const withSpecial = trackScore(stats(), phantom, clear);
    const penaltyOnly = trackScore(stats({ windResistance: 48 }), null, clear);
    expect(withSpecial).toBeGreaterThan(penaltyOnly);
  });
});
