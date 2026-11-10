/**
 * The economy snapshot written at the end of every completed tick (SPEC.md 6, 7
 * `economy_snapshots`): each AI team's Volts, drones and open listings, the Volt supply, today's
 * minted and burned, open listings and trades. The same write prunes rows past the 7-day
 * retention. A public statistic never fails a tick, so a failure is logged and not thrown.
 */
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { schema } from '@/lib/db';
import { snapshotCutoff } from '@/lib/economy/history.js';
import { fixtureAccounts } from '@/lib/teams/fixtures.js';
import { teamSlugOf } from '@/lib/teams/roster.js';
import { notFixtureOwned } from './fixture-filter.js';
import { todayNumbers } from './live.service.js';

const { drones, economySnapshots, marketplaceListings, teams, users } = schema;

/**
 * @typedef {{ slug: string, name: string, volts: number, drones: number, openListings: number }} TeamFigures
 */

/**
 * Each team's Volts (`users.points`, the cache of `ft_balance_of`), drones and active listings.
 * @param {any} db
 * @returns {Promise<TeamFigures[]>}
 */
async function teamFigures(db) {
  /** @type {{ id: string, account: string | null, name: string, volts: number }[]} */
  const rows = await db
    .select({ id: users.id, account: users.nearAccountId, name: teams.name, volts: users.points })
    .from(teams)
    .innerJoin(users, eq(users.id, teams.userId))
    .where(eq(users.isTeam, true))
    .orderBy(users.nearAccountId);
  const ids = rows.filter((r) => r.account).map((r) => r.id);
  if (ids.length === 0) return [];
  const [droneCounts, listingCounts] = await Promise.all([
    db
      .select({ userId: drones.userId, n: sql`count(*)::int` })
      .from(drones)
      .where(inArray(drones.userId, ids))
      .groupBy(drones.userId),
    db
      .select({ userId: marketplaceListings.sellerId, n: sql`count(*)::int` })
      .from(marketplaceListings)
      .where(
        and(eq(marketplaceListings.status, 'active'), inArray(marketplaceListings.sellerId, ids))
      )
      .groupBy(marketplaceListings.sellerId),
  ]);
  /** @param {{ userId: string, n: number }[]} counts */
  const byUser = (counts) => new Map(counts.map((c) => [c.userId, Number(c.n)]));
  const droneN = byUser(droneCounts);
  const listingN = byUser(listingCounts);
  return rows
    .filter((r) => r.account)
    .map((r) => ({
      slug: teamSlugOf(/** @type {string} */ (r.account)),
      name: r.name,
      volts: Number(r.volts),
      drones: droneN.get(r.id) ?? 0,
      openListings: listingN.get(r.id) ?? 0,
    }));
}

/**
 * The Volt supply from one `ft_total_supply` view, less what test fixtures hold (SPEC.md 10); null
 * when the RPC does not answer, so a slow node costs one figure and not the snapshot.
 * @param {import('@/lib/near').NearAdapter} near
 * @param {number} slot
 * @returns {Promise<number | null>}
 */
async function totalSupply(near, slot) {
  try {
    const supply = await near.view('ft_total_supply', {});
    if (supply === null || supply === undefined) return null;
    const held = await Promise.all(
      [...fixtureAccounts(near.gameId)].map((account_id) =>
        near.view('ft_balance_of', { account_id })
      )
    );
    return held.reduce(
      (/** @type {number} */ left, volts) => left - Number(volts ?? 0),
      Number(supply)
    );
  } catch (err) {
    console.error({ scope: 'scheduler', msg: 'volt supply read failed', slot, err: String(err) });
    return null;
  }
}

/**
 * Active listings of every seller but a test fixture (SPEC.md 10).
 * @param {any} db
 * @returns {Promise<number>}
 */
async function openListingCount(db) {
  const [open] = await db
    .select({ n: sql`count(*)::int` })
    .from(marketplaceListings)
    .where(
      and(
        eq(marketplaceListings.status, 'active'),
        notFixtureOwned(db, marketplaceListings.sellerId)
      )
    );
  return Number(open.n);
}

/**
 * Write the snapshot for `slot`, then prune what is past the retention. A slot already written
 * keeps its row.
 * @param {number} slot
 * @param {{ db: any, near: import('@/lib/near').NearAdapter }} deps
 * @param {number} [nowMs]
 * @returns {Promise<boolean>} true when the write and the prune both went through
 */
export async function writeEconomySnapshot(slot, { db, near }, nowMs = Date.now()) {
  try {
    const [teamRows, today, supply, open] = await Promise.all([
      teamFigures(db),
      todayNumbers(db, nowMs),
      totalSupply(near, slot),
      openListingCount(db),
    ]);
    await db
      .insert(economySnapshots)
      .values({
        slot,
        at: new Date(nowMs),
        teams: teamRows,
        supply,
        minted: today.voltsMinted,
        burned: today.voltsBurned,
        openListings: open,
        trades: today.trades,
      })
      .onConflictDoNothing();
    await db.delete(economySnapshots).where(lt(economySnapshots.at, snapshotCutoff(nowMs)));
    return true;
  } catch (err) {
    console.error({ scope: 'scheduler', msg: 'economy snapshot failed', slot, err: String(err) });
    return false;
  }
}
