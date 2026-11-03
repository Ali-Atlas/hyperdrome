import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fromSeed, fromState } from '../../lib/game-engine/prng.js';
import { fromHex, sha256, toHex } from '../../lib/game-engine/sha256.js';

describe('sha256', () => {
  it('matches node:crypto on every padding boundary', () => {
    for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 1000]) {
      const bytes = randomBytes(n);
      expect(toHex(sha256(bytes))).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
  });

  it('round-trips hex', () => {
    expect(toHex(fromHex('00ff10'))).toBe('00ff10');
    expect(toHex(fromHex('0xABcd'))).toBe('abcd');
    expect(() => fromHex('abc')).toThrow();
    expect(() => fromHex('zz')).toThrow();
  });
});

describe('xoshiro128**', () => {
  // Outputs of the reference C implementation (prng.di.unimi.it/xoshiro128starstar.c).
  it('matches the reference implementation for state 1, 2, 3, 4', () => {
    const r = fromState([1, 2, 3, 4]);
    const out = Array.from({ length: 10 }, () => r.next32());
    expect(out).toEqual([
      11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849, 3729100597,
      4258142804,
    ]);
  });

  it('replaces an all-zero state with 1, 2, 3, 4', () => {
    const zero = fromState([0, 0, 0, 0]);
    const ref = fromState([1, 2, 3, 4]);
    expect(zero.next32()).toBe(ref.next32());
  });

  it('nextUnit is (next32 >>> 8) / 2^24, in [0, 1)', () => {
    const a = fromState([5, 6, 7, 8]);
    const b = fromState([5, 6, 7, 8]);
    for (let i = 0; i < 1000; i++) {
      const u = a.nextUnit();
      expect(u).toBe((b.next32() >>> 8) / 2 ** 24);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });

  it('fromSeed reads sha256(seed ++ utf8(raceId)) as four little-endian words', () => {
    const seed = 'ab'.repeat(32);
    const raceId = '42:7';
    const digest = createHash('sha256')
      .update(Buffer.concat([Buffer.from(seed, 'hex'), Buffer.from(raceId, 'utf8')]))
      .digest();
    const words = [0, 1, 2, 3].map((i) => digest.readUInt32LE(i * 4));
    expect(fromSeed(seed, raceId).next32()).toBe(fromState(words).next32());
    expect(fromSeed(seed, '42:8').next32()).not.toBe(fromSeed(seed, raceId).next32());
  });
});
