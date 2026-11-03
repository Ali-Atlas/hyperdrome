import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyMod, applyPct, raceDrone } from '../../lib/game-engine/mods.js';
import {
  MOD_TEMPLATES,
  STAT_KEYS,
  modTemplate,
  statsFromArray,
  statsToArray,
} from '../../lib/game-engine/templates.js';

/** SPEC.md 2.5, in order: [name, rarity, bonus stat or special, bonus pct, penalty stat, penalty pct]. */
const SPEC_MODS = [
  ['Streamline Plate', 'common', 'speed', 2, 'turning', 1],
  ['Grip Pads', 'common', 'turning', 2, 'speed', 1],
  ['Quick Charge', 'common', 'batteryCapacity', 2, 'durability', 1],
  ['Shock Absorber', 'common', 'durability', 2, 'acceleration', 1],
  ['Steady Module', 'common', 'consistency', 2, 'speed', 1],
  ['Night Lens', 'common', 'nightVision', 2, 'rainHandling', 1],
  ['Rain Shield', 'common', 'rainHandling', 2, 'windResistance', 1],
  ['Wind Fin', 'common', 'windResistance', 2, 'nightVision', 1],
  ['Light Frame', 'common', 'acceleration', 2, 'durability', 1],
  ['Tracker Coil', 'common', 'turning', 2, 'batteryCapacity', 1],
  ['Aero Shell', 'rare', 'speed', 4, 'turning', 2],
  ['Grip Coating', 'rare', 'turning', 4, 'acceleration', 2],
  ['Storm Plating', 'rare', 'rainHandling', 4, 'speed', 2],
  ['Night Optics', 'rare', 'nightVision', 4, 'batteryCapacity', 2],
  ['Turbo Intake', 'rare', 'acceleration', 4, 'consistency', 2],
  ['Endurance Core', 'rare', 'batteryCapacity', 4, 'speed', 2],
  ['Aileron Kit', 'rare', 'windResistance', 4, 'acceleration', 2],
  ['Stabilizer Brace', 'rare', 'consistency', 4, 'speed', 2],
  ['Plasma Core', 'epic', 'acceleration', 6, 'consistency', 4],
  ['Stealth Aero', 'epic', 'speed', 6, 'durability', 4],
  ['Typhoon Module', 'epic', 'rainHandling', 8, 'speed', 5],
  ['Predator Lens', 'epic', 'nightVision', 8, 'batteryCapacity', 5],
  ['Iron Hull', 'epic', 'durability', 7, 'turning', 4],
  ['Phantom Drive', 'legendary', 'phantom_drive', 0, 'windResistance', 5],
  ['Quantum Sync', 'legendary', 'quantum_sync', 0, 'speed', 4],
  ['Storm Rider', 'legendary', 'storm_rider', 0, 'acceleration', 6],
];

/** Contract stat constant names in `constants/catalog.rs`, mapped to engine stat keys. */
const RUST_STATS = {
  SPEED: 'speed',
  TURNING: 'turning',
  ACCELERATION: 'acceleration',
  DURABILITY: 'durability',
  NIGHT_VISION: 'nightVision',
  BATTERY: 'batteryCapacity',
  RAIN_HANDLING: 'rainHandling',
  WIND_RESISTANCE: 'windResistance',
  CONSISTENCY: 'consistency',
};

describe('mod templates', () => {
  it('has the 26 SPEC.md 2.5 mods, 1-based in order', () => {
    expect(MOD_TEMPLATES).toHaveLength(26);
    MOD_TEMPLATES.forEach((t, i) => {
      const [name, rarity, bonusOrSpecial, bonusPct, penaltyStat, penaltyPct] = SPEC_MODS[i];
      expect(t.id).toBe(i + 1);
      expect([t.name, t.rarity, t.bonusPct, t.penaltyStat, t.penaltyPct]).toEqual([
        name,
        rarity,
        bonusPct,
        penaltyStat,
        penaltyPct,
      ]);
      expect(t.rarity === 'legendary' ? t.special : t.bonusStat).toBe(bonusOrSpecial);
    });
    expect(modTemplate(0)).toBeNull();
    expect(modTemplate(27)).toBeNull();
  });

  it('mirrors the contract catalog (contracts/hyperdrome/src/constants/catalog.rs)', () => {
    const rust = readFileSync(
      new URL('../../contracts/hyperdrome/src/constants/catalog.rs', import.meta.url),
      'utf8'
    );
    const statMods = [
      ...rust.matchAll(
        /stat_mod\(\s*(\d+),\s*"([^"]+)",\s*(\w+),\s*\((\w+),\s*(\d+)\),\s*\((\w+),\s*(\d+)\),?\s*\)/g
      ),
    ];
    const specialMods = [
      ...rust.matchAll(/special_mod\(\s*(\d+),\s*"([^"]+)",\s*(\w+),\s*\((\w+),\s*(\d+)\),?\s*\)/g),
    ];
    expect(statMods.length + specialMods.length).toBe(26);
    for (const [, id, name, rarity, bonus, bonusPct, penalty, penaltyPct] of statMods) {
      const t = modTemplate(Number(id));
      expect([
        t?.name,
        t?.rarity,
        t?.bonusStat,
        t?.bonusPct,
        t?.penaltyStat,
        t?.penaltyPct,
      ]).toEqual([
        name,
        rarity.toLowerCase(),
        RUST_STATS[/** @type {keyof typeof RUST_STATS} */ (bonus)],
        Number(bonusPct),
        RUST_STATS[/** @type {keyof typeof RUST_STATS} */ (penalty)],
        Number(penaltyPct),
      ]);
    }
    for (const [, id, name, , penalty, penaltyPct] of specialMods) {
      const t = modTemplate(Number(id));
      expect([t?.name, t?.rarity, t?.penaltyStat, t?.penaltyPct]).toEqual([
        name,
        'legendary',
        RUST_STATS[/** @type {keyof typeof RUST_STATS} */ (penalty)],
        Number(penaltyPct),
      ]);
    }
  });

  it('converts between stat objects and contract-order arrays', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(statsToArray(statsFromArray(arr))).toEqual(arr);
    expect(Object.keys(statsFromArray(arr))).toEqual([...STAT_KEYS]);
  });
});

describe('mod effects (SPEC.md 2.4)', () => {
  it('rounds half up and clamps to 1-100, like the contract', () => {
    expect(applyPct(50, 4)).toBe(52);
    expect(applyPct(50, -2)).toBe(49);
    expect(applyPct(25, 2)).toBe(26);
    expect(applyPct(10, -5)).toBe(10);
    expect(applyPct(1, -6)).toBe(1);
    expect(applyPct(100, 8)).toBe(100);
  });

  it('applies bonus and penalty; legendary mods apply only the penalty', () => {
    const stats = statsFromArray([50, 50, 50, 50, 50, 50, 50, 50, 50]);
    const aero = applyMod(stats, modTemplate(11));
    expect([aero.speed, aero.turning]).toEqual([52, 49]);
    const storm = raceDrone(stats, 26);
    expect([storm.acceleration, storm.special]).toEqual([47, 'storm_rider']);
    expect(raceDrone(stats, 0)).toEqual({ ...stats, special: null });
  });
});
