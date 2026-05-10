/**
 * Atomic per-contract tokenId allocator. Replaces the prior `ownerOf`
 * probe pattern that walked hundreds of on-chain slots on Carrot RPC
 * (observed ~95s during a fresh wallet signup with three NFT mints
 * back-to-back).
 *
 * Cost: one DB round-trip per claim (an `UPDATE ... RETURNING` against
 * `token_counters`). Cold start adds one extra round-trip to seed the
 * counter from the corresponding NFT table's `MAX(tokenId) + 1`.
 *
 * Concurrency: PostgreSQL row-level UPDATE is atomic. Two concurrent
 * claimants serialize on the row lock and each gets a distinct id.
 *
 * Collision recovery: if a mint reverts on-chain (e.g. somebody minted
 * the same id via a script that bypassed this counter, or the chain
 * already had supply ahead of the cold-start seed), the caller passes
 * `mintAtRetry: true` on a second call to bump past the failed id and
 * try again. Capped at one retry by convention - a second collision
 * indicates the counter is badly out of sync and should be reset
 * manually.
 */

import { eq, sql } from 'drizzle-orm';
import { db as defaultDb } from '../db/index.js';
import * as schema from '../db/schema.js';

const { tokenCounters, drones, skins, mods } = schema;

/**
 * Resolve the NFT table that backs a given contract key. Used only for
 * cold-start seeding - the runtime counter lives in `token_counters`.
 */
function backingTable(contractKey) {
  switch (contractKey) {
    case 'drone':
      return drones;
    case 'skin':
      return skins;
    case 'mod':
      return mods;
    default:
      throw new Error(`Unknown tokenCounters contractKey: ${contractKey}`);
  }
}

/**
 * Claim and consume the next tokenId for a contract. Returns the id the
 * caller should mint at; the counter row is incremented before return so
 * a follow-up claim never collides with this one.
 *
 * Cold start: when no counter row exists yet, seeds from the backing
 * table's `MAX(tokenId) + 1`. The atomic INSERT ... ON CONFLICT DO UPDATE
 * is the round-trip that handles a race between two cold-start callers -
 * the second one increments the row the first one just inserted.
 *
 * @param {'drone'|'skin'|'mod'} contractKey
 * @param {object} [dbInstance] - drizzle client; defaults to the app's
 *   pre-configured Next.js db. CLI scripts pass their own (e.g. one
 *   built against PROD_DATABASE_URL when running with --prod).
 * @returns {Promise<number>}
 */
export async function claimNextTokenId(contractKey, dbInstance = defaultDb) {
  // Fast path: counter row exists. Atomic increment + return the id we
  // just claimed (which is the value BEFORE the bump).
  const [bumped] = await dbInstance
    .update(tokenCounters)
    .set({
      nextTokenId: sql`${tokenCounters.nextTokenId} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(tokenCounters.contractKey, contractKey))
    .returning({ nextAfter: tokenCounters.nextTokenId });

  if (bumped) {
    return bumped.nextAfter - 1;
  }

  // Cold start: seed from the backing NFT table's MAX(tokenId)+1.
  const table = backingTable(contractKey);
  const [agg] = await dbInstance
    .select({ maxId: sql`COALESCE(MAX(${table.tokenId}), 0)` })
    .from(table);
  const seedNext = Number(agg?.maxId ?? 0) + 1;

  // Insert the seed row. ON CONFLICT DO UPDATE handles the race where a
  // sibling cold-start claimant just inserted: in that branch we bump
  // their freshly-inserted nextTokenId (so we still get a distinct id).
  const [row] = await dbInstance
    .insert(tokenCounters)
    .values({
      contractKey,
      nextTokenId: seedNext + 1, // we're claiming `seedNext`, so next is +1
    })
    .onConflictDoUpdate({
      target: tokenCounters.contractKey,
      set: {
        nextTokenId: sql`${tokenCounters.nextTokenId} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ nextAfter: tokenCounters.nextTokenId });

  // The id we just claimed is one less than the now-stored next.
  return row.nextAfter - 1;
}

/**
 * Forcibly advance the counter past `failedTokenId` and claim the next
 * one. Use when a mint reverted with a collision-style error (the
 * chain's supply was ahead of the counter, or somebody minted that id
 * out of band).
 *
 * Implementation: bump the counter to `max(current, failedTokenId + 2)`
 * and return `failedTokenId + 1` as the new claim. The +2 leaves the
 * counter pointing at the slot AFTER the one we just claimed.
 *
 * @param {'drone'|'skin'|'mod'} contractKey
 * @param {number} failedTokenId  - the id that just reverted
 * @returns {Promise<number>}     - the new id to retry the mint at
 */
export async function bumpAndClaim(contractKey, failedTokenId, dbInstance = defaultDb) {
  const target = failedTokenId + 1; // the id we want to claim
  const newNext = failedTokenId + 2; // counter sits one past the claim

  const [bumped] = await dbInstance
    .update(tokenCounters)
    .set({
      // GREATEST guards against another claimant having advanced the
      // counter further while we were retrying - never roll backwards.
      nextTokenId: sql`GREATEST(${tokenCounters.nextTokenId}, ${newNext})`,
      updatedAt: new Date(),
    })
    .where(eq(tokenCounters.contractKey, contractKey))
    .returning({ nextAfter: tokenCounters.nextTokenId });

  if (!bumped) {
    // Shouldn't happen: claimNextTokenId would have inserted the row on
    // the first call. If it does, fall back to a fresh claim - any id
    // is fine for the retry as long as it's distinct from the failed one.
    return claimNextTokenId(contractKey, dbInstance);
  }
  // If another claimant raced ahead (newNext < bumped.nextAfter), we
  // can't safely use `target` - take their new top instead.
  return Math.max(target, bumped.nextAfter - 1);
}
