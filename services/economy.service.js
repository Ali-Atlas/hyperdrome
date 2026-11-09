/**
 * The economy page's data (SPEC.md 8 `GET /api/economy`): the last 24 hours of tick snapshots, the
 * latest team decisions with their reasons and explorer links, and the rules the teams follow.
 * Public: team accounts and their game figures only, no player's account or balance.
 */
import { asc, desc, eq, gte, isNotNull, and, sql } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/lib/db';
import { DECISION_LIMIT, ECONOMY_WINDOW_MS } from '@/lib/economy/history.js';
import { getNear } from '@/lib/near';
import { teamEconomy } from '@/lib/teams/constants.js';
import { TEAM_RULES } from '@/lib/teams/policy.js';
import { teamSlugOf } from '@/lib/teams/roster.js';

const { economySnapshots, teamDecisions, teams, users } = schema;

/** @typedef {{ db?: any, near?: import('@/lib/near').NearAdapter }} Deps */

/**
 * The teams in account order, with their explorer links.
 * @param {any} db
 * @param {import('@/lib/near').NearAdapter} near
 */
async function teamList(db, near) {
  /** @type {{ account: string, name: string }[]} */
  const rows = await db
    .select({ account: users.nearAccountId, name: teams.name })
    .from(teams)
    .innerJoin(users, eq(users.id, teams.userId))
    .where(and(eq(users.isTeam, true), isNotNull(users.nearAccountId)))
    .orderBy(asc(users.nearAccountId));
  return rows.map((r) => ({
    slug: teamSlugOf(r.account),
    name: r.name,
    accountUrl: near.explorerAccount(r.account),
  }));
}

/**
 * Snapshots of the window, oldest first.
 * @param {any} db
 * @param {number} nowMs
 */
async function windowSnapshots(db, nowMs) {
  /** @type {(typeof economySnapshots.$inferSelect)[]} */
  const rows = await db
    .select()
    .from(economySnapshots)
    .where(gte(economySnapshots.at, new Date(nowMs - ECONOMY_WINDOW_MS)))
    .orderBy(asc(economySnapshots.slot));
  return rows.map((r) => ({
    slot: Number(r.slot),
    at: r.at,
    supply: r.supply === null ? null : Number(r.supply),
    minted: Number(r.minted),
    burned: Number(r.burned),
    openListings: r.openListings,
    trades: r.trades,
    teams: /** @type {{ slug: string, volts: number, drones: number, openListings: number }[]} */ (
      r.teams
    ).map(({ slug, volts, drones, openListings }) => ({ slug, volts, drones, openListings })),
  }));
}

/**
 * The latest decisions, newest first.
 * @param {any} db
 * @param {import('@/lib/near').NearAdapter} near
 */
async function latestDecisions(db, near) {
  const rows = await db
    .select({ decision: teamDecisions, account: users.nearAccountId })
    .from(teamDecisions)
    .innerJoin(users, eq(users.id, teamDecisions.teamUserId))
    .orderBy(desc(teamDecisions.createdAt))
    .limit(DECISION_LIMIT);
  return rows.map(
    (
      /** @type {{ decision: typeof teamDecisions.$inferSelect, account: string | null }} */ {
        decision: d,
        account,
      }
    ) => ({
      actionId: d.actionId,
      team: account ? teamSlugOf(account) : null,
      slot: Number(d.slot),
      step: d.step,
      subject: d.subject,
      status: d.status,
      reason: d.reason,
      numbers: d.numbers,
      txHash: d.txHash,
      explorerUrl: d.txHash ? near.explorerTx(d.txHash) : null,
      at: d.createdAt,
    })
  );
}

/**
 * When the record starts: the first decision written (decisions are not pruned), else the oldest
 * snapshot; null before either exists.
 * @param {any} db
 * @returns {Promise<Date | null>}
 */
async function historyStart(db) {
  const [[first], [oldest]] = await Promise.all([
    db.select({ at: sql`min(${teamDecisions.createdAt})` }).from(teamDecisions),
    db.select({ at: sql`min(${economySnapshots.at})` }).from(economySnapshots),
  ]);
  const at = first?.at ?? oldest?.at ?? null;
  return at === null ? null : new Date(/** @type {string | Date} */ (at));
}

/**
 * Everything the economy page shows.
 * @param {number} [nowMs]
 * @param {Deps} [deps]
 */
export async function getEconomy(nowMs = Date.now(), deps = {}) {
  const db = deps.db ?? defaultDb;
  const near = deps.near ?? getNear();
  const [teamRows, snapshots, decisions, since, constants] = await Promise.all([
    teamList(db, near),
    windowSnapshots(db, nowMs),
    latestDecisions(db, near),
    historyStart(db),
    near.getConstants(),
  ]);
  const economy = teamEconomy(constants);
  return {
    teams: teamRows,
    snapshots,
    decisions,
    rules: TEAM_RULES.map(({ step, name, description }) => ({ step, name, description })),
    limits: {
      reserve: economy.reserve,
      perTxCap: economy.perTxCap,
      perDayCap: economy.perDayCap,
    },
    since,
    contractUrl: near.explorerAccount(near.gameId),
  };
}
