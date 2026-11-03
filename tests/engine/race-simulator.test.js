import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { raceDrone } from '../../lib/game-engine/mods.js';
import { fromState } from '../../lib/game-engine/prng.js';
import { scoreSegment, simulateRace, traceRace } from '../../lib/game-engine/race-simulator.js';
import { statsFromArray } from '../../lib/game-engine/templates.js';

/** @typedef {import('../../lib/game-engine/race-simulator.js').RaceInput} RaceInput */

/**
 * @typedef {object} GoldenRace
 * @property {{ seed: string, raceId: string, statsA: number[], modA: number, statsB: number[], modB: number, trackId: number, track: RaceInput['track'], weather: string, timeOfDay: string }} input
 * @property {import('../../lib/game-engine/race-simulator.js').RaceResult} expected
 */

/** @type {{ races: GoldenRace[] }} */
const golden = JSON.parse(readFileSync(new URL('../golden/races.json', import.meta.url), 'utf8'));

/**
 * @param {GoldenRace['input']} g
 * @returns {RaceInput}
 */
const toInput = (g) => ({
  seed: g.seed,
  raceId: g.raceId,
  droneA: raceDrone(statsFromArray(g.statsA), g.modA),
  droneB: raceDrone(statsFromArray(g.statsB), g.modB),
  track: g.track,
  weather: g.weather,
  timeOfDay: g.timeOfDay,
});

const sample = toInput(golden.races[2].input);

describe('simulateRace', () => {
  it('returns integer milliseconds and a client-safe log', () => {
    const r = simulateRace(sample);
    expect(['a', 'b']).toContain(r.winner);
    expect(Number.isInteger(r.timeAms) && Number.isInteger(r.timeBms)).toBe(true);
    expect(r.winner).toBe(r.timeAms <= r.timeBms ? 'a' : 'b');
    for (const entry of r.log) {
      expect(Object.keys(entry).sort()).toEqual(['gapMs', 'lap', 'type']);
      expect(Number.isInteger(entry.gapMs)).toBe(true);
    }
    const perLap = sample.track.straights + sample.track.turns;
    expect(r.log).toHaveLength(3 * perLap);
    expect(r.log.map((e) => e.lap)).toEqual([1, 2, 3].flatMap((lap) => Array(perLap).fill(lap)));
  });

  it('is byte-identical across 1,000 runs of the same input', () => {
    const first = JSON.stringify(simulateRace(sample));
    for (let i = 0; i < 1000; i++) expect(JSON.stringify(simulateRace(sample))).toBe(first);
  });

  it('changes with the seed and the race id', () => {
    const base = JSON.stringify(simulateRace(sample));
    expect(JSON.stringify(simulateRace({ ...sample, raceId: `${sample.raceId}x` }))).not.toBe(base);
    expect(JSON.stringify(simulateRace({ ...sample, seed: 'cd'.repeat(32) }))).not.toBe(base);
  });

  it('replays the golden set exactly', () => {
    expect(golden.races).toHaveLength(20);
    for (const { input, expected } of golden.races) {
      expect(simulateRace(toInput(input)), input.raceId).toEqual(expected);
    }
  });
});

describe('legendary specials (SPEC.md 2.4)', () => {
  const stats = statsFromArray([30, 30, 30, 30, 20, 10, 20, 20, 40]);
  const plain = { ...stats, special: null };

  it('Phantom Drive: no battery fade on lap 1, normal fade after', () => {
    const phantom = { ...stats, special: /** @type {const} */ ('phantom_drive') };
    expect(scoreSegment(phantom, 'standard_str', 1, 1.2, 'clear', 'day')).toBeGreaterThan(
      scoreSegment(plain, 'standard_str', 1, 1.2, 'clear', 'day')
    );
    expect(scoreSegment(phantom, 'standard_str', 2, 1.2, 'clear', 'day')).toBe(
      scoreSegment(plain, 'standard_str', 2, 1.2, 'clear', 'day')
    );
  });

  it('Storm Rider: halves the loss from a condition multiplier below 1', () => {
    const storm = { ...stats, special: /** @type {const} */ ('storm_rider') };
    // rain multiplier clamp(20/50) = 0.5 becomes 0.75 for Storm Rider.
    const ratio =
      scoreSegment(storm, 'standard_str', 2, 1.0, 'rain', 'day') /
      scoreSegment(plain, 'standard_str', 2, 1.0, 'rain', 'day');
    expect(ratio).toBeCloseTo(0.75 / 0.5, 10);
    expect(scoreSegment(storm, 'standard_str', 2, 1.0, 'clear', 'day')).toBe(
      scoreSegment(plain, 'standard_str', 2, 1.0, 'clear', 'day')
    );
  });

  it('Quantum Sync: lower turn noise at the same seed', () => {
    const quantum = { ...stats, special: /** @type {const} */ ('quantum_sync') };
    const base = { ...sample, droneA: plain, droneB: plain };
    const withSync = traceRace({ ...base, droneA: quantum }).segments;
    const without = traceRace(base).segments;
    withSync.forEach((s, i) => {
      if (s.type === 'straight') expect(s.timeA).toBe(without[i].timeA);
      expect(s.timeB).toBe(without[i].timeB);
    });
    const spread = (/** @type {typeof without} */ segs) =>
      segs
        .filter((s) => s.type === 'turn')
        .reduce((sum, s) => sum + Math.abs(s.timeA - s.timeB), 0);
    expect(spread(withSync)).toBeLessThan(spread(without));
  });
});

describe('baseline parity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hd-baseline-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('draws in exactly the pre-hackathon order (same segments and times without mods)', async () => {
    const source = execFileSync(
      'git',
      ['show', 'pre-hackathon:lib/game-engine/race-simulator.js'],
      { encoding: 'utf8' }
    );
    const file = join(dir, 'race-simulator.mjs');
    writeFileSync(file, source);
    /** @type {{ simulateRace: Function }} */
    const baseline = await import(pathToFileURL(file).href);
    const pick = fromState([11, 22, 33, 44]).nextUnit;
    const originalRandom = Math.random;
    try {
      for (let i = 0; i < 200; i++) {
        const { input } = golden.races[i % golden.races.length];
        const g = { ...input, raceId: `parity:${i}`, modA: 0, modB: 0 };
        g.statsA = g.statsA.map((s) => Math.min(100, s + Math.floor(pick() * 10)));
        const ours = traceRace(toInput(g));
        const stream = traceRaceStream(toInput(g));
        Math.random = stream;
        const theirs = baseline.simulateRace(
          { ...toInput(g).droneA, id: 'A' },
          { ...toInput(g).droneB, id: 'B' },
          g.track,
          g.weather,
          g.timeOfDay
        );
        Math.random = originalRandom;
        expect(
          theirs.raceLog.map((/** @type {any} */ s) => [
            s.lap,
            s.type,
            s.subtype,
            s.drone1Time,
            s.drone2Time,
          ])
        ).toEqual(
          ours.segments.map((s) => [
            s.lap,
            s.type,
            s.subtype,
            Number(s.timeA.toFixed(4)),
            Number(s.timeB.toFixed(4)),
          ])
        );
        expect([theirs.drone1Time, theirs.drone2Time]).toEqual([
          Number(ours.totalA.toFixed(4)),
          Number(ours.totalB.toFixed(4)),
        ]);
      }
    } finally {
      Math.random = originalRandom;
    }
  });
});

/**
 * The race PRNG for `input`, rebuilt from node:crypto, as a Math.random replacement for the baseline.
 * @param {RaceInput} input
 * @returns {() => number}
 */
function traceRaceStream(input) {
  const digest = createHash('sha256')
    .update(Buffer.concat([Buffer.from(input.seed, 'hex'), Buffer.from(input.raceId, 'utf8')]))
    .digest();
  return fromState([0, 1, 2, 3].map((i) => digest.readUInt32LE(i * 4))).nextUnit;
}
