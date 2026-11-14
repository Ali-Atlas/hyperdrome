/**
 * What the showcase seed's plan shows before anything is sent (SPEC.md 6, Showcase seed): the
 * operator's account, the skin supply against the caps, the steps already applied, what pays for
 * the run, and the racing check. Read-only: views and selects.
 */
import { and, eq, inArray, isNotNull, notInArray } from 'drizzle-orm';
import { schema } from '@/lib/db';
import { activeSlotsFor } from '@/lib/game-engine/economy.js';
import {
  botsNeeded,
  getLevelBracket,
  groupByBracket,
  matchDronesInBracket,
} from '@/lib/game-engine/matchmaking.js';
import { OPERATOR_KIT, PILOTS, kitSteps, pilotEmail, pilotKit } from '@/lib/showcase/plan.js';
import { notFixtureOwned } from './fixture-filter.js';
import { attemptIds, checkSupply, context, operatorUser } from './showcase-seed.service.js';

const { users, drones, actions } = schema;

/** The rating a drone is minted with (SPEC.md 2.1). */
const STARTING_ELO = 1000;

/**
 * @typedef {import('./showcase-seed.service.js').Deps} Deps
 * @typedef {typeof users.$inferSelect} UserRow
 * @typedef {{ name: string, level: number, eloRating: number, userId: string | null, owner: string }} Entrant
 * @typedef {object} RacingRow one of the operator's drones in its bracket
 * @property {string} name
 * @property {number} level
 * @property {string} bracket
 * @property {boolean} active whether the seed sets it active (the account's slots, 2.2)
 * @property {Entrant[]} opponents active drones of other players and teams in the bracket
 * @property {number} bots bots the bracket is filled with (2.3)
 * @property {string | null} firstPairing who the pairing rule gives it at today's ratings
 */

/**
 * @param {{ operatorAccount: string }} input
 * @param {Deps} [deps]
 */
export async function showcaseStatus({ operatorAccount }, deps = {}) {
  const ctx = context(deps);
  const operator = await operatorUser(ctx, operatorAccount);
  const supply = await checkSupply(ctx);
  const emails = PILOTS.map(pilotEmail);
  /** @type {UserRow[]} */
  const pilotRows = await ctx.db.select().from(users).where(inArray(users.email, emails));
  const accounts = [
    { username: /** @type {string} */ (operator.username), user: operator, kit: OPERATOR_KIT },
    ...PILOTS.map((pilot) => ({
      username: pilot.username,
      user: pilotRows.find((row) => row.email === pilotEmail(pilot)) ?? null,
      kit: pilotKit(pilot),
    })),
  ];
  const progress = [];
  for (const { username, user, kit } of accounts) {
    const steps = kitSteps(kit);
    const accountId = user?.nearAccountId ?? null;
    let applied = 0;
    if (accountId) {
      const ids = steps.flatMap((step) => attemptIds(accountId, step));
      const rows = await ctx.db
        .select({ id: actions.id })
        .from(actions)
        .where(and(inArray(actions.id, ids), eq(actions.status, 'applied')));
      applied = rows.length;
    }
    progress.push({
      username,
      accountId,
      state: user?.bootstrapState ?? 'none',
      applied,
      steps: steps.length,
    });
  }
  return {
    operator: { username: operator.username, accountId: operatorAccount },
    operatorVolts: Number(await ctx.near.view('ft_balance_of', { account_id: operatorAccount })),
    operatorBalance: await ctx.near.accountBalance(operatorAccount),
    funding: await ctx.near.fundingStatus([]),
    supply,
    progress,
    slots: activeSlotsFor(operator.totalRaces),
    lifetimeRaces: operator.totalRaces,
    racing: await racingCheck(ctx.db, operator, pilotRows),
  };
}

/**
 * The racing check, with the commit phase's own rules (2.3, `lib/game-engine/matchmaking.js`,
 * `services/batch.service.js`): for each of the operator's drones, the active drones of other
 * owners in its level bracket once the seed has run (today's field without the seed's accounts,
 * plus each pilot's racer at the starting rating), the bots the bracket is filled with, and the
 * partner the pairing rule gives it at today's ratings. Throws when a bracket has no opponent
 * that is not a bot.
 * @param {any} db
 * @param {UserRow} operator
 * @param {UserRow[]} pilotRows
 * @returns {Promise<RacingRow[]>}
 */
export async function racingCheck(db, operator, pilotRows) {
  const seeded = [operator.id, ...pilotRows.map((row) => row.id)];
  /** @type {Entrant[]} */
  const field = await db
    .select({
      name: drones.name,
      level: drones.level,
      eloRating: drones.eloRating,
      userId: drones.userId,
      owner: users.username,
    })
    .from(drones)
    .innerJoin(users, eq(drones.userId, users.id))
    .where(
      and(
        eq(drones.active, true),
        eq(drones.isBot, false),
        isNotNull(drones.tokenId),
        notFixtureOwned(db, drones.userId),
        notInArray(drones.userId, seeded)
      )
    );
  /** @type {Entrant[]} */
  const bots = (
    await db
      .select({ name: drones.name, level: drones.level, eloRating: drones.eloRating })
      .from(drones)
      .where(and(eq(drones.isBot, true), isNotNull(drones.tokenId)))
      .orderBy(drones.totalRaces, drones.id)
  ).map((/** @type {{ name: string, level: number, eloRating: number }} */ bot) => ({
    ...bot,
    userId: null,
    owner: 'bot',
  }));
  /** @type {Entrant[]} */
  const racers = PILOTS.map((pilot) => ({
    name: pilot.racer.name,
    level: pilot.racer.level,
    eloRating: STARTING_ELO,
    userId: pilot.username,
    owner: pilot.username,
  }));
  const botsBy = groupByBracket(bots);
  const slots = activeSlotsFor(operator.totalRaces);
  return OPERATOR_KIT.active.map((name, i) => {
    const spec = OPERATOR_KIT.drones.find((d) => d.name === name);
    if (!spec) throw new Error(`${name} is not a drone of the operator's kit`);
    const bracket = getLevelBracket(spec.level);
    /** @type {Entrant} */
    const mine = {
      name,
      level: spec.level,
      eloRating: STARTING_ELO,
      userId: operator.id,
      owner: String(operator.username),
    };
    const opponents = [...field, ...racers].filter((d) => getLevelBracket(d.level) === bracket);
    if (opponents.length === 0) {
      throw new Error(`${name}: bracket ${bracket} has no opponent that is not a bot`);
    }
    const fill = botsBy[bracket].slice(0, botsNeeded(opponents.length + 1));
    const pair = matchDronesInBracket([mine, ...opponents, ...fill]).find((p) => p.includes(mine));
    const partner = pair?.find((d) => d !== mine);
    return {
      name,
      level: spec.level,
      bracket,
      active: i < slots,
      opponents,
      bots: fill.length,
      firstPairing: partner ? `${partner.name} (${partner.owner})` : null,
    };
  });
}
