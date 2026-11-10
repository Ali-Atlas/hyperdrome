/**
 * Test fixtures (lib/teams/fixtures.js) stay out of the public views, as bots do: the player and
 * drone leaderboards, the rank, the marketplace feed, the landing strip's trades and the economy
 * snapshot's open listings (services/fixture-filter.js). Against the test database.
 */
import { randomUUID } from 'node:crypto';
import { eq, inArray, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '../../lib/db/index.js';
import { FIXTURE_EMAILS } from '../../lib/teams/fixtures.js';
import { writeEconomySnapshot } from '../../services/economy-snapshot.js';
import { getLiveStrip } from '../../services/live.service.js';
import { createMockNear, dbEnabled, newDrone, testDb } from '../gameplay/setup.js';

/**
 * The leaderboard and marketplace services are baseline files outside `tsconfig.typecheck.json`
 * (ENGINEERING.md ratchet), so they are loaded by a computed path the type checker does not follow.
 * @param {string} name
 * @returns {Promise<any>}
 */
const service = (name) => import(`../../services/${name}.service.js`);
const { getDroneLeaderboard, getPlayerLeaderboard, getUserRank } = await service('leaderboard');
const { getListings } = await service('marketplace');

const { users, drones, marketplaceListings, economySnapshots } = schema;
/** Above any real rating, so both rows lead every sort that matters here. */
const TOP_ELO = 9_000_000;

describe.skipIf(!dbEnabled)('test fixtures in public views', () => {
  const db = testDb();
  /** @type {{ fixture: any, player: any, fixtureDrone: any, playerDrone: any }} */
  const rows = /** @type {any} */ ({});

  const clean = async () => {
    const fixtures = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.email, [...FIXTURE_EMAILS]));
    const ids = [
      ...fixtures.map((/** @type {{ id: string }} */ u) => u.id),
      ...(rows.player ? [rows.player.id] : []),
    ];
    if (ids.length === 0) return;
    await db
      .delete(marketplaceListings)
      .where(
        or(inArray(marketplaceListings.sellerId, ids), inArray(marketplaceListings.buyerId, ids))
      );
    await db.delete(drones).where(inArray(drones.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  };

  beforeAll(async () => {
    await clean();
    [rows.fixture] = await db
      .insert(users)
      .values({
        email: FIXTURE_EMAILS[0],
        username: 'Test Rogue Agent',
        isTeam: true,
        eloRating: TOP_ELO + 1,
        totalRaces: 5,
        totalWins: 5,
      })
      .returning();
    [rows.player] = await db
      .insert(users)
      .values({
        email: `${randomUUID()}@test.local`,
        username: 'REALPLAYER',
        eloRating: TOP_ELO,
        totalRaces: 5,
        totalWins: 4,
      })
      .returning();
    rows.fixtureDrone = await newDrone(db, rows.fixture.id);
    rows.playerDrone = await newDrone(db, rows.player.id);
    await db
      .update(drones)
      .set({ eloRating: TOP_ELO + 1, totalRaces: 5, wins: 5 })
      .where(eq(drones.id, rows.fixtureDrone.id));
    await db
      .update(drones)
      .set({ eloRating: TOP_ELO, totalRaces: 5, wins: 4 })
      .where(eq(drones.id, rows.playerDrone.id));
  });
  afterAll(clean);

  it('leaves the fixture out of the player leaderboard, every sort, and out of the rank', async () => {
    for (const sort of ['elo', 'win_rate']) {
      const board = await getPlayerLeaderboard(sort, 50, 0);
      const ids = board.map((/** @type {{ id: string }} */ r) => r.id);
      expect(ids).not.toContain(rows.fixture.id);
      if (sort === 'elo') expect(ids[0]).toBe(rows.player.id);
    }
    expect(await getUserRank(rows.player.id)).toBe(1);
  });

  it('leaves its drones out of the drone leaderboard, every sort', async () => {
    for (const sort of ['elo', 'win_rate']) {
      const board = await getDroneLeaderboard(sort, 50, 0);
      const ids = board.map((/** @type {{ id: string }} */ d) => d.id);
      expect(ids).not.toContain(rows.fixtureDrone.id);
      if (sort === 'elo') expect(ids[0]).toBe(rows.playerDrone.id);
    }
  });

  it('leaves its listings and purchases out of the marketplace feed and the strip trades', async () => {
    const near = createMockNear();
    const nowMs = Date.now();
    const before = (await getLiveStrip(nowMs, { db, near })).today.trades;
    const sold = { itemType: 'drone', price: 100, status: 'sold', soldAt: new Date(nowMs) };
    const listed = await db
      .insert(marketplaceListings)
      .values([
        {
          ...sold,
          sellerId: rows.fixture.id,
          buyerId: rows.player.id,
          droneId: rows.fixtureDrone.id,
        },
        {
          ...sold,
          sellerId: rows.player.id,
          buyerId: rows.fixture.id,
          droneId: rows.playerDrone.id,
        },
        { itemType: 'drone', price: 100, sellerId: rows.fixture.id, droneId: rows.fixtureDrone.id },
      ])
      .returning();
    expect((await getLiveStrip(nowMs, { db, near })).today.trades).toBe(before);
    const shown = [
      ...(await getListings({ status: 'sold' }, { page: 1, limit: 100 })),
      ...(await getListings({ sort: 'priceLow' }, { page: 1, limit: 100 })),
    ].map((/** @type {{ id: string }} */ l) => l.id);
    for (const l of listed) expect(shown).not.toContain(l.id);
  });

  it('leaves its open listings and its Volts out of the economy snapshot', async () => {
    const slot = 900_000_100;
    const gameId = 'game.test';
    /** @type {Record<string, string>} */
    const balances = { [`testrogueagent.${gameId}`]: '3000', [`other.${gameId}`]: '50' };
    const near = /** @type {any} */ ({
      gameId,
      view: async (/** @type {string} */ method, /** @type {any} */ args) =>
        method === 'ft_total_supply' ? '121924' : balances[args.account_id],
    });
    const openListings = async () => {
      const nowMs = Date.now();
      await db.delete(economySnapshots).where(eq(economySnapshots.slot, slot));
      expect(await writeEconomySnapshot(slot, { db, near }, nowMs)).toBe(true);
      const [snap] = await db
        .select()
        .from(economySnapshots)
        .where(eq(economySnapshots.slot, slot));
      return snap.openListings;
    };
    const before = await openListings();
    const [snap] = await db.select().from(economySnapshots).where(eq(economySnapshots.slot, slot));
    expect(snap.supply).toBe(121924 - 3000);
    await db.insert(marketplaceListings).values({
      itemType: 'drone',
      price: 100,
      sellerId: rows.fixture.id,
      droneId: rows.fixtureDrone.id,
    });
    expect(await openListings()).toBe(before);
    await db.delete(economySnapshots).where(eq(economySnapshots.slot, slot));
  });
});
