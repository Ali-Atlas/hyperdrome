import { and, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import {
  calculateRacePoints,
  calculateNewElo,
} from '@/lib/game-engine/economy.js';
import {
  getActiveDronesByBracket,
  matchDronesInBracket,
  ensureBotBackfill,
} from '@/lib/game-engine/matchmaking.js';
import {
  simulateRace,
  randomWeather,
  randomTimeOfDay,
} from '@/lib/game-engine/race-simulator.js';
import { getRandomTrack } from '@/services/track.service.js';
import { checkAndLevelUp } from '@/services/drone.service.js';
import { ApiError } from '@/lib/api/response.js';

const { drones, users, races, tracks, adminConfig, skins } = schema;

/* -------------------------------------------------------------------------- */
/* Config loader                                                              */
/* -------------------------------------------------------------------------- */

async function loadConfig() {
  const rows = await db.select().from(adminConfig);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const num = (key, fallback) => {
    const v = map[key];
    if (v == null) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    raceIntervalSeconds:   num('race_interval_seconds', 120),
    pointsPerWinBase:      num('points_per_win_base', 3),
    xpPerWin:              num('xp_per_win', 10),
    xpPerLoss:             num('xp_per_loss', 4),
    botDensityMinimum:     num('bot_density_minimum', 4),
    skinDropRateCommon:    num('skin_drop_rate_common', 0.05),
    skinDropRateRare:      num('skin_drop_rate_rare', 0.02),
    skinDropRateEpic:      num('skin_drop_rate_epic', 0.005),
    skinDropRateLegendary: num('skin_drop_rate_legendary', 0.001),
    slot2UnlockRaces:      num('slot_2_unlock_races', 500),
    slot3UnlockRaces:      num('slot_3_unlock_races', 2000),
  };
}

/**
 * Bump activeDroneSlots once a player crosses the configured race-count
 * thresholds. Idempotent: only updates when the new tier is higher than
 * the current. Called after each race for both participants' owners.
 */
async function maybeUnlockSlot(userId, cfg) {
  if (!userId) return;
  const [u] = await db
    .select({
      totalRaces: users.totalRaces,
      activeDroneSlots: users.activeDroneSlots,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return;
  let target = u.activeDroneSlots;
  if (u.totalRaces >= cfg.slot3UnlockRaces && target < 3) target = 3;
  else if (u.totalRaces >= cfg.slot2UnlockRaces && target < 2) target = 2;
  if (target > u.activeDroneSlots) {
    await db
      .update(users)
      .set({ activeDroneSlots: target })
      .where(eq(users.id, userId));
  }
}

/* -------------------------------------------------------------------------- */
/* Skin drops                                                                 */
/* -------------------------------------------------------------------------- */

async function rollSkinDropForWinner(userId, cfg) {
  if (!userId) return null;
  const roll = Math.random();
  let rarity = null;
  if (roll < cfg.skinDropRateLegendary) rarity = 'legendary';
  else if (roll < cfg.skinDropRateLegendary + cfg.skinDropRateEpic) rarity = 'epic';
  else if (roll < cfg.skinDropRateLegendary + cfg.skinDropRateEpic + cfg.skinDropRateRare) rarity = 'rare';
  else if (roll < cfg.skinDropRateLegendary + cfg.skinDropRateEpic + cfg.skinDropRateRare + cfg.skinDropRateCommon) rarity = 'common';
  if (!rarity) return null;

  const unowned = await db
    .select()
    .from(skins)
    .where(and(eq(skins.rarity, rarity), sql`${skins.userId} IS NULL`))
    .limit(1);
  if (unowned.length === 0) return null;

  await db
    .update(skins)
    .set({ userId })
    .where(eq(skins.id, unowned[0].id));
  return unowned[0];
}

/* -------------------------------------------------------------------------- */
/* Core race cycle                                                            */
/* -------------------------------------------------------------------------- */

/** PENDING window length in seconds. Cron creates each PENDING race
 *  with `scheduled_at = NOW() + PENDING_WINDOW_SECONDS` and phase 2
 *  executes any PENDING whose scheduled time has passed. The cron's
 *  own tick interval is independent (admin_config.race_interval_seconds)
 *  and dictates how soon AFTER the schedule a race actually executes. */
const PENDING_WINDOW_SECONDS = 180; // 3 minutes

/**
 * Run one full race cycle. Two phases per tick:
 *
 *   PHASE 2  Execute PENDING races whose scheduled_at <= NOW().
 *            Run first so drones whose pending window just expired
 *            free up before phase 1 tries to match them again.
 *
 *   PHASE 1  Match unmatched active drones (those NOT currently in a
 *            PENDING race) into new PENDING races for the next window.
 *
 * Both phases are gated by the `racing_enabled` admin_config flag at
 * the cron handler level (see app/api/races/run/route.js) - the flag
 * is a system-wide kill switch: when off, neither phase runs and any
 * already-PENDING races sit on the queue until the flag flips back on.
 *
 * @returns {Promise<{
 *   pendingExecuted: number,
 *   pendingCreated: number,
 *   botsActivated: number,
 *   bracketSummary: Record<string, number>
 * }>}
 */
export async function runRaceCycle() {
  const cfg = await loadConfig();

  // PHASE 2 - execute any ready PENDING races first.
  const pendingExecuted = await executeReadyPendingRaces(cfg);

  // PHASE 1 - match unmatched active drones into new PENDING races.
  const bracketSummary = {};
  let pendingCreated = 0;
  let botsActivated = 0;

  // Drones currently in a PENDING race must be excluded from the next
  // round of matchmaking; otherwise they'd get re-paired into another
  // PENDING before their first one executes.
  const pendingDroneIds = await getDroneIdsInPendingRaces();

  const buckets = await getActiveDronesByBracket(pendingDroneIds);

  for (const bracket of Object.keys(buckets)) {
    const activated = await ensureBotBackfill(
      bracket,
      buckets[bracket].length,
      cfg.botDensityMinimum,
    );
    botsActivated += activated;
  }

  // Re-fetch after backfill so newly-activated bots are visible.
  const updatedBuckets = await getActiveDronesByBracket(pendingDroneIds);

  for (const [bracket, bracketDrones] of Object.entries(updatedBuckets)) {
    if (bracketDrones.length < 2) {
      bracketSummary[bracket] = 0;
      continue;
    }
    const pairs = matchDronesInBracket(bracketDrones);
    bracketSummary[bracket] = pairs.length;

    for (const [d1, d2] of pairs) {
      await createPendingRace(d1, d2, cfg);
      pendingCreated += 1;
    }
  }

  return { pendingExecuted, pendingCreated, botsActivated, bracketSummary };
}

/** Distinct drone ids that are participants in any PENDING race. */
async function getDroneIdsInPendingRaces() {
  const rows = await db
    .select({ d1: races.drone1Id, d2: races.drone2Id })
    .from(races)
    .where(eq(races.status, 'pending'));
  const set = new Set();
  for (const r of rows) {
    set.add(r.d1);
    set.add(r.d2);
  }
  return set;
}

/**
 * Phase 1 step: snapshot conditions + ELO and write a PENDING race row.
 * The race engine is NOT invoked here. Result fields (winner, times,
 * raceLog, points, ELO change) stay default/null until phase 2.
 */
async function createPendingRace(d1, d2, cfg) {
  // Matchmaking guarantees d1.level === d2.level.
  const raceLevel = d1.level ?? d2.level ?? null;
  const track = await getRandomTrack(raceLevel);
  const weather = randomWeather();
  const timeOfDay = randomTimeOfDay();
  const scheduledAt = new Date(Date.now() + PENDING_WINDOW_SECONDS * 1000);

  await db.insert(races).values({
    status: 'pending',
    scheduledAt,
    drone1Id: d1.id,
    drone2Id: d2.id,
    trackId: track.id,
    timeOfDay,
    weather,
    // ELO is snapshotted at PENDING creation - this is the canonical
    // value for both display during the strategy window AND the
    // race-engine calculation at execution time.
    drone1EloBefore: d1.eloRating,
    drone2EloBefore: d2.eloRating,
    xpWinner: cfg.xpPerWin,
    xpLoser: cfg.xpPerLoss,
    // winnerDroneId, drone1Time, drone2Time, drone1EloChange,
    // drone2EloChange, pointsAwarded, raceLog all stay null/default
    // until phase 2 fills them in.
  });
  // Mark cfg as deliberately unused beyond xp values so future
  // refactors don't get confused; tooling-level no-op.
  return cfg;
}

/**
 * Phase 2: find every PENDING race whose scheduled_at has passed and
 * run the engine + apply results. Each is updated in place (UPDATE, not
 * INSERT) so the original createdAt and scheduledAt are preserved.
 *
 * @returns {Promise<number>} count of races executed
 */
async function executeReadyPendingRaces(cfg) {
  const ready = await db
    .select()
    .from(races)
    .where(
      and(
        eq(races.status, 'pending'),
        sql`${races.scheduledAt} <= NOW()`,
      ),
    );

  let executed = 0;
  for (const race of ready) {
    try {
      await executePendingRace(race, cfg);
      executed += 1;
    } catch (err) {
      console.error(
        `[race.service] failed to execute pending race ${race.id}:`,
        err,
      );
    }
  }
  return executed;
}

/**
 * Run the simulation for a single PENDING race row, write all result
 * fields, and apply downstream effects (drone/user updates, level-ups,
 * slot unlocks, skin drops). Uses snapshotted ELO from the PENDING
 * row for points + ELO calculation; uses LIVE drone stats at the
 * moment of execution for the simulator (so any allocations during
 * the strategy window apply).
 */
async function executePendingRace(pending, cfg) {
  const [d1, d2, track] = await Promise.all([
    db.select().from(drones).where(eq(drones.id, pending.drone1Id)).limit(1).then((r) => r[0]),
    db.select().from(drones).where(eq(drones.id, pending.drone2Id)).limit(1).then((r) => r[0]),
    db.select().from(tracks).where(eq(tracks.id, pending.trackId)).limit(1).then((r) => r[0]),
  ]);
  if (!d1 || !d2 || !track) {
    console.error(
      `[race.service] pending race ${pending.id} references missing drone/track; skipping`,
    );
    return;
  }

  const result = simulateRace(d1, d2, track, pending.weather, pending.timeOfDay);
  const winner = result.winnerId === d1.id ? d1 : d2;
  const loser = result.winnerId === d1.id ? d2 : d1;

  // Snapshotted ELO from the PENDING row drives both points and ELO
  // change calculations - decouples results from any drift in live
  // ELO between matchmaking and execution.
  const winnerEloBefore =
    winner.id === d1.id ? pending.drone1EloBefore : pending.drone2EloBefore;
  const loserEloBefore =
    loser.id === d1.id ? pending.drone1EloBefore : pending.drone2EloBefore;

  const pointsAwarded = calculateRacePoints(
    track.difficulty,
    winnerEloBefore,
    loserEloBefore,
    { basePoints: cfg.pointsPerWinBase },
  );
  const { newWinnerElo, newLoserElo } = calculateNewElo(
    winnerEloBefore,
    loserEloBefore,
  );

  const drone1EloAfter = d1.id === winner.id ? newWinnerElo : newLoserElo;
  const drone2EloAfter = d2.id === winner.id ? newWinnerElo : newLoserElo;
  const drone1EloChange = drone1EloAfter - pending.drone1EloBefore;
  const drone2EloChange = drone2EloAfter - pending.drone2EloBefore;

  // Promote PENDING -> COMPLETED with full results.
  await db
    .update(races)
    .set({
      status: 'completed',
      winnerDroneId: winner.id,
      pointsAwarded,
      drone1Time: String(result.drone1Time),
      drone2Time: String(result.drone2Time),
      drone1EloChange,
      drone2EloChange,
      raceLog: result.raceLog,
    })
    .where(eq(races.id, pending.id));

  // Drone updates - identical to the previous immediate-execute flow.
  await db
    .update(drones)
    .set({
      wins: winner.wins + 1,
      totalRaces: winner.totalRaces + 1,
      xp: winner.xp + cfg.xpPerWin,
      eloRating: newWinnerElo,
    })
    .where(eq(drones.id, winner.id));

  await db
    .update(drones)
    .set({
      losses: loser.losses + 1,
      totalRaces: loser.totalRaces + 1,
      xp: loser.xp + cfg.xpPerLoss,
      eloRating: newLoserElo,
    })
    .where(eq(drones.id, loser.id));

  // User wallet updates (only non-bot owners).
  if (winner.userId && !winner.isBot) {
    await db
      .update(users)
      .set({
        totalRaces: sql`${users.totalRaces} + 1`,
        totalWins: sql`${users.totalWins} + 1`,
        points: sql`${users.points} + ${pointsAwarded}`,
        seasonPoints: sql`${users.seasonPoints} + ${pointsAwarded}`,
      })
      .where(eq(users.id, winner.userId));
  }
  if (loser.userId && !loser.isBot) {
    // Consolation reward: every loss still pays 2 points to the wallet
    // (and 2 to seasonPoints) so player progression doesn't stall on a
    // losing streak. Wins still pay base + difficulty + upset via
    // calculateRacePoints; the loss payout is a flat 2.
    await db
      .update(users)
      .set({
        totalRaces: sql`${users.totalRaces} + 1`,
        points: sql`${users.points} + 2`,
        seasonPoints: sql`${users.seasonPoints} + 2`,
      })
      .where(eq(users.id, loser.userId));
  }

  await checkAndLevelUp(winner.id);
  await checkAndLevelUp(loser.id);

  if (winner.userId && !winner.isBot) await maybeUnlockSlot(winner.userId, cfg);
  if (loser.userId && !loser.isBot) await maybeUnlockSlot(loser.userId, cfg);

  if (winner.userId && !winner.isBot) {
    await rollSkinDropForWinner(winner.userId, cfg);
  }
}

/* -------------------------------------------------------------------------- */
/* Query helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Paginated race list with optional filters.
 * @param {object} filters
 * @param {object} pagination - { page, limit }
 */
export async function getRaces(filters = {}, pagination = {}) {
  const { page = 1, limit = 20 } = pagination;
  const offset = (page - 1) * limit;

  // Always exclude PENDING races from the public list - they have no
  // winner / times / log so they'd render as broken rows.
  const conditions = [eq(races.status, 'completed')];
  if (filters.trackId) conditions.push(eq(races.trackId, filters.trackId));
  if (filters.weather) conditions.push(eq(races.weather, filters.weather));
  if (filters.timeOfDay) conditions.push(eq(races.timeOfDay, filters.timeOfDay));
  if (filters.droneId) {
    conditions.push(
      or(eq(races.drone1Id, filters.droneId), eq(races.drone2Id, filters.droneId)),
    );
  }
  if (filters.userId) {
    const userDrones = await db
      .select({ id: drones.id })
      .from(drones)
      .where(eq(drones.userId, filters.userId));
    if (userDrones.length === 0) return [];
    const userDroneIds = userDrones.map((d) => d.id);
    conditions.push(
      or(
        inArray(races.drone1Id, userDroneIds),
        inArray(races.drone2Id, userDroneIds),
      ),
    );
  }

  const whereClause = and(...conditions);

  const rows = await db
    .select({ race: races, track: tracks })
    .from(races)
    .leftJoin(tracks, eq(races.trackId, tracks.id))
    .where(whereClause)
    .orderBy(desc(races.createdAt))
    .limit(limit)
    .offset(offset);

  const droneIds = new Set();
  rows.forEach(({ race }) => {
    droneIds.add(race.drone1Id);
    droneIds.add(race.drone2Id);
  });
  const droneList = droneIds.size
    ? await db
        .select({ drone: drones, appliedSkin: skins })
        .from(drones)
        .leftJoin(skins, eq(drones.appliedSkinId, skins.id))
        .where(inArray(drones.id, Array.from(droneIds)))
    : [];
  const droneMap = Object.fromEntries(
    droneList.map(({ drone, appliedSkin }) => [
      drone.id,
      { ...drone, appliedSkin },
    ]),
  );

  return rows.map(({ race, track }) => ({
    ...race,
    track,
    drone1: droneMap[race.drone1Id],
    drone2: droneMap[race.drone2Id],
  }));
}

/**
 * Fetch a single race with all drone + track details, plus a few
 * convenience fields derived from the races table so the detail page
 * can render without extra round trips:
 *   - `isUpset` - true when the winner's pre-race ELO was >= 50 lower
 *     than the loser's.
 *   - `isNewTrackRecord` - true when this race's winning time is the
 *     fastest recorded on the track at/before it ran.
 *   - `h2h` - { total, drone1Wins, drone2Wins } across all prior +
 *     current races between the same two drones in either slot.
 *
 * @param {string} raceId
 */
export async function getRaceById(raceId) {
  const [row] = await db
    .select({ race: races, track: tracks })
    .from(races)
    .leftJoin(tracks, eq(races.trackId, tracks.id))
    .where(eq(races.id, raceId))
    .limit(1);
  if (!row) throw new ApiError('Race not found', 404);

  const race = row.race;

  const droneRows = await db
    .select({ drone: drones, appliedSkin: skins })
    .from(drones)
    .leftJoin(skins, eq(drones.appliedSkinId, skins.id))
    .where(inArray(drones.id, [race.drone1Id, race.drone2Id]));
  const byId = Object.fromEntries(
    droneRows.map(({ drone, appliedSkin }) => [
      drone.id,
      { ...drone, appliedSkin },
    ]),
  );

  // Upset: pre-race ELO gap of 50+ in the loser's favour. Only meaningful
  // for completed races - PENDING rows have no winner yet so isUpset is
  // forced false (the ternary below would otherwise pick drone2EloBefore
  // when winnerDroneId is null, producing nonsense).
  const winnerEloBefore =
    race.winnerDroneId === race.drone1Id
      ? race.drone1EloBefore
      : race.drone2EloBefore;
  const loserEloBefore =
    race.winnerDroneId === race.drone1Id
      ? race.drone2EloBefore
      : race.drone1EloBefore;
  const isUpset =
    race.winnerDroneId != null &&
    winnerEloBefore != null &&
    loserEloBefore != null &&
    winnerEloBefore + 50 <= loserEloBefore;

  // New track record: compare winner's time to the minimum winner time on
  // this track strictly before this race's createdAt. LEAST() picks the
  // faster of the two drone times per row; we want the min across rows.
  const winnerTimeStr =
    race.winnerDroneId === race.drone1Id ? race.drone1Time : race.drone2Time;
  const winnerTime =
    winnerTimeStr != null ? Number(winnerTimeStr) : null;

  let isNewTrackRecord = false;
  if (winnerTime != null && race.trackId) {
    // drizzle-orm/neon-http `execute()` returns { rows, fields, rowCount, ... },
    // not an iterable - destructure off .rows.
    const { rows: [best] } = await db.execute(sql`
      SELECT MIN(LEAST(drone1_time::numeric, drone2_time::numeric)) AS best_time
      FROM races
      WHERE track_id = ${race.trackId}
        AND created_at < ${race.createdAt}
        AND drone1_time IS NOT NULL
        AND drone2_time IS NOT NULL
    `);
    const prevBest =
      best?.best_time != null ? Number(best.best_time) : null;
    isNewTrackRecord = prevBest == null || winnerTime < prevBest;
  }

  // Head-to-head: count across either drone-slot orientation, including
  // this race (keeps the tally stable as users browse old races).
  // Restricted to completed races - PENDING shouldn't count toward h2h.
  const { rows: [h2hRow] } = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      SUM(CASE WHEN winner_drone_id = ${race.drone1Id} THEN 1 ELSE 0 END)::int AS drone1_wins,
      SUM(CASE WHEN winner_drone_id = ${race.drone2Id} THEN 1 ELSE 0 END)::int AS drone2_wins
    FROM races
    WHERE status = 'completed'
      AND ((drone1_id = ${race.drone1Id} AND drone2_id = ${race.drone2Id})
        OR (drone1_id = ${race.drone2Id} AND drone2_id = ${race.drone1Id}))
  `);
  const h2h = {
    total: h2hRow?.total ?? 0,
    drone1Wins: h2hRow?.drone1_wins ?? 0,
    drone2Wins: h2hRow?.drone2_wins ?? 0,
  };

  return {
    ...race,
    track: row.track,
    drone1: byId[race.drone1Id],
    drone2: byId[race.drone2Id],
    isUpset,
    isNewTrackRecord,
    h2h,
  };
}

/** Calculate when the next race cycle will run. Based on the latest
 *  completed race + the cron interval; PENDING races are still in
 *  flight so they don't anchor "next race" time. */
export async function getNextRaceTime() {
  const cfg = await loadConfig();
  const [latest] = await db
    .select({ createdAt: races.createdAt })
    .from(races)
    .where(eq(races.status, 'completed'))
    .orderBy(desc(races.createdAt))
    .limit(1);
  const last = latest?.createdAt ?? new Date();
  const next = new Date(new Date(last).getTime() + cfg.raceIntervalSeconds * 1000);
  return next;
}

/**
 * Recent COMPLETED races for a single drone, newest first.
 * @param {string} droneId
 * @param {number} limit
 */
export async function getDroneRaceHistory(droneId, limit = 10) {
  return db
    .select()
    .from(races)
    .where(
      and(
        eq(races.status, 'completed'),
        or(eq(races.drone1Id, droneId), eq(races.drone2Id, droneId)),
      ),
    )
    .orderBy(desc(races.createdAt))
    .limit(limit);
}

/** Total race count (used by the races page header).
 *  When `filters.userId` is set, counts only races where one of the user's
 *  drones raced in either slot - so the header value matches the "Your
 *  Races" toggle on the races page.
 *  @param {{ userId?: string }} [filters]
 */
export async function getTotalRaceCount(filters = {}) {
  // Only completed races count toward the public "total" - PENDING are
  // mid-flight and shouldn't inflate the header tally.
  if (filters.userId) {
    const userDrones = await db
      .select({ id: drones.id })
      .from(drones)
      .where(eq(drones.userId, filters.userId));
    if (userDrones.length === 0) return 0;
    const ids = userDrones.map((d) => d.id);
    const [row] = await db
      .select({ count: sql`count(*)::int` })
      .from(races)
      .where(
        and(
          eq(races.status, 'completed'),
          or(inArray(races.drone1Id, ids), inArray(races.drone2Id, ids)),
        ),
      );
    return row?.count ?? 0;
  }
  const [row] = await db
    .select({ count: sql`count(*)::int` })
    .from(races)
    .where(eq(races.status, 'completed'));
  return row?.count ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Pending race queries (strategy-window views)                                */
/* -------------------------------------------------------------------------- */

/**
 * Shape one PENDING race row + joined drone/track/skin data into the
 * response shape used by /api/races/upcoming and /api/races/upcoming/[droneId].
 *
 * Intentionally drops image fields - the frontend resolves drone images
 * via the existing getDroneImage(drone) util (which uses level + skin)
 * and tracks via track.imageUrl directly. Stats are nested into a single
 * object for ergonomic client-side rendering.
 */
function shapePendingRace(race, track, drone1, drone2, viewerUserId) {
  const buildDrone = (d) => {
    if (!d) return null;
    return {
      id: d.id,
      name: d.name,
      level: d.level,
      elo: d.eloRating,
      ownerId: d.userId ?? null,
      ownerName: d.ownerName ?? null,
      stats: {
        speed: d.speed,
        turning: d.turning,
        acceleration: d.acceleration,
        durability: d.durability,
        nightVision: d.nightVision,
        batteryCapacity: d.batteryCapacity,
        rainHandling: d.rainHandling,
        windResistance: d.windResistance,
        consistency: d.consistency,
      },
      isBot: d.isBot,
      appliedSkin: d.appliedSkin
        ? {
            id: d.appliedSkin.id,
            name: d.appliedSkin.name,
            rarity: d.appliedSkin.rarity,
            imageUrl: d.appliedSkin.imageUrl,
          }
        : null,
      imageUrl: d.imageUrl,
    };
  };

  // userDroneId: id of whichever side the viewer owns. If they own
  // both (rare same-bracket self-vs-self edge case), prefer drone1.
  let userDroneId = null;
  if (viewerUserId) {
    if (drone1?.userId === viewerUserId) userDroneId = drone1.id;
    else if (drone2?.userId === viewerUserId) userDroneId = drone2.id;
  }

  return {
    id: race.id,
    status: race.status,
    scheduledAt: race.scheduledAt,
    track: {
      id: track.id,
      name: track.name,
      imageUrl: track.imageUrl,
      difficulty: track.difficulty,
      straights: track.straights,
      turns: track.turns,
      laps: track.laps,
      length: track.length,
    },
    conditions: {
      weather: race.weather,
      timeOfDay: race.timeOfDay,
    },
    drone1: buildDrone(drone1),
    drone2: buildDrone(drone2),
    userDroneId,
  };
}

/** Load drone rows + applied-skin rows + owner usernames for a set of ids. */
async function loadDronesWithJoins(droneIds) {
  if (droneIds.length === 0) return {};
  const rows = await db
    .select({
      drone: drones,
      appliedSkin: skins,
      ownerName: users.username,
    })
    .from(drones)
    .leftJoin(skins, eq(drones.appliedSkinId, skins.id))
    .leftJoin(users, eq(drones.userId, users.id))
    .where(inArray(drones.id, droneIds));
  return Object.fromEntries(
    rows.map(({ drone, appliedSkin, ownerName }) => [
      drone.id,
      { ...drone, appliedSkin, ownerName },
    ]),
  );
}

/**
 * Every PENDING race that the given user has a drone in.
 * @param {string} userId
 */
export async function getUpcomingRacesForUser(userId) {
  // Find user's drones first so we can scope the race query.
  const userDrones = await db
    .select({ id: drones.id })
    .from(drones)
    .where(eq(drones.userId, userId));
  if (userDrones.length === 0) return [];
  const droneIds = userDrones.map((d) => d.id);

  const rows = await db
    .select({ race: races, track: tracks })
    .from(races)
    .leftJoin(tracks, eq(races.trackId, tracks.id))
    .where(
      and(
        eq(races.status, 'pending'),
        or(
          inArray(races.drone1Id, droneIds),
          inArray(races.drone2Id, droneIds),
        ),
      ),
    )
    .orderBy(races.scheduledAt);

  if (rows.length === 0) return [];

  const allDroneIds = new Set();
  rows.forEach(({ race }) => {
    allDroneIds.add(race.drone1Id);
    allDroneIds.add(race.drone2Id);
  });
  const droneMap = await loadDronesWithJoins(Array.from(allDroneIds));

  return rows.map(({ race, track }) =>
    shapePendingRace(
      race,
      track,
      droneMap[race.drone1Id],
      droneMap[race.drone2Id],
      userId,
    ),
  );
}

/**
 * The single PENDING race a specific drone is in, or null.
 * Caller is responsible for any access checks (the route layer
 * verifies the drone belongs to the authenticated user).
 * @param {string} droneId
 * @param {string} viewerUserId - ownership context used to set userDroneId
 */
export async function getUpcomingRaceForDrone(droneId, viewerUserId) {
  const [row] = await db
    .select({ race: races, track: tracks })
    .from(races)
    .leftJoin(tracks, eq(races.trackId, tracks.id))
    .where(
      and(
        eq(races.status, 'pending'),
        or(eq(races.drone1Id, droneId), eq(races.drone2Id, droneId)),
      ),
    )
    .orderBy(races.scheduledAt)
    .limit(1);

  if (!row) return null;
  const droneMap = await loadDronesWithJoins([row.race.drone1Id, row.race.drone2Id]);
  return shapePendingRace(
    row.race,
    row.track,
    droneMap[row.race.drone1Id],
    droneMap[row.race.drone2Id],
    viewerUserId,
  );
}
