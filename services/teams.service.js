/**
 * AI team runner (SPEC.md 10). `runTeamPhase` is the hook the scheduler calls after it commits a
 * batch: each team takes at most one chain action per tick, the first of equip, allocate, capsule,
 * list and buy that applies (`lib/teams/policy.js`). Every action goes through the player action
 * path under a deterministic id (`lib/teams/action-id.js`), so running the same tick again replays
 * the stored action instead of sending a second one. A team's unfinished action (an unknown
 * outcome, or a capsule committed and not yet revealed) is finished before anything new starts.
 */
import { and, asc, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/lib/db';
import { TIME_OF_DAY, WEATHER } from '@/lib/game-engine/race-simulator.js';
import { STAT_KEYS } from '@/lib/game-engine/templates.js';
import { TRACKS } from '@/lib/game-engine/tracks.js';
import { getNear } from '@/lib/near';
import { teamActionId } from '@/lib/teams/action-id.js';
import { teamEconomy } from '@/lib/teams/constants.js';
import { decide } from '@/lib/teams/policy.js';
import { teamSlugOf } from '@/lib/teams/roster.js';
import { PACK_TIERS } from '@/lib/validators/gameplay.js';
import { runPlayerAction } from './action.service.js';
import { applyEvents } from './chain-cache.service.js';
import { openPack, revealActionId } from './pack-open.service.js';

const { users, teams, actions, packOpens, drones, mods, droneMods, marketplaceListings } = schema;

/** Active mod listings a team looks at per tick, cheapest first. */
const MARKET_SCAN_LIMIT = 200;

/**
 * @typedef {import('@/lib/teams/policy.js').Plan} Plan
 * @typedef {import('@/lib/teams/policy.js').TeamState} TeamState
 * @typedef {import('@/lib/game-engine/mod-fit.js').FitRace} FitRace
 * @typedef {import('./action.service.js').ActionResponse} ActionResponse
 * @typedef {{ a: string, b: string, track: number, weather: number, tod: number }} Matchup
 *   a committed matchup as `commit_batch` takes it (SPEC.md 4.2): token ids and table indexes
 * @typedef {{ db?: any, near?: import('@/lib/near').NearAdapter, now?: () => number, secretKey?: string }} Deps
 * @typedef {{ db: any, near: import('@/lib/near').NearAdapter, now: () => number, secretKey?: string }} FullDeps
 * @typedef {typeof actions.$inferSelect} ActionRow
 * @typedef {{ user: typeof users.$inferSelect, team: typeof teams.$inferSelect }} TeamRow
 */

/**
 * @typedef {object} TeamResult
 * @property {string} team the team slug
 * @property {Plan['step'] | null} step the step taken, or null when the team did nothing
 * @property {'applied' | 'pending' | 'refused' | 'idle' | 'deadline' | 'error'} outcome
 *   `refused`: the chain or the action path said no (the team waits for the next tick);
 *   `idle`: no step applied; `deadline`: skipped, the tick ran out of time
 * @property {string} [subject]
 * @property {string} [actionId]
 * @property {boolean} [replayed] the action was already recorded (this tick again, or unfinished)
 * @property {string} [error]
 */

/**
 * Run the team phase of the tick for `slot`.
 * @param {{ slot: number, matchups: Matchup[], deadlineMs: number }} input the batch slot, its
 *   committed matchups, and the time (ms since epoch) after which no further team starts
 * @param {Deps} [deps]
 * @returns {Promise<{ slot: number, teams: TeamResult[] }>}
 */
export async function runTeamPhase({ slot, matchups, deadlineMs }, deps = {}) {
  /** @type {FullDeps} */
  const d = {
    db: deps.db ?? defaultDb,
    near: deps.near ?? getNear(),
    now: deps.now ?? Date.now,
    secretKey: deps.secretKey,
  };
  /** @type {TeamRow[]} */
  const rows = await d.db
    .select({ user: users, team: teams })
    .from(teams)
    .innerJoin(users, eq(users.id, teams.userId))
    .where(
      and(eq(users.isTeam, true), eq(users.bootstrapState, 'done'), isNotNull(users.nearAccountId))
    )
    .orderBy(asc(users.nearAccountId));
  if (rows.length === 0) return { slot, teams: [] };

  const economy = teamEconomy(await d.near.getConstants());
  const races = racesByToken(matchups);
  // The first team rotates with the slot, so a short deadline does not always skip the same team.
  const first = slot % rows.length;
  /** @type {TeamResult[]} */
  const results = [];
  for (const row of [...rows.slice(first), ...rows.slice(0, first)]) {
    const team = teamSlugOf(/** @type {string} */ (row.user.nearAccountId));
    if (d.now() > deadlineMs) {
      results.push({ team, step: null, outcome: 'deadline' });
      continue;
    }
    try {
      results.push(await teamTurn(d, { slot, team, row, races, economy }));
    } catch (err) {
      console.error({ scope: 'teams', msg: 'team turn failed', team, slot, err: String(err) });
      results.push({ team, step: null, outcome: 'error', error: String(err) });
    }
  }
  return { slot, teams: results };
}

/**
 * One team's turn: finish or replay a recorded action, else decide and send one.
 * @param {FullDeps} d
 * @param {{ slot: number, team: string, row: TeamRow, races: Map<string, { race: FitRace, order: number }>, economy: import('@/lib/teams/constants.js').TeamEconomy }} turn
 * @returns {Promise<TeamResult>}
 */
async function teamTurn(d, { slot, team, row, races, economy }) {
  const userId = row.user.id;
  const last = await lastAction(d.db, userId);
  const recorded = last ? planOf(last) : null;
  if (last && recorded) {
    const thisTick = teamActionId(team, slot, recorded.step, recorded.subject) === last.id;
    if (thisTick || (await unfinished(d.db, last))) {
      return report(team, recorded, last.id, await send(d, userId, last.id, recorded), true);
    }
  }
  const plan = decide(await loadState(d, row, races, economy));
  if (!plan) return { team, step: null, outcome: 'idle' };
  const actionId = teamActionId(team, slot, plan.step, plan.subject);
  return report(team, plan, actionId, await send(d, userId, actionId, plan), false);
}

/**
 * Send a plan through the action path (a capsule through the pack service, which commits and
 * reveals under the same action id).
 * @param {FullDeps} d
 * @param {string} userId
 * @param {string} actionId
 * @param {Plan} plan
 * @returns {Promise<ActionResponse>}
 */
function send(d, userId, actionId, plan) {
  if (plan.step === 'capsule') {
    const tier = /** @type {(typeof PACK_TIERS)[number]} */ (plan.args.tier);
    return openPack({ userId, actionId, kind: 'mod', tier }, d);
  }
  return runPlayerAction(
    {
      userId,
      actionId,
      method: plan.method,
      args: plan.args,
      onApplied: (events) => applyEvents(events, d).then(() => ({})),
    },
    d
  );
}

/**
 * @param {string} team
 * @param {Plan} plan
 * @param {string} actionId
 * @param {ActionResponse} res
 * @param {boolean} replayed
 * @returns {TeamResult}
 */
function report(team, plan, actionId, res, replayed) {
  const base = { team, step: plan.step, subject: plan.subject, actionId, replayed };
  if (res.status === 200) return { ...base, outcome: 'applied' };
  if (res.status === 202) return { ...base, outcome: 'pending' };
  // `cap exceeded`, `insufficient volts` or any other refusal: the team waits for the next tick.
  return { ...base, outcome: 'refused', error: String(res.body.error ?? res.status) };
}

/**
 * The team's most recent action (a capsule's reveal is part of its `open_pack`).
 * @param {any} db
 * @param {string} userId
 * @returns {Promise<ActionRow | undefined>}
 */
async function lastAction(db, userId) {
  const [row] = await db
    .select()
    .from(actions)
    .where(and(eq(actions.userId, userId), ne(actions.method, 'reveal_pack')))
    .orderBy(desc(actions.createdAt))
    .limit(1);
  return row;
}

/**
 * The plan a recorded action came from, rebuilt from its stored method and args, so it can be
 * sent again under its own id.
 * @param {ActionRow} row
 * @returns {Plan | null}
 */
function planOf(row) {
  const args = /** @type {Record<string, any>} */ (row.args ?? {});
  switch (row.method) {
    case 'equip':
      return { step: 'equip', subject: args.drone, method: row.method, args };
    case 'allocate_stats':
      return { step: 'allocate', subject: args.drone, method: row.method, args };
    case 'list':
      return { step: 'list', subject: args.token, method: row.method, args };
    case 'buy':
      return { step: 'buy', subject: args.token, method: row.method, args };
    case 'open_pack': {
      const tier = PACK_TIERS[args.tier];
      return tier ? { step: 'capsule', subject: tier, method: row.method, args: { tier } } : null;
    }
    default:
      return null;
  }
}

/**
 * True when a recorded action still has work to do: its outcome is unknown, or it is a capsule
 * whose commit applied and whose reveal has not (and has not failed for good).
 * @param {any} db
 * @param {ActionRow} row
 * @returns {Promise<boolean>}
 */
async function unfinished(db, row) {
  if (row.status === 'pending') return true;
  if (row.method !== 'open_pack' || row.status !== 'applied') return false;
  const [pack] = await db
    .select({ status: packOpens.status })
    .from(packOpens)
    .where(eq(packOpens.actionId, row.id));
  if (!pack || pack.status === 'revealed') return false;
  const [reveal] = await db
    .select({ status: actions.status })
    .from(actions)
    .where(eq(actions.id, revealActionId(row.id)));
  return reveal?.status !== 'failed';
}

/**
 * Each raced drone's conditions and matchup index, from the committed matchups.
 * @param {Matchup[]} matchups
 * @returns {Map<string, { race: FitRace, order: number }>}
 */
function racesByToken(matchups) {
  /** @type {Map<string, { race: FitRace, order: number }>} */
  const races = new Map();
  matchups.forEach((m, order) => {
    const track = TRACKS[m.track];
    const weather = WEATHER[m.weather];
    const timeOfDay = TIME_OF_DAY[m.tod];
    if (!track || !weather || !timeOfDay) return;
    for (const token of [m.a, m.b])
      races.set(token, { race: { track, weather, timeOfDay }, order });
  });
  return races;
}

/**
 * What a team decides from: its Volts (from the chain), its drones with their bound mods, its
 * unbound mods, and the mod market (all from the cache).
 * @param {FullDeps} d
 * @param {TeamRow} row
 * @param {Map<string, { race: FitRace, order: number }>} races
 * @param {import('@/lib/teams/constants.js').TeamEconomy} economy
 * @returns {Promise<TeamState>}
 */
async function loadState(d, row, races, economy) {
  const userId = row.user.id;
  const volts = Number(
    (await d.near.view('ft_balance_of', { account_id: row.user.nearAccountId })) ?? 0
  );
  const droneRows = await d.db
    .select()
    .from(drones)
    .where(and(eq(drones.userId, userId), isNotNull(drones.tokenId)));
  const ownedMods = await d.db
    .select({ id: mods.id, token: mods.tokenId, template: mods.template })
    .from(mods)
    .where(and(eq(mods.userId, userId), isNotNull(mods.tokenId), isNotNull(mods.template)));
  const bound = ownedMods.length
    ? await d.db
        .select({ droneId: droneMods.droneId, modId: droneMods.modId, on: droneMods.isEquipped })
        .from(droneMods)
        .where(
          inArray(
            droneMods.modId,
            ownedMods.map((/** @type {{ id: string }} */ m) => m.id)
          )
        )
    : [];
  const activeModListing = and(
    eq(marketplaceListings.status, 'active'),
    eq(marketplaceListings.itemType, 'mod'),
    isNotNull(marketplaceListings.tokenId)
  );
  const ownListings = await d.db
    .select({ token: marketplaceListings.tokenId })
    .from(marketplaceListings)
    .where(and(activeModListing, eq(marketplaceListings.sellerId, userId)));
  const market = await d.db
    .select({
      token: marketplaceListings.tokenId,
      price: marketplaceListings.price,
      template: mods.template,
    })
    .from(marketplaceListings)
    .innerJoin(mods, eq(mods.id, marketplaceListings.modId))
    .where(
      and(activeModListing, ne(marketplaceListings.sellerId, userId), isNotNull(mods.template))
    )
    .orderBy(asc(marketplaceListings.price))
    .limit(MARKET_SCAN_LIMIT);

  /** @typedef {{ id: string, token: string, template: number }} OwnedMod */
  /** @typedef {{ droneId: string, modId: string, on: boolean }} Binding */
  const byId = new Map(ownedMods.map((/** @type {OwnedMod} */ m) => [m.id, m]));
  const boundIds = new Set(bound.map((/** @type {Binding} */ b) => b.modId));
  const ownListed = new Set(ownListings.map((/** @type {{ token: string }} */ l) => l.token));
  /** @param {OwnedMod} m */
  const ref = (m) => ({ token: m.token, template: m.template });

  return {
    volts,
    reserve: Number(row.team.reserve ?? economy.reserve),
    perTxCap: economy.perTxCap,
    capsulePrices: economy.capsulePrices,
    weights: /** @type {TeamState['weights']} */ (row.team.persona),
    drones: droneRows.map((/** @type {typeof drones.$inferSelect} */ drone) => {
      const own = bound.filter((/** @type {Binding} */ b) => b.droneId === drone.id);
      const equipped = own.find((/** @type {Binding} */ b) => b.on);
      const raced = races.get(/** @type {string} */ (drone.tokenId));
      return {
        token: /** @type {string} */ (drone.tokenId),
        level: drone.level,
        stats: STAT_KEYS.map((key) => drone[key]),
        equippedMod: equipped ? (byId.get(equipped.modId)?.token ?? null) : null,
        mods: own.map((/** @type {Binding} */ b) => ref(byId.get(b.modId))),
        race: raced?.race ?? null,
        order: raced?.order ?? Number.MAX_SAFE_INTEGER,
      };
    }),
    freeMods: ownedMods
      .filter((/** @type {OwnedMod} */ m) => !boundIds.has(m.id) && !ownListed.has(m.token))
      .map(ref),
    listedMods: ownListed.size,
    market,
  };
}
