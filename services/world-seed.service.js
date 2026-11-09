/**
 * The world seed (SPEC.md 2.3, 6, 13): the tracks, Season 1, the `racing_enabled` switch, the
 * contract-owned bots and the catalog cache. Every step reads what exists first and writes only what is missing,
 * so the seed can run any number of times; a run that stopped part way resumes on the next one.
 * The chain is the source of truth for bots: a bot is a drone the contract account owns that is not
 * a listing in escrow.
 */
import { randomInt as cryptoRandomInt } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/lib/db';
import { generateUniqueDroneName } from '@/lib/game-engine/drone-names.js';
import { calculateTSB, calculateXPToNextLevel } from '@/lib/game-engine/economy.js';
import { getLevelBracket } from '@/lib/game-engine/matchmaking.js';
import { droneImagePath } from '@/lib/game-engine/skin-templates.js';
import { statsFromArray } from '@/lib/game-engine/templates.js';
import { TRACKS } from '@/lib/game-engine/tracks.js';
import { getNear } from '@/lib/near';
import { BOTS_PER_BRACKET, botRoster, walkStats } from '@/lib/world/bot-roster.js';
import { syncCatalog } from './catalog.service.js';

const { adminConfig, drones, seasons, tracks } = schema;

/**
 * @typedef {{ db?: any, near?: import('@/lib/near').NearAdapter, randomInt?: (max: number) => number, onMint?: (tx: SeedTx) => void }} Deps
 *   `onMint` is called after each bot mint, so a run that stops later has still reported it
 * @typedef {{ step: string, created: number, updated: number, skipped: number, note: string }} StepReport
 * @typedef {{ label: string, txHash: string, url: string }} SeedTx
 * @typedef {{ token_id: string, owner: string, listed: boolean, hot: { level: number, xp: number, elo: number, wins: number, losses: number, in_batch: number | null }, cold: { stats: number[], name: string } }} ChainDrone
 */

/** Tokens per `nft_tokens_for_owner` page and per `get_drones` call. */
const PAGE = 50;

/** The switch the scheduler reads before it commits a batch (SPEC.md 6). */
const RACING_KEY = 'racing_enabled';

/** The season the leaderboard shows (SPEC.md 6): November 1 to 25, 2026, whole days in UTC. */
export const SEASON_1 = {
  seasonNumber: 1,
  startDate: new Date('2026-11-01T00:00:00Z'),
  endDate: new Date('2026-11-25T23:59:59Z'),
  isActive: true,
};

/**
 * Run every step of the world seed.
 * @param {{ racingOn?: boolean }} [options] `racingOn` sets `racing_enabled` to true
 * @param {Deps} [deps]
 * @returns {Promise<{ steps: StepReport[], txs: SeedTx[] }>}
 */
export async function seedWorld({ racingOn = false } = {}, deps = {}) {
  const db = deps.db ?? defaultDb;
  const near = deps.near ?? getNear();
  const randomInt = deps.randomInt ?? cryptoRandomInt;
  const trackStep = await seedTracks(db);
  const seasonStep = await seedSeason(db);
  const bots = await seedBots({ db, near, randomInt, onMint: deps.onMint });
  const catalog = await syncCatalog({ db, near });
  // Last, so racing is never switched on over a roster a stopped run left incomplete.
  const switchStep = await seedRacingSwitch(db, racingOn);
  return {
    steps: [
      trackStep,
      seasonStep,
      switchStep,
      ...bots.steps,
      { step: 'catalog skins', ...catalog.skins, note: 'from get_catalog, Ember cap null' },
      { step: 'catalog mods', ...catalog.mods, note: 'from get_catalog' },
    ],
    txs: bots.txs,
  };
}

/**
 * Step 1: the SPEC.md 2.9 tracks, matched by name. A row whose numbers differ from the table the
 * contract settles with is corrected; its id, and so every race that points at it, stays.
 * @param {any} db
 * @returns {Promise<StepReport>}
 */
async function seedTracks(db) {
  /** @type {(typeof tracks.$inferSelect)[]} */
  const rows = await db.select().from(tracks);
  const byName = new Map(rows.map((r) => [r.name, r]));
  const report = { step: 'tracks', created: 0, updated: 0, skipped: 0, note: '' };
  for (const t of TRACKS) {
    const want = {
      straights: t.straights,
      turns: t.turns,
      length: t.length,
      difficulty: t.difficulty,
      levelMin: t.minLevel,
      levelMax: t.maxLevel,
    };
    const row = byName.get(t.name);
    if (!row) {
      const imageUrl = `/tracks/${t.name.toLowerCase().replace(/ /g, '_')}.webp`;
      await db.insert(tracks).values({ name: t.name, ...want, imageUrl });
      report.created += 1;
    } else if (
      /** @type {(keyof typeof want)[]} */ (Object.keys(want)).some((k) => row[k] !== want[k])
    ) {
      await db.update(tracks).set(want).where(eq(tracks.id, row.id));
      report.updated += 1;
    } else {
      report.skipped += 1;
    }
  }
  report.note = `${TRACKS.length} in lib/game-engine/tracks.js`;
  return report;
}

/**
 * Season 1, matched by number. A row whose dates or active flag differ is corrected in place.
 * @param {any} db
 * @returns {Promise<StepReport>}
 */
export async function seedSeason(db) {
  const report = {
    step: 'seasons',
    created: 0,
    updated: 0,
    skipped: 0,
    note: 'Season 1, Nov 1 to Nov 25, 2026',
  };
  const { seasonNumber, startDate, endDate, isActive } = SEASON_1;
  const [row] = await db.select().from(seasons).where(eq(seasons.seasonNumber, seasonNumber));
  if (!row) {
    await db.insert(seasons).values(SEASON_1).onConflictDoNothing();
    report.created = 1;
  } else if (
    row.startDate.getTime() !== startDate.getTime() ||
    row.endDate.getTime() !== endDate.getTime() ||
    row.isActive !== isActive
  ) {
    await db.update(seasons).set({ startDate, endDate, isActive }).where(eq(seasons.id, row.id));
    report.updated = 1;
  } else {
    report.skipped = 1;
  }
  return report;
}

/**
 * Step 2: the `admin_config` row the app reads. Created `false`; `racingOn` makes it `true`. The
 * seed never turns racing off.
 * @param {any} db
 * @param {boolean} racingOn
 * @returns {Promise<StepReport>}
 */
async function seedRacingSwitch(db, racingOn) {
  const report = { step: 'admin_config', created: 0, updated: 0, skipped: 0, note: '' };
  const [row] = await db.select().from(adminConfig).where(eq(adminConfig.key, RACING_KEY)).limit(1);
  let value = row?.value;
  if (!row) {
    value = racingOn ? 'true' : 'false';
    await db
      .insert(adminConfig)
      .values({
        key: RACING_KEY,
        value,
        description: 'true: the scheduler commits a batch every tick. false: it only settles.',
      })
      .onConflictDoNothing();
    report.created = 1;
  } else if (racingOn && row.value !== 'true') {
    value = 'true';
    await db
      .update(adminConfig)
      .set({ value, updatedAt: new Date() })
      .where(eq(adminConfig.key, RACING_KEY));
    report.updated = 1;
  } else {
    report.skipped = 1;
  }
  report.note = `${RACING_KEY} = ${value}`;
  return report;
}

/**
 * Step 3: the bots. Each bracket is topped up to `BOTS_PER_BRACKET` contract-owned drones with
 * `mint_drone` (ops key, owner = the game account), and every bot on chain gets its cache row.
 * Brackets are counted by the bots' current levels: bots earn XP, so once one has levelled out of
 * its bracket a later run mints its replacement there.
 * @param {{ db: any, near: import('@/lib/near').NearAdapter, randomInt: (max: number) => number, onMint?: (tx: SeedTx) => void }} ctx
 * @returns {Promise<{ steps: StepReport[], txs: SeedTx[] }>}
 */
async function seedBots({ db, near, randomInt, onMint }) {
  const onChain = await chainBots(near);
  /** @type {SeedTx[]} */
  const txs = [];
  const minted = { step: 'bots minted', created: 0, updated: 0, skipped: onChain.length, note: '' };
  const cached = await cacheBots(db, onChain);
  /** @type {Record<string, number>} */
  const have = {};
  for (const bot of onChain) {
    const bracket = getLevelBracket(bot.hot.level);
    have[bracket] = (have[bracket] ?? 0) + 1;
  }
  for (const { level } of botRoster().filter((b) => b.slot >= (have[b.bracket] ?? 0))) {
    const name = await generateUniqueDroneName(db, drones);
    const res = await near.callAsOps('mint_drone', {
      owner: near.gameId,
      name,
      level,
      stats: walkStats(level, randomInt),
      active_hint: true,
    });
    const token = String(res.result);
    const tx = {
      label: `mint_drone ${name} (level ${level}) -> ${token}`,
      txHash: res.txHash,
      url: near.explorerTx(res.txHash),
    };
    txs.push(tx);
    onMint?.(tx);
    const view = /** @type {ChainDrone | null} */ (await near.view('get_drone', { token }));
    if (!view) throw new Error(`minted bot ${token} is not readable`);
    // Cached at once, so a run that stops here leaves no minted bot without its row.
    cached.created += (await cacheBots(db, [view])).created;
    minted.created += 1;
  }
  minted.note = `owner ${near.gameId}, ${BOTS_PER_BRACKET} per bracket`;
  return { steps: [minted, cached], txs };
}

/**
 * Every bot on chain: the drones the game account owns, less the listings it holds in escrow.
 * The owner's token count is read first: `nft_tokens_for_owner` panics on a `from_index` at or
 * past the end, so a page is asked for only while tokens remain.
 * @param {import('@/lib/near').NearAdapter} near
 * @returns {Promise<ChainDrone[]>}
 */
async function chainBots(near) {
  const supply = Number(await near.view('nft_supply_for_owner', { account_id: near.gameId }));
  /** @type {string[]} */
  const tokens = [];
  for (let from = 0; from < supply; from += PAGE) {
    const page = /** @type {{ token_id: string }[] | null} */ (
      await near.view('nft_tokens_for_owner', {
        account_id: near.gameId,
        from_index: String(from),
        limit: PAGE,
      })
    );
    tokens.push(...(page ?? []).map((t) => t.token_id));
  }
  const droneTokens = tokens.filter((t) => t.startsWith('d:'));
  /** @type {ChainDrone[]} */
  const bots = [];
  for (let i = 0; i < droneTokens.length; i += PAGE) {
    const views = /** @type {(ChainDrone | null)[]} */ (
      await near.view('get_drones', { tokens: droneTokens.slice(i, i + PAGE) })
    );
    for (const v of views) if (v && v.owner === near.gameId && !v.listed) bots.push(v);
  }
  return bots;
}

/**
 * Cache rows for bots: a missing row is inserted from the chain view, an ownerless row not flagged as
 * a bot is flagged, the rest are left to the settlement events that keep them current. A row that
 * belongs to a user is never turned into a bot: that is a cache from another contract deployment,
 * and the seed stops.
 * @param {any} db
 * @param {ChainDrone[]} bots
 * @returns {Promise<StepReport>}
 */
async function cacheBots(db, bots) {
  const report = { step: 'bots cached', created: 0, updated: 0, skipped: 0, note: 'is_bot true' };
  if (bots.length === 0) return report;
  /** @type {{ id: string, tokenId: string | null, isBot: boolean, userId: string | null }[]} */
  const rows = await db
    .select({ id: drones.id, tokenId: drones.tokenId, isBot: drones.isBot, userId: drones.userId })
    .from(drones)
    .where(
      inArray(
        drones.tokenId,
        bots.map((b) => b.token_id)
      )
    );
  const byToken = new Map(rows.map((r) => [r.tokenId, r]));
  for (const bot of bots) {
    const row = byToken.get(bot.token_id);
    if (!row) {
      const { hot, cold } = bot;
      await db
        .insert(drones)
        .values({
          userId: null,
          name: cold.name,
          level: hot.level,
          xp: hot.xp,
          xpToNextLevel: calculateXPToNextLevel(hot.level),
          totalStatBudget: calculateTSB(hot.level),
          ...statsFromArray(cold.stats),
          eloRating: hot.elo,
          wins: hot.wins,
          losses: hot.losses,
          totalRaces: hot.wins + hot.losses,
          imageUrl: droneImagePath(hot.level, null),
          active: true,
          isBot: true,
          tokenId: bot.token_id,
          inBatch: hot.in_batch,
          chainSyncedAt: new Date(),
        })
        .onConflictDoNothing();
      report.created += 1;
    } else if (row.userId) {
      throw new Error(
        `${bot.token_id} is a bot on chain, and its cache row belongs to a user: this database caches another contract`
      );
    } else if (!row.isBot) {
      await db.update(drones).set({ isBot: true }).where(eq(drones.id, row.id));
      report.updated += 1;
    } else {
      report.skipped += 1;
    }
  }
  return report;
}
