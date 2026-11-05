import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TRACKS, tracksForLevel } from '../../lib/game-engine/tracks.js';

/** Parses `track(id, "name", (min, max), d, (straights, turns), LENGTH_X, art)` calls. */
function contractTracks() {
  const src = readFileSync('contracts/hyperdrome/src/constants/tables.rs', 'utf8');
  const body = src.slice(src.indexOf('pub const TRACKS'), src.indexOf('pub const WEATHER'));
  const re =
    /track\(\s*(\d+),\s*"([^"]+)",\s*\((\d+),\s*(\d+)\),\s*(\d+),\s*\((\d+),\s*(\d+)\),\s*LENGTH_(\w+),/g;
  return [...body.matchAll(re)].map((m) => ({
    id: Number(m[1]),
    name: m[2],
    minLevel: Number(m[3]),
    maxLevel: Number(m[4]),
    difficulty: Number(m[5]),
    straights: Number(m[6]),
    turns: Number(m[7]),
    length: m[8].toLowerCase(),
  }));
}

describe('track table', () => {
  it('mirrors the 16 tracks of constants/tables.rs', () => {
    const rust = contractTracks();
    expect(rust).toHaveLength(16);
    expect(TRACKS.map((t) => ({ ...t }))).toEqual(rust);
    TRACKS.forEach((t, i) => expect(t.id).toBe(i));
  });

  it('gives each level its SPEC 2.9 set, with 20+ on the 16-20 set', () => {
    expect(tracksForLevel(1).map((t) => t.id)).toEqual([0, 1, 2, 3]);
    expect(tracksForLevel(5).map((t) => t.id)).toEqual([0, 1, 2, 3]);
    expect(tracksForLevel(6).map((t) => t.id)).toEqual([4, 5, 6, 7]);
    expect(tracksForLevel(15).map((t) => t.id)).toEqual([8, 9, 10, 11]);
    expect(tracksForLevel(20).map((t) => t.id)).toEqual([12, 13, 14, 15]);
    expect(tracksForLevel(27).map((t) => t.id)).toEqual([12, 13, 14, 15]);
  });
});
