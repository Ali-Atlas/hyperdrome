import { and, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { ApiError } from '@/lib/api/response.js';

const {
  marketplaceListings,
  drones,
  skins,
  mods,
  droneMods,
  droneSkins,
  users,
  droneOwnershipHistory,
} = schema;

/* -------------------------------------------------------------------------- */
/* Create                                                                     */
/* -------------------------------------------------------------------------- */

/** Minimum price (in points) for any marketplace listing. Blocks 1-pt spam. */
const MIN_LISTING_PRICE = 10;

/**
 * List a drone, skin, or mod for sale. Verifies ownership.
 *
 * Active drones ARE listable - they keep racing while listed and are only
 * deactivated on sale completion (April 2026 rule change).
 *
 * Skins that are currently applied to a drone are bound and cannot be
 * listed independently; they transfer with the drone on its sale.
 *
 * Mods that are bound to a drone (any drone_mods row exists) cannot be
 * listed independently; they transfer with the drone on its sale.
 *
 * @param {string} userId
 * @param {'drone'|'skin'|'mod'} itemType
 * @param {string} itemId
 * @param {number} price
 */
export async function createListing(userId, itemType, itemId, price) {
  if (!Number.isInteger(price) || price < MIN_LISTING_PRICE) {
    throw new ApiError(
      `Minimum listing price is ${MIN_LISTING_PRICE} points`,
      400,
    );
  }
  if (itemType === 'drone') {
    const [drone] = await db
      .select()
      .from(drones)
      .where(eq(drones.id, itemId))
      .limit(1);
    if (!drone) throw new ApiError('Drone not found', 404);
    if (drone.userId !== userId) throw new ApiError('You do not own this drone', 403);
  } else if (itemType === 'skin') {
    const [skin] = await db
      .select()
      .from(skins)
      .where(eq(skins.id, itemId))
      .limit(1);
    if (!skin) throw new ApiError('Skin not found', 404);
    if (skin.userId !== userId) throw new ApiError('You do not own this skin', 403);
    const [boundRow] = await db
      .select({ id: droneSkins.id })
      .from(droneSkins)
      .where(eq(droneSkins.skinId, itemId))
      .limit(1);
    if (boundRow) {
      throw new ApiError(
        'This skin is bound to a drone and transfers with it - list the drone instead',
        400,
      );
    }
  } else {
    const [mod] = await db
      .select()
      .from(mods)
      .where(eq(mods.id, itemId))
      .limit(1);
    if (!mod) throw new ApiError('Mod not found', 404);
    if (mod.userId !== userId) throw new ApiError('You do not own this mod', 403);
    const [boundRow] = await db
      .select({ id: droneMods.id })
      .from(droneMods)
      .where(eq(droneMods.modId, itemId))
      .limit(1);
    if (boundRow) {
      throw new ApiError(
        'This mod is bound to a drone and transfers with it - list the drone instead',
        400,
      );
    }
  }

  const [listing] = await db
    .insert(marketplaceListings)
    .values({
      sellerId: userId,
      itemType,
      droneId: itemType === 'drone' ? itemId : null,
      skinId: itemType === 'skin' ? itemId : null,
      modId: itemType === 'mod' ? itemId : null,
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
    throw new ApiError('Insufficient volts', 400);
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

    // Transfer drone, deactivate on sale. The applied skin pointer +
    // bound collection both follow via the loops below.
    await db
      .update(drones)
      .set({
        userId: buyerId,
        active: false,
      })
      .where(eq(drones.id, listing.droneId));

    // Bound skins transfer with the drone. Re-home every skin in the
    // drone's collection (equipped + non-equipped) to the buyer.
    const boundSkinRows = await db
      .select({ skinId: droneSkins.skinId })
      .from(droneSkins)
      .where(eq(droneSkins.droneId, listing.droneId));
    const boundSkinIds = boundSkinRows.map((r) => r.skinId);
    if (boundSkinIds.length > 0) {
      await db
        .update(skins)
        .set({ userId: buyerId })
        .where(inArray(skins.id, boundSkinIds));
    }

    // Bound mods transfer with the drone. Re-home every mod in the drone's
    // collection (equipped + non-equipped) to the buyer.
    const boundModRows = await db
      .select({ modId: droneMods.modId })
      .from(droneMods)
      .where(eq(droneMods.droneId, listing.droneId));
    const boundModIds = boundModRows.map((r) => r.modId);
    if (boundModIds.length > 0) {
      await db
        .update(mods)
        .set({ userId: buyerId })
        .where(inArray(mods.id, boundModIds));
    }

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
  } else if (listing.itemType === 'mod' && listing.modId) {
    await db
      .update(mods)
      .set({ userId: buyerId })
      .where(eq(mods.id, listing.modId));
  }

  // Buyer's post-purchase volts. Returned alongside the listing so the
  // marketplace UI can refresh its displayed balance immediately without a
  // hard reload (matches the openPack / openCapsule contract).
  return { listing: claimed[0], balance: buyer.points - listing.price };
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

/**
 * Seller-only: change the price on an active listing without cancelling
 * + relisting. Same auth + state guards as cancelListing.
 * @param {string} userId
 * @param {string} listingId
 * @param {number} newPrice
 */
export async function updateListingPrice(userId, listingId, newPrice) {
  const [listing] = await db
    .select()
    .from(marketplaceListings)
    .where(eq(marketplaceListings.id, listingId))
    .limit(1);

  if (!listing) throw new ApiError('Listing not found', 404);
  if (listing.sellerId !== userId) {
    throw new ApiError('Only the seller can update this listing', 403);
  }
  if (listing.status !== 'active') {
    throw new ApiError('Only active listings can be updated', 400);
  }

  const [updated] = await db
    .update(marketplaceListings)
    .set({ price: newPrice })
    .where(eq(marketplaceListings.id, listingId))
    .returning();

  return updated;
}

/* -------------------------------------------------------------------------- */
/* Query                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Curated default order: image-backed items first, then by rarity rank
 * (legendary > epic > rare > common), then by price DESCENDING within
 * rarity (so a 180k legendary drone beats a 12k legendary skin), then
 * newest as a final tiebreaker.
 *
 * The 'rarity' sort drops the image-backed bucket so placeholder cards
 * still sort by their actual rarity — useful when the user wants to see
 * every legendary regardless of whether it has a render.
 *
 * Both modes need the joined item rows to detect rarity + image backing,
 * so we overfetch up to CURATED_FETCH_CAP and slice the page after the
 * JS sort.
 */
const CURATED_FETCH_CAP = 500;
const RARITY_RANK = { legendary: 3, epic: 2, rare: 1, common: 0 };
const POST_FETCH_SORTS = new Set(['curated', 'rarity']);

/** Decide whether a listing's display image is a real /skins/...webp render
 *  vs. a legacy placeholder URL. Mirrors the convention used in
 *  `app/marketplace/page.jsx` (placeholder skins don't point to /skins/...).
 */
function isImageBacked(row) {
  const url =
    row.itemType === 'skin'
      ? row.skin?.imageUrl
      : row.itemType === 'mod'
        ? row.mod?.imageUrl
        : row.drone?.appliedSkin?.imageUrl;
  return Boolean(url && url.startsWith('/skins/') && url.endsWith('.webp'));
}

function rarityForRow(row) {
  if (row.itemType === 'skin') return row.skin?.rarity ?? 'common';
  if (row.itemType === 'mod') return row.mod?.rarity ?? 'common';
  return row.drone?.appliedSkin?.rarity ?? 'common';
}

/**
 * Paginated active listings with filters. Joins drone/skin/seller.
 * @param {object} filters - itemType, minPrice, maxPrice, sort ('curated'|'priceHigh'|'priceLow', default 'curated')
 * @param {{ page: number, limit: number }} pagination
 */
export async function getListings(filters = {}, pagination = { page: 1, limit: 20 }) {
  const { page, limit } = pagination;
  const offset = (page - 1) * limit;
  const sort = filters.sort ?? 'curated';

  const conditions = [eq(marketplaceListings.status, 'active')];
  if (filters.itemType) conditions.push(eq(marketplaceListings.itemType, filters.itemType));
  if (filters.minPrice != null) conditions.push(gte(marketplaceListings.price, filters.minPrice));
  if (filters.maxPrice != null) conditions.push(lte(marketplaceListings.price, filters.maxPrice));

  // Post-fetch sorts (curated / rarity) need joined rarity + image data,
  // so we overfetch up to CURATED_FETCH_CAP and slice after the JS sort.
  // Pure SQL sorts page directly.
  const usePostFetchSort = POST_FETCH_SORTS.has(sort);
  const baseQuery = db
    .select()
    .from(marketplaceListings)
    .where(and(...conditions));

  const rows = usePostFetchSort
    ? await baseQuery
        .orderBy(desc(marketplaceListings.createdAt))
        .limit(CURATED_FETCH_CAP)
    : await baseQuery
        .orderBy(
          sort === 'priceLow'
            ? marketplaceListings.price
            : sort === 'priceHigh'
              ? desc(marketplaceListings.price)
              : desc(marketplaceListings.createdAt),
        )
        .limit(limit)
        .offset(offset);

  if (rows.length === 0) return [];

  const droneIds = rows.map((r) => r.droneId).filter(Boolean);
  const skinIds = rows.map((r) => r.skinId).filter(Boolean);
  const modIds = rows.map((r) => r.modId).filter(Boolean);
  const sellerIds = [...new Set(rows.map((r) => r.sellerId))];
  const buyerIds = [...new Set(rows.map((r) => r.buyerId).filter(Boolean))];
  const userIds = [...new Set([...sellerIds, ...buyerIds])];

  const [
    droneRows,
    skinRows,
    modRows,
    userRows,
    droneSkinCounts,
    droneModCounts,
  ] = await Promise.all([
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
    modIds.length
      ? db.select().from(mods).where(inArray(mods.id, modIds))
      : Promise.resolve([]),
    userIds.length
      ? db
          .select({ id: users.id, username: users.username })
          .from(users)
          .where(inArray(users.id, userIds))
      : Promise.resolve([]),
    droneIds.length
      ? db
          .select({
            droneId: droneSkins.droneId,
            count: sql`COUNT(*)::int`.as('count'),
          })
          .from(droneSkins)
          .where(inArray(droneSkins.droneId, droneIds))
          .groupBy(droneSkins.droneId)
      : Promise.resolve([]),
    droneIds.length
      ? db
          .select({
            droneId: droneMods.droneId,
            count: sql`COUNT(*)::int`.as('count'),
          })
          .from(droneMods)
          .where(inArray(droneMods.droneId, droneIds))
          .groupBy(droneMods.droneId)
      : Promise.resolve([]),
  ]);

  const skinCountMap = Object.fromEntries(
    droneSkinCounts.map((r) => [r.droneId, r.count]),
  );
  const modCountMap = Object.fromEntries(
    droneModCounts.map((r) => [r.droneId, r.count]),
  );

  const droneMap = Object.fromEntries(
    droneRows.map(({ drone, appliedSkin }) => [
      drone.id,
      {
        ...drone,
        appliedSkin,
        boundSkinCount: skinCountMap[drone.id] ?? 0,
        boundModCount: modCountMap[drone.id] ?? 0,
      },
    ]),
  );
  const skinMap = Object.fromEntries(skinRows.map((s) => [s.id, s]));
  const modMap = Object.fromEntries(modRows.map((m) => [m.id, m]));
  const userMap = Object.fromEntries(userRows.map((u) => [u.id, u]));

  const enriched = rows.map((r) => ({
    ...r,
    drone: r.droneId ? droneMap[r.droneId] : null,
    skin: r.skinId ? skinMap[r.skinId] : null,
    mod: r.modId ? modMap[r.modId] : null,
    seller: userMap[r.sellerId] ?? null,
    buyer: r.buyerId ? userMap[r.buyerId] ?? null : null,
  }));

  if (!usePostFetchSort) return enriched;

  // Curated bumps image-backed items above placeholders; the explicit
  // 'rarity' sort drops that step so placeholder rares still rank above
  // image-backed commons.
  const useImageBacked = sort === 'curated';
  enriched.sort((a, b) => {
    if (useImageBacked) {
      const aImg = isImageBacked(a) ? 1 : 0;
      const bImg = isImageBacked(b) ? 1 : 0;
      if (aImg !== bImg) return bImg - aImg;
    }
    const aR = RARITY_RANK[rarityForRow(a)] ?? 0;
    const bR = RARITY_RANK[rarityForRow(b)] ?? 0;
    if (aR !== bR) return bR - aR;
    if (b.price !== a.price) return b.price - a.price;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  return enriched.slice(offset, offset + limit);
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
