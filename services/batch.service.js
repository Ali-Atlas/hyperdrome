/**
 * The commit phase of a scheduler tick (SPEC.md 2.3, 3, 6): matchmaking from the active drones the
 * chain says are free, a seed sealed into the batch row before anything is sent, the races rows,
 * then `commit_batch(slot, seed_hash, matchups)` with the settlement key. The batch row exists
 * before the chain call, so a crash or an unknown outcome leaves a row the settle phase resolves
 * with `get_batch` (services/settle.service.js).
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { schema } from '@/lib/db';
import { botsNeeded, groupByBracket, matchDronesInBracket } from '@/lib/game-engine/matchmaking.js';
import { TIME_OF_DAY, WEATHER } from '@/lib/game-engine/race-simulator.js';
import { tracksForLevel } from '@/lib/game-engine/tracks.js';
import { ContractPanicError } from '@/lib/near';
import { applyEvents } from './chain-cache.service.js';
import { notFixtureOwned } from './fixture-filter.js';
import { conditionIndexes, toBytes, toHex } from './race-replay.js';
import { resolveDeps, slotStartMs } from './scheduler-deps.js';

const { drones, tracks, batches, races, users } = schema;

/** @typedef {import('./scheduler-deps.js').Deps} Deps */
/** @typedef {typeof drones.$inferSelect} DroneRow */
/** @typedef {{ a: DroneRow, b: DroneRow, track: typeof tracks.$inferSelect, trackIndex: number, weather: string, timeOfDay: string }} Pairing */

/** `get_drones` tokens per view call. */
const VIEW_CHUNK = 50;

/**
 * Commit the batch for `slot`: nothing when no drone can race. `matchups` is what was sent to
 * `commit_batch`, returned only when the commit stands on chain (the AI teams act on it).
 * @param {number} slot
 * @param {Deps} [deps]
 * @returns {Promise<{ slot: number, races: number, txHash?: string | null, failed?: string, matchups?: { a: string, b: string, track: number, weather: number, tod: number }[] }>}
 */
export async function commitBatch(slot, deps = {}) {
  const { db, near, secretKey } = resolveDeps(deps);
  const pairings = await makeMatchups(db, near);
  if (pairings.length === 0) return { slot, races: 0 };

  const seed = randomBytes(32);
  const seedHash = createHash('sha256').update(seed).digest('hex');
  const droneIds = pairings.flatMap((p) => [p.a.id, p.b.id]);
  await db.insert(batches).values({
    slot,
    seedHash,
    seedEnc: near.sealSecret(seed, secretKey, String(slot)),
    status: 'committed',
    attempts: 0,
  });
  await db.insert(races).values(
    pairings.map((p, index) => ({
      status: 'pending',
      scheduledAt: new Date(slotStartMs(slot + 1)),
      drone1Id: p.a.id,
      drone2Id: p.b.id,
      trackId: p.track.id,
      timeOfDay: p.timeOfDay,
      weather: p.weather,
      drone1EloBefore: p.a.eloRating,
      drone2EloBefore: p.b.eloRating,
      batchSlot: slot,
      raceIndex: index,
    }))
  );
  // The cache lock is set now: a commit whose outcome is unknown is resolved by the settle phase,
  // which clears it if the batch never reached the chain.
  await db.update(drones).set({ inBatch: slot }).where(inArray(drones.id, droneIds));

  const matchups = pairings.map((p) => ({
    a: String(p.a.tokenId),
    b: String(p.b.tokenId),
    track: p.trackIndex,
    ...conditionIndexes(p.weather, p.timeOfDay),
  }));
  /** @type {string | null} */
  let txHash = null;
  try {
    const res = await near.callAsSettlement('commit_batch', {
      batch_id: slot,
      seed_hash: toBytes(seedHash),
      matchups,
    });
    txHash = res.txHash;
  } catch (err) {
    if (err instanceof ContractPanicError && err.panic === 'exists') {
      // A retry whose first send executed: the batch is on chain if it carries our seed hash.
      const chain = /** @type {{ seed_hash: number[] } | null} */ (
        await near.view('get_batch', { id: slot })
      );
      if (!chain || toHex(chain.seed_hash) !== seedHash) {
        await failCommit(db, slot, 'batch exists on chain with another seed hash');
        return { slot, races: pairings.length, failed: 'exists' };
      }
    } else if (err instanceof ContractPanicError) {
      await failCommit(db, slot, err.panic);
      return { slot, races: pairings.length, failed: err.panic };
    } else {
      // Unknown outcome (timeout, RPC failure): the settle phase reads `get_batch` next tick.
      console.error({
        scope: 'scheduler',
        msg: 'commit outcome unknown',
        slot,
        error: String(err),
      });
      await db.update(batches).set({ committedAt: new Date() }).where(eq(batches.slot, slot));
      return { slot, races: pairings.length, txHash: null };
    }
  }
  await db
    .update(batches)
    .set({ commitTx: txHash, committedAt: new Date() })
    .where(eq(batches.slot, slot));
  return { slot, races: pairings.length, txHash, matchups };
}

/**
 * A commit the contract refused: the batch and its races are failed and the cache lock cleared.
 * @param {any} db
 * @param {number} slot
 * @param {string} reason
 */
async function failCommit(db, slot, reason) {
  console.error({ scope: 'scheduler', msg: 'commit_batch refused', slot, reason });
  await db.update(batches).set({ status: 'failed' }).where(eq(batches.slot, slot));
  await db.update(races).set({ status: 'failed' }).where(eq(races.batchSlot, slot));
  await db.update(drones).set({ inBatch: null }).where(eq(drones.inBatch, slot));
}

/**
 * Matchmaking input (SPEC.md 2.3, 6): active player drones with a token the chain says are not in
 * a batch, bots from the cache filling each non-empty bracket, pairs by bracket and ELO, and
 * random conditions per pair.
 * @param {any} db
 * @param {import('@/lib/near').NearAdapter} near
 * @returns {Promise<Pairing[]>}
 */
async function makeMatchups(db, near) {
  /** @type {DroneRow[]} */
  const players = await db
    .select()
    .from(drones)
    .where(
      and(
        eq(drones.active, true),
        eq(drones.isBot, false),
        isNotNull(drones.tokenId),
        notFixtureOwned(db, drones.userId)
      )
    );
  /** @type {DroneRow[]} */
  const bots = await db
    .select()
    .from(drones)
    .where(and(eq(drones.isBot, true), isNotNull(drones.tokenId)))
    .orderBy(drones.totalRaces, drones.id);
  const free = await freeTokens(near, db, players, bots);
  /** @param {DroneRow} d */
  const isFree = (d) => free.has(String(d.tokenId));
  const buckets = groupByBracket(players.filter(isFree));
  const botBuckets = groupByBracket(bots.filter(isFree));
  const trackRows = /** @type {(typeof tracks.$inferSelect)[]} */ (await db.select().from(tracks));
  const trackByName = new Map(trackRows.map((t) => [t.name, t]));

  /** @type {Pairing[]} */
  const pairings = [];
  for (const bracket of /** @type {(keyof typeof buckets)[]} */ (Object.keys(buckets))) {
    const field = buckets[bracket];
    if (field.length === 0) continue;
    const entrants = [...field, ...botBuckets[bracket].slice(0, botsNeeded(field.length))];
    for (const [a, b] of matchDronesInBracket(entrants)) {
      const candidates = tracksForLevel(a.level).filter((t) => trackByName.has(t.name));
      if (candidates.length === 0) throw new Error(`no tracks seeded for level ${a.level}`);
      const picked = candidates[randomInt(candidates.length)];
      pairings.push({
        a,
        b,
        track: /** @type {typeof tracks.$inferSelect} */ (trackByName.get(picked.name)),
        trackIndex: picked.id,
        weather: WEATHER[randomInt(WEATHER.length)],
        timeOfDay: TIME_OF_DAY[randomInt(TIME_OF_DAY.length)],
      });
    }
  }
  return pairings;
}

/**
 * The tokens free to race: on-chain `in_batch` is null and, for player drones, the chain still has
 * them with their cached player (a listed drone is in escrow and keeps racing). A drone that left
 * for a linked wallet is not committed and its cache row is synced (SPEC.md 6).
 * @param {import('@/lib/near').NearAdapter} near
 * @param {any} db
 * @param {DroneRow[]} players
 * @param {DroneRow[]} bots
 * @returns {Promise<Set<string>>}
 */
async function freeTokens(near, db, players, bots) {
  const ownerIds = [...new Set(players.flatMap((d) => (d.userId ? [d.userId] : [])))];
  /** @type {{ id: string, nearAccountId: string | null }[]} */
  const owners =
    ownerIds.length > 0
      ? await db
          .select({ id: users.id, nearAccountId: users.nearAccountId })
          .from(users)
          .where(inArray(users.id, ownerIds))
      : [];
  const accountOf = new Map(owners.map((u) => [u.id, u.nearAccountId]));
  const expected = new Map(
    players.map((d) => [String(d.tokenId), accountOf.get(String(d.userId)) ?? null])
  );
  const tokens = [...players, ...bots].map((d) => String(d.tokenId));
  const free = new Set();
  /** @type {{ token: string, owner: string, bound: string[] }[]} */
  const moved = [];
  for (let i = 0; i < tokens.length; i += VIEW_CHUNK) {
    const chunk = tokens.slice(i, i + VIEW_CHUNK);
    const views =
      /** @type {({ owner: string, listed: boolean, hot: { in_batch: number | null }, cold: { bound_skins: string[], bound_mods: string[] } } | null)[]} */ (
        await near.view('get_drones', { tokens: chunk })
      );
    chunk.forEach((token, j) => {
      const view = views[j];
      if (!view) return;
      const account = expected.get(token);
      if (account && view.owner !== account && !(view.owner === near.gameId && view.listed)) {
        moved.push({
          token,
          owner: view.owner,
          bound: [...view.cold.bound_skins, ...view.cold.bound_mods],
        });
        return;
      }
      if (view.hot.in_batch === null) free.add(token);
    });
  }
  if (moved.length > 0) {
    await applyEvents(
      moved.map((m) => ({
        standard: 'nep171',
        version: '1.0.0',
        event: 'nft_transfer',
        data: [{ new_owner_id: m.owner, token_ids: [m.token, ...m.bound] }],
        receiptId: 'commit-owner-sync',
      })),
      { db, near }
    );
  }
  return free;
}
