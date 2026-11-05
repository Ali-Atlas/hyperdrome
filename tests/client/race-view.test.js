/**
 * The results view's reading of a settled race (lib/client/race-view.js): the drones as they
 * raced from the settle snapshots, and the client-safe log as segment rows.
 */
import { describe, expect, it } from 'vitest';
import { asRaced, racedDrone, segmentRows } from '../../lib/client/race-view.js';

const cached = {
  id: 'd1',
  name: 'VORTEX-V1',
  level: 5,
  eloRating: 1040,
  speed: 30,
  turning: 10,
  acceleration: 20,
  durability: 6,
  nightVision: 4,
  batteryCapacity: 8,
  rainHandling: 4,
  windResistance: 12,
  consistency: 6,
  appliedMod: { name: 'Aero Shell', rarity: 'rare', description: null },
  appliedSkin: { name: 'Cobalt' },
};
const snapshot = {
  stats: [25, 9, 17, 6, 4, 7, 4, 11, 6],
  modTemplate: 9,
  skinTemplate: 4,
  level: 4,
  elo: 1012,
};

describe('racedDrone', () => {
  it('shows the stats, level and mod of the snapshot, and keeps the rest of the cached drone', () => {
    const raced = racedDrone(cached, snapshot);
    expect(raced).toMatchObject({
      id: 'd1',
      name: 'VORTEX-V1',
      level: 4,
      speed: 25,
      turning: 9,
      acceleration: 17,
      durability: 6,
      nightVision: 4,
      batteryCapacity: 7,
      rainHandling: 4,
      windResistance: 11,
      consistency: 6,
      appliedMod: { name: 'Light Frame', rarity: 'common' },
      appliedSkin: { name: 'Cobalt' },
      eloRating: 1040,
    });
  });

  it('shows no mod when the drone raced without one', () => {
    expect(racedDrone(cached, { ...snapshot, modTemplate: 0 }).appliedMod).toBeNull();
  });

  it('returns the cached drone when there is no snapshot, and nothing when there is no drone', () => {
    expect(racedDrone(cached, null)).toBe(cached);
    expect(racedDrone(null, snapshot)).toBeNull();
  });
});

describe('segmentRows', () => {
  const log = [
    { lap: 1, type: 'turn', gapMs: 55 },
    { lap: 1, type: 'straight', gapMs: 156 },
    { lap: 2, type: 'turn', gapMs: 116 },
    { lap: 2, type: 'straight', gapMs: 116 },
    { lap: 3, type: 'turn', gapMs: -40 },
  ];

  it('numbers the segments and gives the gap in seconds, its change and each gain', () => {
    const rows = segmentRows(log);
    expect(rows.map((r) => r.segment)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.map((r) => r.gap)).toEqual([0.055, 0.156, 0.116, 0.116, -0.04]);
    expect(rows.map((r) => Math.round(r.step * 1000))).toEqual([55, 101, -40, 0, -156]);
    for (const r of rows) {
      expect(r.drone2Gain).toBe(r.step);
      expect(r.drone1Gain + r.drone2Gain).toBe(0);
    }
    expect(rows[0]).toMatchObject({ lap: 1, type: 'turn', gapMs: 55 });
  });

  it('reads a level segment as 0 for both drones, never -0', () => {
    const level = segmentRows(log)[3];
    expect(Object.is(level.drone1Gain, 0)).toBe(true);
    expect(Object.is(level.drone2Gain, 0)).toBe(true);
  });

  it('is empty for a missing log', () => {
    expect(segmentRows(null)).toEqual([]);
    expect(segmentRows(undefined)).toEqual([]);
  });
});

describe('asRaced', () => {
  const race = {
    id: 'r1',
    status: 'completed',
    drone1: cached,
    drone2: { ...cached, id: 'd2', name: 'ALPHA-D5' },
    snapshotA: snapshot,
    snapshotB: { ...snapshot, level: 1, modTemplate: 0 },
    log: [{ lap: 1, type: 'turn', gapMs: -30 }],
  };

  it('gives a settled race its raced drones and segment rows', () => {
    const view = asRaced(race);
    expect(view.drone1.level).toBe(4);
    expect(view.drone2.level).toBe(1);
    expect(view.drone2.appliedMod).toBeNull();
    expect(view.log).toEqual([
      {
        lap: 1,
        type: 'turn',
        gapMs: -30,
        segment: 1,
        gap: -0.03,
        step: -0.03,
        drone1Gain: 0.03,
        drone2Gain: -0.03,
      },
    ]);
    expect(view.id).toBe('r1');
  });

  it('leaves a pending race, and no race, as they are', () => {
    const pending = { ...race, status: 'pending', snapshotA: null, snapshotB: null, log: null };
    expect(asRaced(pending)).toBe(pending);
    expect(asRaced(null)).toBeNull();
  });
});
