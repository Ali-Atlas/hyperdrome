/**
 * Writes the engine golden files: `tests/golden/races.json` (20 seeded races covering every
 * weather, every time of day, 6 tracks across the brackets and the three legendary specials) and
 * `tests/golden/stats-hash.json` (statsHash vectors the contract tests assert too).
 *
 * Run once; rerun only when an engine change is meant to alter results, and give the reason in the
 * PR (ENGINEERING.md section 3). Usage: `node scripts/generate-golden.mjs`.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { raceDrone } from '../lib/game-engine/mods.js';
import { fromState } from '../lib/game-engine/prng.js';
import { TIME_OF_DAY, WEATHER, simulateRace } from '../lib/game-engine/race-simulator.js';
import { sha256, toHex } from '../lib/game-engine/sha256.js';
import { statsHash } from '../lib/game-engine/stats-hash.js';
import { statsFromArray } from '../lib/game-engine/templates.js';

const GOLDEN_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'tests', 'golden');

/** Six tracks across the brackets (SPEC.md 2.9), with the drone level used on each. */
const TRACKS = [
  { id: 0, level: 3, track: { straights: 2, turns: 2, difficulty: 1, length: 'short' } },
  { id: 3, level: 5, track: { straights: 4, turns: 4, difficulty: 3, length: 'medium' } },
  { id: 5, level: 8, track: { straights: 4, turns: 5, difficulty: 4, length: 'medium' } },
  { id: 7, level: 10, track: { straights: 4, turns: 6, difficulty: 5, length: 'long' } },
  { id: 10, level: 13, track: { straights: 3, turns: 8, difficulty: 7, length: 'long' } },
  { id: 15, level: 18, track: { straights: 2, turns: 8, difficulty: 10, length: 'long' } },
];

/** Mod template ids per race as [A, B]: each legendary special twice, common to epic, and none. */
const MODS = [
  [24, 0],
  [0, 25],
  [26, 11],
  [1, 24],
  [25, 19],
  [0, 26],
  [21, 0],
  [11, 1],
  [0, 0],
  [19, 22],
  [24, 26],
  [13, 0],
  [0, 14],
  [25, 25],
  [2, 23],
  [26, 3],
  [0, 0],
  [16, 5],
  [24, 0],
  [0, 18],
];

/**
 * Deterministic stats within the level's per-stat cap and stat budget.
 * @param {() => number} rand
 * @param {number} level
 * @returns {number[]}
 */
function statsFor(rand, level) {
  const cap = Math.min(100, 10 + Math.floor(4.5 * level));
  const budget = 9 + 20 * level;
  const stats = Array.from({ length: 9 }, () => 1);
  let left = budget - 9;
  while (left > 0) {
    const i = Math.floor(rand() * 9);
    if (stats[i] < cap) {
      stats[i] += 1;
      left -= 1;
    } else if (stats.every((s) => s >= cap)) {
      break;
    }
  }
  return stats;
}

function races() {
  const rand = fromState([0x48594452, 0x4f44524f, 0x4d45474f, 0x4c44454e]).nextUnit;
  return MODS.map(([modA, modB], i) => {
    const { id: trackId, level, track } = TRACKS[i % TRACKS.length];
    const seed = toHex(sha256(new TextEncoder().encode(`hyperdrome-golden-${i}`)));
    const statsA = statsFor(rand, level);
    const statsB = statsFor(rand, level);
    const input = {
      seed,
      raceId: `golden:${i}`,
      statsA,
      modA,
      statsB,
      modB,
      trackId,
      track,
      weather: WEATHER[i % WEATHER.length],
      timeOfDay: TIME_OF_DAY[i % TIME_OF_DAY.length],
    };
    const expected = simulateRace({
      seed,
      raceId: input.raceId,
      droneA: raceDrone(statsFromArray(statsA), modA),
      droneB: raceDrone(statsFromArray(statsB), modB),
      track,
      weather: input.weather,
      timeOfDay: input.timeOfDay,
    });
    return { input, expected };
  });
}

function statsHashVectors() {
  const cases = [
    {
      note: 'all stats 1, nothing equipped: testnet d:1 stats_hash',
      stats: [1, 1, 1, 1, 1, 1, 1, 1, 1],
      mod: 0,
      skin: 0,
    },
    {
      note: 'starter kit equipped: a common mod and Ember',
      stats: [1, 1, 1, 1, 1, 1, 1, 1, 1],
      mod: 3,
      skin: 4,
    },
    {
      note: 'mixed stats, rare mod, no skin',
      stats: [14, 9, 3, 1, 1, 1, 1, 1, 1],
      mod: 11,
      skin: 0,
    },
    {
      note: 'level 20 maxed, legendary mod and skin',
      stats: [100, 100, 100, 100, 100, 100, 100, 100, 9],
      mod: 26,
      skin: 32,
    },
    {
      note: 'u16 little-endian check',
      stats: [7, 13, 21, 34, 55, 89, 1, 2, 3],
      mod: 258,
      skin: 513,
    },
  ];
  return cases.map((c) => ({ ...c, hex: statsHash(c.stats, c.mod, c.skin) }));
}

/**
 * @param {string} name
 * @param {unknown} value
 */
function write(name, value) {
  const path = join(GOLDEN_DIR, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  process.stdout.write(`wrote ${path}\n`);
}

write('races.json', { engine: 'SPEC.md 5', races: races() });
write('stats-hash.json', {
  encoding: 'sha256(9 stat bytes ++ u16 LE mod template ++ u16 LE skin template)',
  vectors: statsHashVectors(),
});
