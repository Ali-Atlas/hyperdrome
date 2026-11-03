import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { statsHash } from '../../lib/game-engine/stats-hash.js';

/** @type {{ vectors: { note: string, stats: number[], mod: number, skin: number, hex: string }[] }} */
const golden = JSON.parse(
  readFileSync(new URL('../golden/stats-hash.json', import.meta.url), 'utf8')
);

describe('statsHash', () => {
  it('matches the committed vectors (the contract tests assert the same values)', () => {
    expect(golden.vectors.length).toBeGreaterThanOrEqual(5);
    for (const v of golden.vectors) {
      expect(statsHash(v.stats, v.mod, v.skin), v.note).toBe(v.hex);
    }
  });

  it('is sha256 of 9 stat bytes, u16 LE mod, u16 LE skin', () => {
    const stats = [7, 13, 21, 34, 55, 89, 1, 2, 3];
    const bytes = Buffer.from([...stats, 0x02, 0x01, 0x01, 0x02]);
    expect(statsHash(stats, 258, 513)).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('matches the deployed contract for testnet d:1 (all stats 1, nothing equipped)', () => {
    expect(statsHash([1, 1, 1, 1, 1, 1, 1, 1, 1], 0, 0)).toBe(
      '0955d388dfcaecb9af17a36936bbae472103b419f2195cc0a08e5b649c46a6ba'
    );
  });

  it('rejects malformed input', () => {
    expect(() => statsHash([1, 2, 3], 0, 0)).toThrow();
    expect(() => statsHash([1, 1, 1, 1, 1, 1, 1, 1, 256], 0, 0)).toThrow();
    expect(() => statsHash([1, 1, 1, 1, 1, 1, 1, 1, 1], 65536, 0)).toThrow();
    expect(() => statsHash([1, 1, 1, 1, 1, 1, 1, 1, 1], 0, -1)).toThrow();
  });
});
