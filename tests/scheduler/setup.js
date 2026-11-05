/**
 * Setup shared by the scheduler tests: the track rows the commit phase picks from, and the
 * harness (a mock chain per test, racers, row readers, a wrapped settlement sender).
 */
import { randomInt } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { schema } from '../../lib/db/index.js';
import { TRACKS } from '../../lib/game-engine/tracks.js';
import { slotStartMs } from '../../services/scheduler-deps.js';
import { runTick } from '../../services/scheduler.service.js';
import { TEST_SECRET_KEY, createMockNear, newDrone, newPlayer } from '../gameplay/setup.js';

const { batches, drones, races, tracks } = schema;

/**
 * Insert the SPEC.md 2.9 tracks that the database does not have yet, matched by name.
 * @param {any} db
 */
export async function seedTracks(db) {
  /** @type {{ name: string }[]} */
  const rows = await db.select({ name: tracks.name }).from(tracks);
  const existing = new Set(rows.map((t) => t.name));
  const missing = TRACKS.filter((t) => !existing.has(t.name));
  if (missing.length === 0) return;
  await db.insert(tracks).values(
    missing.map((t) => ({
      name: t.name,
      straights: t.straights,
      turns: t.turns,
      difficulty: t.difficulty,
      levelMin: t.minLevel,
      levelMax: t.maxLevel,
      length: t.length,
      imageUrl: `/tracks/${t.name.toLowerCase().replace(/ /g, '_')}.webp`,
    }))
  );
}

/**
 * The helpers every scheduler test uses, bound to the test database.
 * @param {any} db
 */
export function schedulerHarness(db) {
  /** A fresh mock chain, a slot nobody else ticks, and the deps every tick takes. */
  async function world() {
    await seedTracks(db);
    const near = createMockNear();
    const slot = 60_000_000 + randomInt(1_000_000_000);
    const deps = { db, near, secretKey: TEST_SECRET_KEY };
    /** @param {number} offset slots after `slot` */
    const tick = (offset = 0, extra = {}) =>
      runTick({ now: slotStartMs(slot + offset) + 1_000, ...extra }, deps);
    return { near, slot, deps, tick };
  }

  /**
   * An active player drone that exists on the mock chain.
   * @param {ReturnType<typeof createMockNear>} near
   * @param {{ stats?: number[], elo?: number }} [opts]
   */
  async function racer(near, opts = {}) {
    const { user, accountId } = await newPlayer(db, near);
    const drone = await newDrone(db, user.id);
    const stats = opts.stats ?? [5, 5, 5, 5, 5, 5, 5, 5, 5];
    await db
      .update(drones)
      .set({ active: true, eloRating: opts.elo ?? 1000 })
      .where(eq(drones.id, drone.id));
    near.mock.chain.addDrone(String(drone.tokenId), {
      owner: accountId,
      stats,
      elo: opts.elo ?? 1000,
    });
    return { user, accountId, drone, token: String(drone.tokenId) };
  }

  /** @param {number} slot */
  const batchRow = async (slot) =>
    (await db.select().from(batches).where(eq(batches.slot, slot)))[0];
  /** @param {number} slot @returns {Promise<any[]>} */
  const raceRows = (slot) =>
    db.select().from(races).where(eq(races.batchSlot, slot)).orderBy(races.raceIndex);
  /** @param {string} id */
  const droneRow = async (id) => (await db.select().from(drones).where(eq(drones.id, id)))[0];
  /** @param {ReturnType<typeof createMockNear>} near @param {string} method */
  const settlementCalls = (near, method) =>
    near.mock.calls.filter((c) => c.kind === 'settlement' && c.method === method);

  /**
   * The mock adapter with `callAsSettlement` wrapped.
   * @param {ReturnType<typeof createMockNear>} near
   * @param {(method: string, args: any, forward: () => Promise<any>) => Promise<any>} wrap
   */
  const wrapped = (near, wrap) => ({
    ...near,
    /** @type {typeof near.callAsSettlement} */
    callAsSettlement: (method, args = {}, options) =>
      wrap(method, args, () => near.callAsSettlement(method, args, options)),
  });

  return { world, racer, batchRow, raceRows, droneRow, settlementCalls, wrapped };
}
