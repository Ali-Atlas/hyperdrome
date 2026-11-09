/**
 * The world seed (services/world-seed.service.js, services/catalog.service.js; SPEC.md 2.3, 13)
 * against the mock adapter and a real Postgres: what a first run creates, that a second run creates
 * nothing and reports every step skipped, that a stopped run resumes, and the `racing_enabled`
 * switch. The tracks, `admin_config` and catalog tables are shared by every test file and survive
 * between local runs, so first-run counts are asserted only for what lives on this test's chain.
 */
import { randomInt } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { schema } from '../../lib/db/index.js';
import { calculatePerStatCap, calculateTSB } from '../../lib/game-engine/economy.js';
import { getLevelBracket } from '../../lib/game-engine/matchmaking.js';
import { TRACKS } from '../../lib/game-engine/tracks.js';
import {
  BOTS_PER_BRACKET,
  BOT_BRACKET_LEVELS,
  botRoster,
  walkStats,
} from '../../lib/world/bot-roster.js';
import { getSkinCatalog } from '../../services/catalog.service.js';
import { SEASON_1, seedWorld } from '../../services/world-seed.service.js';
import { dbEnabled, newPlayer, testDb } from '../gameplay/setup.js';
import { catalogView, createFakeWorld } from './fake-world.js';

const { adminConfig, catalogTemplates, drones, seasons, tracks } = schema;

/** @param {{ step: string }[]} steps @param {string} name */
const stepOf = (steps, name) => steps.find((s) => s.step === name);

describe('bot roster', () => {
  it('is 20 bots, 5 for each bracket that can hold a drone, at the SPEC 2.3 levels', () => {
    const roster = botRoster();
    expect(roster).toHaveLength(20);
    for (const [bracket, levels] of Object.entries(BOT_BRACKET_LEVELS)) {
      const inBracket = roster.filter((b) => b.bracket === bracket);
      expect(inBracket).toHaveLength(BOTS_PER_BRACKET);
      for (const bot of inBracket) {
        expect(levels).toContain(bot.level);
        expect(getLevelBracket(bot.level)).toBe(bracket);
      }
    }
    expect([...new Set(roster.map((b) => b.level))].sort((a, b) => a - b)).toEqual([
      2, 4, 7, 9, 12, 14, 17, 19,
    ]);
  });

  it('walks every stat line to TSB(L) without passing cap(L)', () => {
    for (let level = 1; level <= 20; level++) {
      const stats = walkStats(level, randomInt);
      expect(stats).toHaveLength(9);
      expect(Math.min(...stats)).toBeGreaterThanOrEqual(1);
      expect(Math.max(...stats)).toBeLessThanOrEqual(calculatePerStatCap(level));
      expect(stats.reduce((a, b) => a + b, 0)).toBe(calculateTSB(level));
    }
  });
});

describe.skipIf(!dbEnabled)('world seed', () => {
  const db = testDb();
  /** @type {ReturnType<typeof createFakeWorld>[]} */
  const worlds = [];
  /** A fake world whose minted tokens are removed from the shared database afterwards. */
  const world = (/** @type {Parameters<typeof createFakeWorld>[0]} */ options = {}) => {
    const w = createFakeWorld(options);
    worlds.push(w);
    return w;
  };
  afterAll(async () => {
    const minted = worlds.flatMap((w) => w.minted);
    if (minted.length > 0) await db.delete(drones).where(inArray(drones.tokenId, minted));
    await db?.$client?.end?.();
  });

  /** @param {string[]} minted */
  const botRows = (minted) => db.select().from(drones).where(inArray(drones.tokenId, minted));

  it('seeds tracks, the switch, 20 bots and the catalog; a second run creates nothing and skips every step', async () => {
    const w = world();
    const escrowed = w.addEscrowedListing(3);
    const first = await seedWorld({}, { db, near: w.near });

    expect(first.steps.map((s) => s.step)).toEqual([
      'tracks',
      'seasons',
      'admin_config',
      'bots minted',
      'bots cached',
      'catalog skins',
      'catalog mods',
    ]);
    expect(stepOf(first.steps, 'bots minted')).toMatchObject({ created: 20, skipped: 0 });
    expect(stepOf(first.steps, 'bots cached')).toMatchObject({ created: 20, skipped: 0 });
    expect(first.txs).toHaveLength(20);
    expect(first.txs[0].url).toBe(`https://testnet.nearblocks.io/txns/${first.txs[0].txHash}`);

    // Every mint goes to the contract account, at the roster's levels, with a legal stat line.
    const mints = w.mintArgs();
    expect(mints).toHaveLength(20);
    expect(mints.map((m) => m.level).sort()).toEqual(
      botRoster()
        .map((b) => b.level)
        .sort()
    );
    for (const m of mints) {
      const stats = /** @type {number[]} */ (m.stats);
      expect(m.owner).toBe(w.near.gameId);
      expect(m.name).toMatch(/^[A-Z]+-[A-Z]\d/);
      expect(stats.reduce((a, b) => a + b, 0)).toBe(calculateTSB(Number(m.level)));
      expect(Math.max(...stats)).toBeLessThanOrEqual(calculatePerStatCap(Number(m.level)));
    }

    // The cache: 20 bot rows without an owner, 5 in each bracket; the escrowed listing is no bot.
    const rows = await botRows(w.minted);
    expect(rows).toHaveLength(20);
    for (const row of rows) {
      expect(row).toMatchObject({ isBot: true, userId: null, eloRating: 1000 });
      expect(row.totalStatBudget).toBe(calculateTSB(row.level));
    }
    for (const bracket of Object.keys(BOT_BRACKET_LEVELS)) {
      expect(
        rows.filter((/** @type {{ level: number }} */ r) => getLevelBracket(r.level) === bracket)
      ).toHaveLength(5);
    }
    expect(await botRows([escrowed])).toHaveLength(0);

    // Tracks, the switch and the catalog exist whatever this run or an earlier one created.
    const trackRows = await db.select().from(tracks);
    for (const t of TRACKS) {
      expect(
        trackRows.find((/** @type {{ name: string }} */ r) => r.name === t.name)
      ).toMatchObject({
        straights: t.straights,
        turns: t.turns,
        difficulty: t.difficulty,
        levelMin: t.minLevel,
        levelMax: t.maxLevel,
        length: t.length,
      });
    }
    const [flag] = await db.select().from(adminConfig).where(eq(adminConfig.key, 'racing_enabled'));
    expect(['true', 'false']).toContain(flag.value);
    const skins = await getSkinCatalog({ db });
    expect(skins).toHaveLength(32);
    expect(skins.find((s) => s.template === 4)).toMatchObject({
      name: 'Ember',
      rarity: 'common',
      imageUrl: '/skins/common/ember.webp',
      cap: null,
    });
    expect(skins.filter((s) => s.cap === null)).toHaveLength(1);
    expect(skins.find((s) => s.template === 27)).toMatchObject({
      name: 'Diamond Hands',
      imageUrl: '/skins/legendary/diamond_hand.webp',
      cap: 3,
    });
    const [phantom] = await db
      .select()
      .from(catalogTemplates)
      .where(and(eq(catalogTemplates.kind, 'mod'), eq(catalogTemplates.template, 24)));
    expect(phantom).toMatchObject({
      name: 'Phantom Drive',
      rarity: 'legendary',
      cap: null,
      data: {
        special: 'phantom_drive',
        bonusStat: null,
        penaltyStat: 'windResistance',
        penaltyPct: 5,
      },
    });

    // The second run: nothing created or updated, every step skipped, no ops call.
    const opsBefore = w.near.mock.calls.filter((c) => c.kind === 'ops').length;
    const second = await seedWorld({}, { db, near: w.near });
    expect(second.txs).toEqual([]);
    expect(
      second.steps.map(({ step, created, updated, skipped }) => [step, created, updated, skipped])
    ).toEqual([
      ['tracks', 0, 0, 16],
      ['seasons', 0, 0, 1],
      ['admin_config', 0, 0, 1],
      ['bots minted', 0, 0, 20],
      ['bots cached', 0, 0, 20],
      ['catalog skins', 0, 0, 32],
      ['catalog mods', 0, 0, 26],
    ]);
    expect(w.near.mock.calls.filter((c) => c.kind === 'ops')).toHaveLength(opsBefore);
    expect(await botRows(w.minted)).toHaveLength(20);
  });

  it('resumes a run that stopped part way: 20 bots in the end, each minted and cached once', async () => {
    const w = world({ failMintAt: 8 });
    await expect(seedWorld({}, { db, near: w.near })).rejects.toThrow('injected mint failure');
    expect(w.minted).toHaveLength(7);
    expect(await botRows(w.minted)).toHaveLength(7);

    const resumed = await seedWorld({}, { db, near: w.near });
    expect(stepOf(resumed.steps, 'bots minted')).toMatchObject({ created: 13, skipped: 7 });
    expect(stepOf(resumed.steps, 'bots cached')).toMatchObject({ created: 13, skipped: 7 });
    expect(w.minted).toHaveLength(20);
    const rows = await botRows(w.minted);
    expect(rows).toHaveLength(20);
    for (const bracket of Object.keys(BOT_BRACKET_LEVELS)) {
      expect(
        rows.filter((/** @type {{ level: number }} */ r) => getLevelBracket(r.level) === bracket)
      ).toHaveLength(5);
    }
  });

  it('reads every page of the contract account: 20 bots among exactly 50 and 120 tokens', async () => {
    for (const escrowed of [30, 100]) {
      const w = world();
      w.addEscrowedItems(escrowed - 2);
      w.addEscrowedListing(3);
      w.addEscrowedListing(8);
      /** @type {string[]} */
      const seen = [];
      const first = await seedWorld({}, { db, near: w.near, onMint: (tx) => seen.push(tx.txHash) });
      expect(stepOf(first.steps, 'bots minted')).toMatchObject({ created: 20, skipped: 0 });
      expect(seen).toEqual(first.txs.map((tx) => tx.txHash));
      // 20 bots and the escrowed tokens: a full last page, which the contract refuses to go past.
      const second = await seedWorld({}, { db, near: w.near });
      expect(stepOf(second.steps, 'bots minted')).toMatchObject({ created: 0, skipped: 20 });
      expect(stepOf(second.steps, 'bots cached')).toMatchObject({ created: 0, skipped: 20 });
    }
  });

  it('stops when a bot on chain has a cache row that belongs to a user', async () => {
    const w = world();
    await seedWorld({}, { db, near: w.near });
    const { user } = await newPlayer(db, w.near);
    await db.update(drones).set({ userId: user.id }).where(eq(drones.tokenId, w.minted[0]));
    await expect(seedWorld({}, { db, near: w.near })).rejects.toThrow('belongs to a user');
    const [row] = await botRows([w.minted[0]]);
    expect(row).toMatchObject({ userId: user.id });
  });

  it('caches a bot that is on chain without a row, and repairs a catalog row that drifted', async () => {
    const w = world();
    await seedWorld({}, { db, near: w.near });
    await db.delete(drones).where(eq(drones.tokenId, w.minted[0]));
    w.setCatalog(catalogView({ skinCaps: { 1: 9 } }));
    const repaired = await seedWorld({}, { db, near: w.near });
    expect(stepOf(repaired.steps, 'bots minted')).toMatchObject({ created: 0, skipped: 20 });
    expect(stepOf(repaired.steps, 'bots cached')).toMatchObject({ created: 1, skipped: 19 });
    expect(stepOf(repaired.steps, 'catalog skins')).toMatchObject({
      created: 0,
      updated: 1,
      skipped: 31,
    });
    expect((await getSkinCatalog({ db })).find((s) => s.template === 1)?.cap).toBe(9);

    w.setCatalog(catalogView());
    const restored = await seedWorld({}, { db, near: w.near });
    expect(stepOf(restored.steps, 'catalog skins')).toMatchObject({ updated: 1, skipped: 31 });
    expect((await getSkinCatalog({ db })).find((s) => s.template === 1)?.cap).toBe(10);
  });

  it('creates Season 1, repairs a row that drifted, then skips', async () => {
    const w = world();
    const deps = { db, near: w.near };
    await db.delete(seasons).where(eq(seasons.seasonNumber, 1));
    const created = await seedWorld({}, deps);
    expect(stepOf(created.steps, 'seasons')).toMatchObject({ created: 1, updated: 0, skipped: 0 });
    const [row] = await db.select().from(seasons).where(eq(seasons.seasonNumber, 1));
    expect(row).toMatchObject(SEASON_1);

    await db
      .update(seasons)
      .set({ endDate: new Date('2026-12-01T00:00:00Z') })
      .where(eq(seasons.seasonNumber, 1));
    const repaired = await seedWorld({}, deps);
    expect(stepOf(repaired.steps, 'seasons')).toMatchObject({ created: 0, updated: 1, skipped: 0 });
    const [fixed] = await db.select().from(seasons).where(eq(seasons.id, row.id));
    expect(fixed.endDate).toEqual(SEASON_1.endDate);

    const again = await seedWorld({}, deps);
    expect(stepOf(again.steps, 'seasons')).toMatchObject({ created: 0, updated: 0, skipped: 1 });
  });

  it('creates racing_enabled false, turns it on only with racingOn and never turns it off', async () => {
    const w = world();
    const deps = { db, near: w.near };
    const value = async () =>
      (await db.select().from(adminConfig).where(eq(adminConfig.key, 'racing_enabled')))[0]?.value;

    await db.delete(adminConfig).where(eq(adminConfig.key, 'racing_enabled'));
    const created = await seedWorld({}, deps);
    expect(stepOf(created.steps, 'admin_config')).toMatchObject({
      created: 1,
      updated: 0,
      skipped: 0,
    });
    expect(await value()).toBe('false');

    expect(stepOf((await seedWorld({}, deps)).steps, 'admin_config')).toMatchObject({ skipped: 1 });
    expect(await value()).toBe('false');

    const on = await seedWorld({ racingOn: true }, deps);
    expect(stepOf(on.steps, 'admin_config')).toMatchObject({ created: 0, updated: 1, skipped: 0 });
    expect(await value()).toBe('true');

    const again = await seedWorld({ racingOn: true }, deps);
    expect(stepOf(again.steps, 'admin_config')).toMatchObject({
      created: 0,
      updated: 0,
      skipped: 1,
    });
    expect(stepOf((await seedWorld({}, deps)).steps, 'admin_config')).toMatchObject({ skipped: 1 });
    expect(await value()).toBe('true');
  });
});
