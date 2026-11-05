import { describe, expect, it } from 'vitest';
import { conditionStats, modFit, statWeights, trackMix } from '../../lib/game-engine/mod-fit.js';
import { TIME_OF_DAY, WEATHER } from '../../lib/game-engine/race-simulator.js';
import { MOD_TEMPLATES, modTemplate } from '../../lib/game-engine/templates.js';
import { TRACKS } from '../../lib/game-engine/tracks.js';

/**
 * Fit of each named template for a race.
 * @param {import('../../lib/game-engine/mod-fit.js').FitRace} race
 * @param {number[]} ids template ids
 */
const fits = (race, ids) =>
  Object.fromEntries(
    ids.map((id) => {
      const t = /** @type {import('../../lib/game-engine/templates.js').ModTemplate} */ (
        modTemplate(id)
      );
      return [t.name, modFit(t, race)];
    })
  );

describe('mod fit score (SPEC 10)', () => {
  it('weights stats by the straights and turns mix of the standard subtypes', () => {
    const w = statWeights({
      track: { straights: 3, turns: 1 },
      weather: 'clear',
      timeOfDay: 'day',
    });
    expect(trackMix({ straights: 3, turns: 1 })).toBe(0.75);
    expect(w.speed).toBeCloseTo(0.375, 9);
    expect(w.acceleration).toBeCloseTo(0.275, 9);
    expect(w.windResistance).toBeCloseTo(0.15, 9);
    expect(w.turning).toBeCloseTo(0.125, 9);
    expect(w.durability).toBeCloseTo(0.075, 9);
    for (const stat of /** @type {const} */ ([
      'nightVision',
      'batteryCapacity',
      'rainHandling',
      'consistency',
    ])) {
      expect(w[stat]).toBe(0);
    }
  });

  it('adds 0.5 to the stat each condition tests', () => {
    expect(conditionStats('rain', 'day')).toEqual(['rainHandling']);
    expect(conditionStats('heavy_rain', 'night')).toEqual(['rainHandling', 'nightVision']);
    expect(conditionStats('fog', 'dawn')).toEqual(['nightVision']);
    expect(conditionStats('haze', 'dusk')).toEqual(['nightVision']);
    expect(conditionStats('wind', 'day')).toEqual(['windResistance']);
    expect(conditionStats('clear', 'day')).toEqual([]);
    expect(conditionStats('clouds', 'dusk')).toEqual([]);
    const windy = statWeights({ track: TRACKS[3], weather: 'wind', timeOfDay: 'day' });
    expect(windy.windResistance).toBeCloseTo(0.6, 9);
  });

  it('a straight track in clear weather: speed mods lead, turn mods and Quantum Sync trail', () => {
    const race = { track: { straights: 3, turns: 1 }, weather: 'clear', timeOfDay: 'day' };
    expect(fits(race, [11, 2, 9, 8, 6, 24, 25, 26])).toEqual({
      'Aero Shell': 1.25,
      'Grip Pads': -0.125,
      'Light Frame': 0.475,
      'Wind Fin': 0.3,
      'Night Lens': 0,
      'Phantom Drive': 1.25,
      'Quantum Sync': -1.5,
      'Storm Rider': -1.65,
    });
  });

  it('a turn track at night: Apex Descent (2 straights, 10 turns), clear, night', () => {
    const race = { track: TRACKS[14], weather: 'clear', timeOfDay: 'night' };
    expect(fits(race, [12, 23, 14, 22, 8, 24, 25, 26])).toEqual({
      'Grip Coating': 1.233333,
      'Iron Hull': 0.083333,
      'Night Optics': 2,
      'Predator Lens': 4,
      'Wind Fin': -0.433333,
      'Phantom Drive': 1.833333,
      'Quantum Sync': 1.666667,
      'Storm Rider': 1.7,
    });
  });

  it('a rain race: The Grid (4 straights, 4 turns), rain, day', () => {
    const race = { track: TRACKS[3], weather: 'rain', timeOfDay: 'day' };
    expect(fits(race, [7, 13, 21, 6, 24, 25, 26])).toEqual({
      'Rain Shield': 0.9,
      'Storm Plating': 1.5,
      'Typhoon Module': 2.75,
      'Night Lens': -0.5,
      'Phantom Drive': 1.5,
      'Quantum Sync': -1,
      'Storm Rider': 1.5,
    });
    expect(modFit(MOD_TEMPLATES[20], { ...race, weather: 'heavy_rain' })).toBe(2.75);
  });

  it('can be exactly 0: night vision mods off their condition, speed-for-turning mods at mix 1/3', () => {
    /** @type {Set<number>} */
    const zero = new Set();
    for (const track of TRACKS) {
      for (const weather of WEATHER) {
        for (const timeOfDay of TIME_OF_DAY) {
          const tested = conditionStats(weather, timeOfDay);
          for (const t of MOD_TEMPLATES) {
            if (modFit(t, { track, weather, timeOfDay }) !== 0) continue;
            zero.add(t.id);
            if (t.bonusStat === 'nightVision') {
              // Neither its bonus stat nor its penalty stat carries weight in the race.
              expect(tested).not.toContain('nightVision');
              expect(tested).not.toContain(t.penaltyStat);
            } else {
              // 4 straights and 8 turns (Voltage Loop): the speed gain equals the turning loss.
              expect([t.bonusStat, t.penaltyStat, track.id]).toEqual(['speed', 'turning', 12]);
            }
          }
        }
      }
    }
    // Streamline Plate, Night Lens, Aero Shell, Night Optics, Predator Lens.
    expect([...zero].sort((a, b) => a - b)).toEqual([1, 6, 11, 14, 22]);
  });
});
