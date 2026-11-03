import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  allocateStatsSchema,
  createListingSchema,
  paginationSchema,
  toggleDroneSchema,
} from '../lib/validators/index.js';

// Moved from the baseline lib/game-engine/economy.test.js (T4).
describe('Zod validators', () => {
  it('allocateStats accepts a uuid and stat changes, rejects a bad uuid', () => {
    expect(
      allocateStatsSchema.safeParse({
        drone_id: randomUUID(),
        stat_changes: { speed: 5, turning: 3, night_vision: 2 },
      }).success
    ).toBe(true);
    expect(
      allocateStatsSchema.safeParse({ drone_id: 'not-a-uuid', stat_changes: { speed: 5 } }).success
    ).toBe(false);
  });

  it('toggleDrone and createListing shapes', () => {
    expect(toggleDroneSchema.safeParse({ drone_id: randomUUID(), active: true }).success).toBe(
      true
    );
    expect(createListingSchema.safeParse({ item_type: 'drone', price: 500 }).success).toBe(false);
  });

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
