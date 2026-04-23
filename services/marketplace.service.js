import { and, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { ApiError } from '@/lib/api/response.js';

const { marketplaceListings, drones, skins, users, droneOwnershipHistory } = schema;

/* -------------------------------------------------------------------------- */
/* Create                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * List a drone or skin for sale. Verifies ownership and (for drones) that
 * the item is inactive.
 * @param {string} userId
 * @param {'drone'|'skin'} itemType
 * @param {string} itemId
 * @param {number} price
 */
export async function createListing(userId, itemType, itemId, price) {
  if (itemType === 'drone') {
    const [drone] = await db
      .select()
      .from(drones)
      .where(eq(drones.id, itemId))
      .limit(1);
    if (!drone) throw new ApiError('Drone not found', 404);
    if (drone.userId !== userId) throw new ApiError('You do not own this drone', 403);
    if (drone.active) {
      throw new ApiError('Deactivate the drone before listing it', 400);
    }
  } else {
    const [skin] = await db
      .select()
      .from(skins)
      .where(eq(skins.id, itemId))
      .limit(1);
    if (!skin) throw new ApiError('Skin not found', 404);
    if (skin.userId !== userId) throw new ApiError('You do not own this skin', 403);
  }

  const [listing] = await db
    .insert(marketplaceListings)
    .values({
      sellerId: userId,
      itemType,
      droneId: itemType === 'drone' ? itemId : null,
      skinId: itemType === 'skin' ? itemId : null,
      price,
      status: 'active',
    })
    .returning();

  return listing;
}

/* -------------------------------------------------------------------------- */
/* Buy                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Buy an active listing. Uses a conditional UPDATE on the listing status to
 * guard against race conditions between concurrent buyers.
 * @param {string} buyerId
 * @param {string} listingId
 */
export async function buyListing(buyerId, listingId) {
  const [listing] = await db
    .select()
    .from(marketplaceListings)
    .where(eq(marketplaceListings.id, listingId))
    .limit(1);

  if (!listing) throw new ApiError('Listing not found', 404);
  if (listing.status !== 'active') {
    throw new ApiError('This listing is no longer available', 410);
  }
  if (listing.sellerId === buyerId) {
    throw new ApiError('You cannot buy your own listing', 400);
  }

  const [buyer] = await db
    .select()
    .from(users)
    .where(eq(users.id, buyerId))
    .limit(1);
  if (!buyer) throw new ApiError('Buyer not found', 404);
  if (buyer.points < listing.price) {
    throw new ApiError('Insufficient points', 400);
  }

  const platformFee = Math.floor(listing.price * 0.05);
  const sellerPayout = listing.price - platformFee;

  // Atomic claim: only the first UPDATE with status='active' succeeds
  const claimed = await db
    .update(marketplaceListings)
    .set({
      status: 'sold',
      buyerId,
      soldAt: new Date(),
      platformFee,
    })
    .where(
      and(
        eq(marketplaceListings.id, listingId),
        eq(marketplaceListings.status, 'active'),
      ),
    )
    .returning();

  if (claimed.length === 0) {
    throw new ApiError('This listing was just sold to someone else', 410);
  }

  // Deduct buyer points
  await db
    .update(users)
    .set({ points: sql`${users.points} - ${listing.price}` })
    .where(eq(users.id, buyerId));

  // Credit seller payout
  await db
    .update(users)
    .set({ points: sql`${users.points} + ${sellerPayout}` })
    .where(eq(users.id, listing.sellerId));

  // Transfer ownership
  if (listing.itemType === 'drone' && listing.droneId) {
    // Close the seller's ownership period
    await db
      .update(droneOwnershipHistory)
      .set({ endDate: new Date() })
      .where(
        and(
          eq(droneOwnershipHistory.droneId, listing.droneId),
          eq(droneOwnershipHistory.ownerUserId, listing.sellerId),
          sql`${droneOwnershipHistory.endDate} IS NULL`,
        ),
      );

    // Transfer drone + unequip any applied skin (skin stays with seller)
    await db
      .update(drones)
      .set({
        userId: buyerId,
        appliedSkinId: null,
        active: false,
      })
      .where(eq(drones.id, listing.droneId));

    // New ownership row for buyer
    await db.insert(droneOwnershipHistory).values({
      droneId: listing.droneId,
      ownerUserId: buyerId,
      transactionType: 'purchase',
      pricePaid: listing.price,
    });
  } else if (listing.itemType === 'skin' && listing.skinId) {
    await db
      .update(skins)
      .set({ userId: buyerId })
      .where(eq(skins.id, listing.skinId));
  }

  return claimed[0];
}

/* -------------------------------------------------------------------------- */
/* Cancel                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Cancel an active listing. Only the seller can cancel.
 * @param {string} userId
 * @param {string} listingId
 */
export async function cancelListing(userId, listingId) {
  const [listing] = await db
    .select()
    .from(marketplaceListings)
    .where(eq(marketplaceListings.id, listingId))
    .limit(1);

  if (!listing) throw new ApiError('Listing not found', 404);
  if (listing.sellerId !== userId) {
    throw new ApiError('Only the seller can cancel this listing', 403);
  }
  if (listing.status !== 'active') {
    throw new ApiError('Only active listings can be cancelled', 400);
  }

  const [updated] = await db
    .update(marketplaceListings)
    .set({ status: 'cancelled' })
    .where(eq(marketplaceListings.id, listingId))
    .returning();

  return updated;
}

/* -------------------------------------------------------------------------- */
/* Query                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Paginated active listings with filters. Joins drone/skin/seller.
 * @param {object} filters
 * @param {{ page: number, limit: number }} pagination
 */
export async function getListings(filters = {}, pagination = { page: 1, limit: 20 }) {
  const { page, limit } = pagination;
  const offset = (page - 1) * limit;

  const conditions = [eq(marketplaceListings.status, 'active')];
  if (filters.itemType) conditions.push(eq(marketplaceListings.itemType, filters.itemType));
  if (filters.minPrice != null) conditions.push(gte(marketplaceListings.price, filters.minPrice));
  if (filters.maxPrice != null) conditions.push(lte(marketplaceListings.price, filters.maxPrice));

  const rows = await db
    .select()
    .from(marketplaceListings)
    .where(and(...conditions))
    .orderBy(desc(marketplaceListings.createdAt))
    .limit(limit)
    .offset(offset);

  if (rows.length === 0) return [];

  const droneIds = rows.map((r) => r.droneId).filter(Boolean);
  const skinIds = rows.map((r) => r.skinId).filter(Boolean);
  const sellerIds = [...new Set(rows.map((r) => r.sellerId))];

  const [droneRows, skinRows, sellerRows] = await Promise.all([
    droneIds.length
      ? db
          .select({ drone: drones, appliedSkin: skins })
          .from(drones)
          .leftJoin(skins, eq(drones.appliedSkinId, skins.id))
          .where(inArray(drones.id, droneIds))
      : Promise.resolve([]),
    skinIds.length
      ? db.select().from(skins).where(inArray(skins.id, skinIds))
      : Promise.resolve([]),
    db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(inArray(users.id, sellerIds)),
  ]);

  const droneMap = Object.fromEntries(
    droneRows.map(({ drone, appliedSkin }) => [
      drone.id,
      { ...drone, appliedSkin },
    ]),
  );
  const skinMap = Object.fromEntries(skinRows.map((s) => [s.id, s]));
  const sellerMap = Object.fromEntries(sellerRows.map((s) => [s.id, s]));

  return rows.map((r) => ({
    ...r,
    drone: r.droneId ? droneMap[r.droneId] : null,
    skin: r.skinId ? skinMap[r.skinId] : null,
    seller: sellerMap[r.sellerId] ?? null,
  }));
}

/** Active listings owned by the user. */
export async function getUserListings(userId) {
  return db
    .select()
    .from(marketplaceListings)
    .where(
      and(
        eq(marketplaceListings.sellerId, userId),
        eq(marketplaceListings.status, 'active'),
      ),
    )
    .orderBy(desc(marketplaceListings.createdAt));
}

/** Recent transactions (bought + sold) for a user. */
export async function getTransactionHistory(userId, limit = 20) {
  return db
    .select()
    .from(marketplaceListings)
    .where(
      and(
        or(
          eq(marketplaceListings.sellerId, userId),
          eq(marketplaceListings.buyerId, userId),
        ),
        eq(marketplaceListings.status, 'sold'),
      ),
    )
    .orderBy(desc(marketplaceListings.soldAt))
    .limit(limit);
}
