import { and, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';

const { marketplaceListings, drones, skins, mods, droneMods, droneSkins, users } = schema;

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
 * Paginated marketplace listings with filters. Joins drone/skin/mod
 * + seller + (for sold rows) buyer.
 *
 * @param {object} filters - itemType, status ('active'|'sold', default 'active'),
 *                          minPrice, maxPrice, sort ('curated'|'priceHigh'|'priceLow', default 'curated')
 * @param {{ page: number, limit: number }} pagination
 */
export async function getListings(filters = {}, pagination = { page: 1, limit: 20 }) {
  const { page, limit } = pagination;
  const offset = (page - 1) * limit;
  const sort = filters.sort ?? 'curated';
  const status = filters.status === 'sold' ? 'sold' : 'active';

  const conditions = [eq(marketplaceListings.status, status)];
  if (filters.itemType) conditions.push(eq(marketplaceListings.itemType, filters.itemType));
  if (filters.minPrice != null) conditions.push(gte(marketplaceListings.price, filters.minPrice));
  if (filters.maxPrice != null) conditions.push(lte(marketplaceListings.price, filters.maxPrice));

  // Sold listings always order by `soldAt` desc (most recent sale first)
  // - the curated/rarity post-fetch sort is for browsing live inventory,
  // not the sales-history feed. Active listings keep the original sort
  // behavior (curated / priceHigh / priceLow / rarity / createdAt).
  const usePostFetchSort = status === 'active' && POST_FETCH_SORTS.has(sort);
  const baseQuery = db
    .select()
    .from(marketplaceListings)
    .where(and(...conditions));

  const rows =
    status === 'sold'
      ? await baseQuery.orderBy(desc(marketplaceListings.soldAt)).limit(limit).offset(offset)
      : usePostFetchSort
        ? await baseQuery.orderBy(desc(marketplaceListings.createdAt)).limit(CURATED_FETCH_CAP)
        : await baseQuery
            .orderBy(
              sort === 'priceLow'
                ? marketplaceListings.price
                : sort === 'priceHigh'
                  ? desc(marketplaceListings.price)
                  : desc(marketplaceListings.createdAt)
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

  const [droneRows, skinRows, modRows, userRows, droneSkinCounts, droneModCounts] =
    await Promise.all([
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
      modIds.length ? db.select().from(mods).where(inArray(mods.id, modIds)) : Promise.resolve([]),
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

  const skinCountMap = Object.fromEntries(droneSkinCounts.map((r) => [r.droneId, r.count]));
  const modCountMap = Object.fromEntries(droneModCounts.map((r) => [r.droneId, r.count]));

  const droneMap = Object.fromEntries(
    droneRows.map(({ drone, appliedSkin }) => [
      drone.id,
      {
        ...drone,
        appliedSkin,
        boundSkinCount: skinCountMap[drone.id] ?? 0,
        boundModCount: modCountMap[drone.id] ?? 0,
      },
    ])
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
    buyer: r.buyerId ? (userMap[r.buyerId] ?? null) : null,
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
    .where(and(eq(marketplaceListings.sellerId, userId), eq(marketplaceListings.status, 'active')))
    .orderBy(desc(marketplaceListings.createdAt));
}

/** Recent transactions (bought + sold) for a user. */
export async function getTransactionHistory(userId, limit = 20) {
  return db
    .select()
    .from(marketplaceListings)
    .where(
      and(
        or(eq(marketplaceListings.sellerId, userId), eq(marketplaceListings.buyerId, userId)),
        eq(marketplaceListings.status, 'sold')
      )
    )
    .orderBy(desc(marketplaceListings.soldAt))
    .limit(limit);
}
