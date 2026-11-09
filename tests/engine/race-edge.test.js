/**
 * The matchup numbers the race page and the dashboard panel share (lib/game-engine/race-edge.js,
 * SPEC.md 11).
 */
import { describe, expect, it } from 'vitest';
import {
  WIN_SIM_RACES,
  computeRaceEdge,
  formatWinProbability,
  statDeltas,
  trackEdges,
  trackScore,
  winProbability,
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

const race = {
  track: { straights: 4, turns: 4, difficulty: 3, length: 'medium' },
  weather: 'clear',
  timeOfDay: 'day',
};

describe('winProbability', () => {
  it('is deterministic for the same matchup', () => {
    const left = { ...stats({ speed: 60 }), modTemplate: templateId('Aero Shell') };
    const right = stats({ turning: 62 });
    expect(winProbability(left, right, race)).toBe(winProbability(left, right, race));
    expect(winProbability(left, right, race)).toBe(
      winProbability(
        { ...stats({ speed: 60 }), modTemplate: templateId('Aero Shell') },
        stats({ turning: 62 }),
        race
      )
    );
  });

  it('gives a clearly stronger drone the higher probability, and the sides sum to 1', () => {
    const strong = stats(Object.fromEntries(STAT_KEYS.map((k) => [k, 90])));
    const weak = stats(Object.fromEntries(STAT_KEYS.map((k) => [k, 10])));
    const p = winProbability(strong, weak, race);
    expect(p).toBeGreaterThan(0.9);
    expect(winProbability(weak, strong, race)).toBeCloseTo(1 - p, 10);
  });

  it('is exactly even for identical drones', () => {
    expect(winProbability(stats(), stats(), race)).toBe(0.5);
  });

  it('runs the race conditions: rain handling matters in the rain', () => {
    const wet = stats({ rainHandling: 95 });
    const dry = stats({ rainHandling: 5 });
    const clearP = winProbability(wet, dry, race);
    const rainP = winProbability(wet, dry, { ...race, weather: 'heavy_rain' });
    expect(rainP).toBeGreaterThan(clearP);
  });

  it('uses a fixed number of mirrored races', () => {
    expect(WIN_SIM_RACES % 2).toBe(0);
  });
});

describe('formatWinProbability', () => {
  it('never shows 0 or 100, and shows 1 decimal between', () => {
    expect(formatWinProbability(0)).toBe('<1%');
    expect(formatWinProbability(1)).toBe('>99%');
    expect(formatWinProbability(0.602)).toBe('60.2%');
    expect(formatWinProbability(0.005)).toBe('0.5%');
  });
});

describe('computeRaceEdge', () => {
  it('names the side above 50% as the favorite, not the higher ELO', () => {
    const strong = { ...stats(Object.fromEntries(STAT_KEYS.map((k) => [k, 90]))), eloRating: 900 };
    const weak = { ...stats(Object.fromEntries(STAT_KEYS.map((k) => [k, 10]))), eloRating: 1400 };
    const edge = computeRaceEdge(weak, strong, race);
    expect(edge.viewer).toBe(strong);
    expect(edge.prob).toBeGreaterThan(0.5);
    expect([edge.viewerElo, edge.oppElo]).toEqual([900, 1400]);
  });

  it('calls a dead heat for the left side', () => {
    const left = { ...stats(), eloRating: 1000 };
    const edge = computeRaceEdge(left, { ...stats(), eloRating: 1000 }, race);
    expect(edge.viewer).toBe(left);
    expect(edge.prob).toBe(0.5);
  });

  it('is even without a track', () => {
    expect(computeRaceEdge(stats(), stats(), null).prob).toBe(0.5);
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
