/**
 * Race PRNG (SPEC.md 5): xoshiro128** seeded from sha256(seed bytes ++ utf8(raceId)). Every random
 * number a race uses comes from one of these, so a race replays exactly from its seed and race id.
 */

import { fromHex, sha256 } from './sha256.js';

/**
 * @typedef {object} Prng
 * @property {() => number} next32 next 32-bit output as an unsigned integer
 * @property {() => number} nextUnit next value in [0, 1) with 24 bits of precision
 */

/**
 * @param {number} x
 * @param {number} k
 * @returns {number}
 */
const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;

/**
 * xoshiro128** over a 4-word state. An all-zero state is replaced by 1, 2, 3, 4.
 * @param {ArrayLike<number>} words four u32 state words
 * @returns {Prng}
 */
export function fromState(words) {
  const s = Uint32Array.from(words);
  if (s.length !== 4) throw new Error('xoshiro128** needs 4 state words');
  if (s.every((w) => w === 0)) s.set([1, 2, 3, 4]);

  const next32 = () => {
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  };
  const nextUnit = () => (next32() >>> 8) / 2 ** 24;
  return { next32, nextUnit };
}

/**
 * The PRNG for one race: state = first 16 bytes of sha256(seed bytes ++ utf8(raceId)), read as four
 * little-endian u32 words.
 * @param {string} seedHex batch seed, 32 bytes as hex
 * @param {string} raceId `"<batchId>:<index>"`
 * @returns {Prng}
 */
export function fromSeed(seedHex, raceId) {
  const seed = fromHex(seedHex);
  const id = new TextEncoder().encode(raceId);
  const input = new Uint8Array(seed.length + id.length);
  input.set(seed);
  input.set(id, seed.length);
  const digest = sha256(input);
  const view = new DataView(digest.buffer);
  return fromState([0, 1, 2, 3].map((i) => view.getUint32(i * 4, true)));
}
