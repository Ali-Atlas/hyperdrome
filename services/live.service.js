/**
 * The landing page's live strip (SPEC.md 8 `GET /api/live`): the next race, the last settled
 * batch's results and today's numbers, all from the database caches. Public: drone names only, no
 * account or balance.
 */
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/lib/db';
import { raceMarginMs, utcDayKey, utcDayStart } from '@/lib/live/summary.js';
import { getNear } from '@/lib/near';
import { notFixtureOwned } from './fixture-filter.js';
import { getNextRace } from './race-schedule.service.js';

const { batches, drones, marketplaceListings, races, voltDaily } = schema;

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
 * Today's numbers (UTC). SPEC.md 8 says exactly what counts.
 * @param {any} db
 * @param {number} nowMs
 * @returns {Promise<{ voltsMinted: number, voltsBurned: number, trades: number }>}
 */
async function todayNumbers(db, nowMs) {
  const [[volts], [sold]] = await Promise.all([
    db
      .select({ minted: voltDaily.minted, burned: voltDaily.burned })
      .from(voltDaily)
      .where(eq(voltDaily.day, utcDayKey(nowMs))),
    db
      .select({ trades: sql`count(*)::int` })
      .from(marketplaceListings)
      .where(
        and(
          eq(marketplaceListings.status, 'sold'),
          gte(marketplaceListings.soldAt, utcDayStart(nowMs)),
          notFixtureOwned(db, marketplaceListings.sellerId),
          notFixtureOwned(db, marketplaceListings.buyerId)
        )
      ),
  ]);
  return {
    voltsMinted: Number(volts?.minted ?? 0),
    voltsBurned: Number(volts?.burned ?? 0),
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
  const [nextRace, batch, today] = await Promise.all([
    getNextRace(nowMs, { db }),
    lastBatch(db),
    todayNumbers(db, nowMs),
  ]);
  return {
    nextRace,
    lastBatch: batch,
    today,
    contractUrl: near.explorerAccount(near.gameId),
  };
}
