import { randomBytes } from 'node:crypto';
import { z } from 'zod';

/** A player slug as `create_player` accepts it (SPEC.md 4.4): `[a-z0-9]{3,20}`. */
export const playerSlugSchema = z.string().regex(/^[a-z0-9]{3,20}$/, 'bad slug');

/** Length of the hex suffix added when a slug is taken. */
export const SLUG_SUFFIX_HEX = 4;

/** Used when a username has fewer than 3 usable characters. */
const FALLBACK_BASE = 'pilot';

/**
 * The base slug for a username: lowercase letters and digits only, cut to 20 characters, and
 * `pilot` in front when fewer than 3 remain.
 * @param {string | null | undefined} username
 * @returns {string}
 */
export function slugFromUsername(username) {
  const cleaned = (username ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const base = cleaned.length >= 3 ? cleaned : `${FALLBACK_BASE}${cleaned}`;
  return playerSlugSchema.parse(base.slice(0, 20));
}

/**
 * A slug with a random 4-hex suffix, for a base that is already taken on chain (`exists`). The
 * base is cut to 16 characters so the result stays within 20.
 * @param {string} base a slug from {@link slugFromUsername}
 * @param {() => string} [hex] suffix source (tests pass a fixed one)
 * @returns {string}
 */
export function slugWithSuffix(base, hex = () => randomBytes(SLUG_SUFFIX_HEX / 2).toString('hex')) {
  return playerSlugSchema.parse(`${base.slice(0, 20 - SLUG_SUFFIX_HEX)}${hex()}`);
}
