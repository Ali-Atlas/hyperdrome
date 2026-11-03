import { describe, expect, it } from 'vitest';
import { computeLoserPayout, computeWinnerPayout } from '../../lib/game-engine/economy.js';
import { raceDrone } from '../../lib/game-engine/mods.js';
import { fromState } from '../../lib/game-engine/prng.js';
import {
  MAX_SEGMENT_TIME,
  MIN_SEGMENT_TIME,
  SCORE_FLOOR,
  TIME_OF_DAY,
  WEATHER,
  traceRace,
} from '../../lib/game-engine/race-simulator.js';
import { STAT_KEYS, statsFromArray } from '../../lib/game-engine/templates.js';

/** SPEC.md 2.9 tracks as [straights, turns, difficulty, length]. */
const TRACKS = [
  [2, 2, 1, 'short'],
  [3, 3, 2, 'medium'],
  [2, 2, 2, 'short'],
  [4, 4, 3, 'medium'],
  [4, 4, 3, 'medium'],
  [4, 5, 4, 'medium'],
  [3, 5, 4, 'medium'],
  [4, 6, 5, 'long'],
  [3, 7, 6, 'long'],
  [2, 6, 6, 'medium'],
  [3, 8, 7, 'long'],
  [4, 7, 7, 'long'],
  [4, 8, 8, 'long'],
  [3, 9, 9, 'long'],
  [2, 10, 9, 'long'],
  [2, 8, 10, 'long'],
];

const rand = fromState([0xdeadbeef, 0x12345678, 0x0badf00d, 0x87654321]).nextUnit;
/** @param {number} n */
const int = (n) => Math.floor(rand() * n);
const hex32 = () =>
  Array.from({ length: 32 }, () => int(256).toString(16).padStart(2, '0')).join('');
/** Stats 1-100 with the extremes over-represented. */
const randomStats = () =>
  statsFromArray(Array.from({ length: 9 }, () => [1, 100][int(4)] ?? 1 + int(100)));

describe('engine properties over 1,000 random races', () => {
  it('scores, segment times, totals, payouts and effective stats stay in bounds', () => {
    for (let i = 0; i < 1000; i++) {
      const [straights, turns, difficulty, length] = TRACKS[int(TRACKS.length)];
      const droneA = raceDrone(randomStats(), int(27));
      const droneB = raceDrone(randomStats(), int(27));
      for (const d of [droneA, droneB]) {
        for (const k of STAT_KEYS) {
          expect(d[k]).toBeGreaterThanOrEqual(1);
          expect(d[k]).toBeLessThanOrEqual(100);
        }
      }
      const trace = traceRace({
        seed: hex32(),
        raceId: `prop:${i}`,
        droneA,
        droneB,
        track: {
          straights: Number(straights),
          turns: Number(turns),
          difficulty: Number(difficulty),
          length: String(length),
        },
        weather: WEATHER[int(WEATHER.length)],
        timeOfDay: TIME_OF_DAY[int(TIME_OF_DAY.length)],
      });

      let sumA = 0;
      let sumB = 0;
      for (const s of trace.segments) {
        expect(s.scoreA).toBeGreaterThanOrEqual(SCORE_FLOOR);
        expect(s.scoreB).toBeGreaterThanOrEqual(SCORE_FLOOR);
        for (const t of [s.timeA, s.timeB]) {
          expect(t).toBeGreaterThanOrEqual(MIN_SEGMENT_TIME);
          expect(t).toBeLessThanOrEqual(MAX_SEGMENT_TIME);
        }
        sumA += s.timeA;
        sumB += s.timeB;
      }
      const { result } = trace;
      expect(result.timeAms).toBe(Math.round(sumA * 1000));
      expect(result.timeBms).toBe(Math.round(sumB * 1000));
      expect(result.log).toHaveLength(trace.segments.length);

      const winnerA = result.winner === 'a';
      const level = 1 + int(20);
      const winner = computeWinnerPayout({
        winnerLevel: level,
        difficulty: Number(difficulty),
        winnerElo: 600 + int(1200),
        loserElo: 600 + int(1200),
        winnerTimeMs: winnerA ? result.timeAms : result.timeBms,
        loserTimeMs: winnerA ? result.timeBms : result.timeAms,
      });
      expect(winner).toBeGreaterThanOrEqual(3);
      expect(computeLoserPayout({ loserLevel: level })).toBeGreaterThanOrEqual(1);
    }
  }, 30_000);
});
