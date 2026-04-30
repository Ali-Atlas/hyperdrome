import { and, asc, desc, eq, gt, inArray, lt, or } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { withApiHandler, ok, ApiError } from '@/lib/api/response.js';

const { races, drones } = schema;

/**
 * GET /api/races/[raceId]/adjacent
 *
 * Returns the IDs of the user's adjacent COMPLETED races, ordered by
 * createdAt:
 *
 *   - `prevRaceId`: the user's most recent completed race BEFORE the
 *     anchor race. `null` when the anchor is the user's oldest.
 *   - `nextRaceId`: the user's next completed race AFTER the anchor.
 *     `null` when the anchor is the user's newest.
 *
 * "User's race" = any race where `drone1Id` or `drone2Id` references a
 * drone owned by the authenticated user.
 *
 * Status filter pinned to 'completed' so the chronological arrows on
 * the race-detail page never jump into a pending matchup. The current
 * race itself is excluded via strict `<` / `>` comparisons against the
 * anchor's `createdAt`.
 */
export const GET = withApiHandler(async ({ session, params }) => {
  const userId = session.user.id;
  const raceId = params?.raceId;
  if (!raceId) throw new ApiError('Missing raceId', 400);

  /* Anchor lookup: we need this race's createdAt to scope the prev/next
   * queries against. A 404 here means the URL points at a race that
   * was deleted or never existed. */
  const [anchor] = await db
    .select({ createdAt: races.createdAt })
    .from(races)
    .where(eq(races.id, raceId))
    .limit(1);
  if (!anchor) throw new ApiError('Race not found', 404);

  /* User's drone IDs. Bail out early if the user owns nothing - the
   * inArray() filter would otherwise be passed an empty list and
   * produce a query that's either malformed or trivially-true
   * depending on the driver, neither of which is what we want. */
  const ownedDrones = await db
    .select({ id: drones.id })
    .from(drones)
    .where(eq(drones.userId, userId));
  if (ownedDrones.length === 0) {
    return ok({ prevRaceId: null, nextRaceId: null });
  }
  const droneIds = ownedDrones.map((d) => d.id);
  const userRaceFilter = or(
    inArray(races.drone1Id, droneIds),
    inArray(races.drone2Id, droneIds),
  );

  const [prev] = await db
    .select({ id: races.id })
    .from(races)
    .where(
      and(
        eq(races.status, 'completed'),
        lt(races.createdAt, anchor.createdAt),
        userRaceFilter,
      ),
    )
    .orderBy(desc(races.createdAt))
    .limit(1);

  const [next] = await db
    .select({ id: races.id })
    .from(races)
    .where(
      and(
        eq(races.status, 'completed'),
        gt(races.createdAt, anchor.createdAt),
        userRaceFilter,
      ),
    )
    .orderBy(asc(races.createdAt))
    .limit(1);

  return ok({
    prevRaceId: prev?.id ?? null,
    nextRaceId: next?.id ?? null,
  });
});
