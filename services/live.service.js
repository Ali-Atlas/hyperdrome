/**
 * The landing page's live strip (SPEC.md 8 `GET /api/live`): the next race, the last settled
 * batch's results and today's numbers, all from the database caches. Public: drone names only, no
 * account or balance.
 */
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/lib/db';
import { raceMarginMs, summarizeDay, utcDayStart } from '@/lib/live/summary.js';
import { getNear } from '@/lib/near';
import { getNextRace } from './race-schedule.service.js';

const { actions, batches, drones, marketplaceListings, packOpens, races } = schema;

/** Results of the last settled batch sent to the strip. */
const RESULT_LIMIT = 5;

/** @typedef {{ db?: any, near?: import('@/lib/near').NearAdapter }} Deps */

/**
 * The newest settled batch's results, in race order.
 * @param {any} db
 * @returns {Promise<{ slot: number, settledAt: Date | null, results: { winner: string, loser: string, marginMs: number | null }[] } | null>}
 */
async function lastBatch(db) {
  const [batch] = await db
    .select({ slot: batches.slot, settledAt: batches.settledAt })
    .from(batches)
    .where(eq(batches.status, 'settled'))
    .orderBy(desc(batches.slot))
    .limit(1);
  if (!batch) return null;
  /** @type {{ drone1Id: string, drone2Id: string, winnerDroneId: string | null, drone1Time: string | null, drone2Time: string | null }[]} */
  const rows = await db
    .select({
      drone1Id: races.drone1Id,
      drone2Id: races.drone2Id,
      winnerDroneId: races.winnerDroneId,
      drone1Time: races.drone1Time,
      drone2Time: races.drone2Time,
    })
    .from(races)
    .where(and(eq(races.batchSlot, batch.slot), eq(races.status, 'completed')))
    .orderBy(asc(races.raceIndex))
    .limit(RESULT_LIMIT);
  const ids = [...new Set(rows.flatMap((r) => [r.drone1Id, r.drone2Id]))];
  /** @type {{ id: string, name: string }[]} */
  const named =
    ids.length > 0
      ? await db
          .select({ id: drones.id, name: drones.name })
          .from(drones)
          .where(inArray(drones.id, ids))
      : [];
  const nameOf = new Map(named.map((d) => [d.id, d.name]));
  const results = rows
    .filter((r) => r.winnerDroneId)
    .map((r) => {
      const loserId = r.winnerDroneId === r.drone1Id ? r.drone2Id : r.drone1Id;
      return {
        winner: nameOf.get(String(r.winnerDroneId)) ?? 'Unknown',
        loser: nameOf.get(loserId) ?? 'Unknown',
        marginMs: raceMarginMs(r.drone1Time, r.drone2Time),
      };
    });
  return { slot: Number(batch.slot), settledAt: batch.settledAt, results };
}

/**
 * Today's row counts (UTC), the input to `summarizeDay`. SPEC.md 8 lists which rows count.
 * @param {any} db
 * @param {Date} since
 */
async function dayRows(db, since) {
  const [rewards] = await db
    .select({
      winner: sql`coalesce(sum(${races.pointsAwarded}), 0)::int`,
      loser: sql`coalesce(sum(${races.loserPointsAwarded}), 0)::int`,
    })
    .from(races)
    .innerJoin(batches, eq(races.batchSlot, batches.slot))
    .where(and(eq(races.status, 'completed'), gte(batches.settledAt, since)));
  /** @type {{ kind: string, tier: number, count: number }[]} */
  const packs = await db
    .select({
      kind: packOpens.kind,
      tier: packOpens.tier,
      count: sql`count(*)::int`,
    })
    .from(packOpens)
    .where(
      and(inArray(packOpens.status, ['committed', 'revealed']), gte(packOpens.createdAt, since))
    )
    .groupBy(packOpens.kind, packOpens.tier);
  const [vendor] = await db
    .select({ count: sql`count(*)::int` })
    .from(actions)
    .where(
      and(
        eq(actions.method, 'vendor_buy_drone'),
        eq(actions.status, 'applied'),
        gte(actions.createdAt, since)
      )
    );
  const [sold] = await db
    .select({
      trades: sql`count(*)::int`,
      fees: sql`coalesce(sum(${marketplaceListings.platformFee}), 0)::int`,
    })
    .from(marketplaceListings)
    .where(and(eq(marketplaceListings.status, 'sold'), gte(marketplaceListings.soldAt, since)));
  return {
    winnerVolts: Number(rewards.winner),
    loserVolts: Number(rewards.loser),
    packs,
    vendorDrones: Number(vendor.count),
    fees: Number(sold.fees),
    trades: Number(sold.trades),
  };
}

/**
 * Everything the landing strip shows.
 * @param {number} [nowMs]
 * @param {Deps} [deps]
 */
export async function getLiveStrip(nowMs = Date.now(), deps = {}) {
  const db = deps.db ?? defaultDb;
  const near = deps.near ?? getNear();
  const constants = /** @type {{ economy: { packs: any[] }, drones: { vendor_price: string } }} */ (
    await near.getConstants()
  );
  const [nextRace, batch, day] = await Promise.all([
    getNextRace(nowMs, { db }),
    lastBatch(db),
    dayRows(db, utcDayStart(nowMs)),
  ]);
  return {
    nextRace,
    lastBatch: batch,
    today: summarizeDay(day, {
      packs: constants.economy.packs,
      vendor: constants.drones.vendor_price,
    }),
    contractUrl: near.explorerAccount(near.gameId),
  };
}
