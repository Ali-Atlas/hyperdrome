import { describe, expect, it } from 'vitest';
import { paginationSchema } from '../lib/validators/index.js';

// Moved from the baseline lib/game-engine/economy.test.js (T4).
describe('Zod validators', () => {
  it('pagination coerces strings, applies defaults and rejects negatives', () => {
    const parsed = paginationSchema.safeParse({ page: '2', limit: '50' });
    expect(parsed.success).toBe(true);
    expect([parsed.data?.page, parsed.data?.limit, parsed.data?.sort_order]).toEqual([
      2,
      50,
      'desc',
    ]);
    expect(paginationSchema.safeParse({ page: '-1' }).success).toBe(false);
  });
});
