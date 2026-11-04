import { describe, expect, it } from 'vitest';
import {
  playerSlugSchema,
  slugFromUsername,
  slugWithSuffix,
} from '../../lib/validators/player-slug.js';

describe('player slug (create_player rule [a-z0-9]{3,20})', () => {
  it('accepts 3-20 lowercase letters and digits only', () => {
    for (const ok of ['abc', 'pilot42', 'a'.repeat(20)]) {
      expect(playerSlugSchema.safeParse(ok).success).toBe(true);
    }
    for (const bad of ['ab', 'a'.repeat(21), 'Alice', 'pilot_x', 'p-ilot', 'émile', '']) {
      expect(playerSlugSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('derives the slug from the username', () => {
    expect(slugFromUsername('ALICE')).toBe('alice');
    expect(slugFromUsername('PILOT_X7K2')).toBe('pilotx7k2');
    expect(slugFromUsername('JOHN-4821')).toBe('john4821');
    expect(slugFromUsername('AVERYLONGUSERNAMEFROMEMAIL')).toBe('averylongusernamefro');
    expect(slugFromUsername('AB')).toBe('pilotab');
    expect(slugFromUsername('__')).toBe('pilot');
    expect(slugFromUsername(null)).toBe('pilot');
  });

  it('adds a 4-hex suffix and stays within 20 characters', () => {
    expect(slugWithSuffix('alice', () => 'beef')).toBe('alicebeef');
    expect(slugWithSuffix('averylongusernamefro', () => '0a1b')).toBe(
      'averylongusername0a1b'.slice(0, 16) + '0a1b'
    );
    expect(slugWithSuffix('averylongusernamefro')).toMatch(/^averylongusernam[0-9a-f]{4}$/);
    expect(() => slugWithSuffix('alice', () => 'XYZ!')).toThrow();
  });
});
