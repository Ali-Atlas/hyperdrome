import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { withApiHandler, ApiError, fail } from '@/lib/api/response.js';
import { getDroneById } from '@/services/drone.service.js';

const { drones, skins } = schema;

// Long-cache the placeholder so Blockscout / explorer indexers don't
// retry-storm on every page render. 24h is comfortably longer than the
// time it takes us to mint and seed a new drone token; once the row
// exists the response will surface real metadata via the same
// CDN-cached path on the next purge.
const PLACEHOLDER_CACHE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable',
};

/**
 * GET /api/drones/[droneId]
 *
 * Public ERC-721 metadata endpoint. The HyperdromeDrone contract's
 * `baseURI` is `https://hyperdrome.vercel.app/api/drones/`, so the on-chain
 * `tokenURI(uint256)` resolves to `/api/drones/<integer-token-id>`. NFT
 * marketplaces and explorers fetch the JSON below to render token cards.
 * Public, no auth required.
 *
 * Path-segment dispatch: `[droneId]` may be either form.
 *   - all-digit string -> on-chain tokenId lookup (drones.token_id column).
 *     This is what the contract's tokenURI emits.
 *   - UUID -> direct app-internal access (kept for testing / debug paths).
 *
 * The rich app-internal drone shape (owner, recent races, bound items) is
 * served from `/api/drones/[droneId]/full`; this URL is metadata-only.
 */

const uuidSchema = z.uuid();

// Postgres int4 max. Anything above gets rejected here so we don't push a
// number too big for the column into the WHERE clause.
const PG_INT_MAX = 2_147_483_647;

const TIER_IMAGE_BY_LEVEL = [
  null, // index 0 unused
  '/drones/tier-1.webp', '/drones/tier-1.webp', '/drones/tier-1.webp', '/drones/tier-1.webp', '/drones/tier-1.webp',
  '/drones/tier-2.webp', '/drones/tier-2.webp', '/drones/tier-2.webp', '/drones/tier-2.webp', '/drones/tier-2.webp',
  '/drones/tier-3.webp', '/drones/tier-3.webp', '/drones/tier-3.webp', '/drones/tier-3.webp', '/drones/tier-3.webp',
  '/drones/tier-4.webp', '/drones/tier-4.webp', '/drones/tier-4.webp', '/drones/tier-4.webp', '/drones/tier-4.webp',
];

const SITE_ORIGIN = 'https://hyperdrome.vercel.app';

function tierForLevel(level) {
  if (level <= 5) return 1;
  if (level <= 10) return 2;
  if (level <= 15) return 3;
  return 4;
}

function tierImagePath(level) {
  const safe = Math.max(1, Math.min(20, Number(level) || 1));
  return TIER_IMAGE_BY_LEVEL[safe];
}

/**
 * Equipped skin overrides tier image, matching the in-app rendering order
 * so on-chain art tracks the player's current cosmetic. The skin path is
 * promoted to absolute for marketplaces that fetch the URL without a
 * referrer base.
 */
function resolveImageUrl(drone) {
  const raw = drone.appliedSkin?.imageUrl ?? tierImagePath(drone.level);
  if (!raw) return `${SITE_ORIGIN}/drones/default.png`;
  return raw.startsWith('http') ? raw : `${SITE_ORIGIN}${raw}`;
}

/**
 * Look up a drone by either its on-chain integer tokenId (the form the
 * contract's tokenURI emits) or its app-internal UUID. Returns the same
 * shape getDroneById does for the fields we care about (drone columns +
 * appliedSkin), or null when nothing matches.
 *
 * The numeric branch is a narrow read (no recent races / mods / bound
 * items joins) since the metadata response only needs drone columns +
 * the equipped skin's image. The UUID branch falls through to the
 * existing service to keep dev/debug paths bug-for-bug compatible with
 * the prior shape.
 */
async function lookupDrone(idOrToken) {
  if (/^\d+$/.test(idOrToken)) {
    const tokenId = Number(idOrToken);
    if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > PG_INT_MAX) {
      return null;
    }
    const [row] = await db
      .select({ drone: drones, skin: skins })
      .from(drones)
      .leftJoin(skins, eq(drones.appliedSkinId, skins.id))
      .where(eq(drones.tokenId, tokenId))
      .limit(1);
    if (!row) return null;
    return { ...row.drone, appliedSkin: row.skin };
  }
  if (!uuidSchema.safeParse(idOrToken).success) return null;
  try {
    return await getDroneById(idOrToken);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Build the ERC-721 metadata response. `name` uses the on-chain tokenId
 * (the canonical public identifier marketplaces will index) when minted,
 * falling back to the UUID for unminted-drone dev fetches. `external_url`
 * always uses the UUID since the in-app drone page is UUID-keyed.
 *
 * Exposed fields (all already publicly visible elsewhere in the app -
 * leaderboard, profile pages, drone detail page):
 *   level, tier, ELO, 9 stats, total races, wins.
 *
 * Deliberately NOT exposed: owner user id, owner username, wallet
 * address, recent-race detail, bound mods/skins, losses, points
 * invested, mint timestamps. Loss/income data could be inferred from
 * external_url, which is acceptable since the page is already public.
 */
function buildMetadata(drone) {
  const level = drone.level ?? 1;
  const displayId = drone.tokenId ?? drone.id;
  return {
    name: `Hyperdrome Drone #${displayId}`,
    description: 'A competitive racing drone from Hyperdrome.',
    image: resolveImageUrl(drone),
    external_url: `${SITE_ORIGIN}/drones/${drone.id}`,
    attributes: [
      { trait_type: 'Level', display_type: 'number', value: level },
      { trait_type: 'Tier', display_type: 'number', value: tierForLevel(level) },
      { trait_type: 'ELO', display_type: 'number', value: drone.eloRating ?? 1000 },
      { trait_type: 'Speed', display_type: 'number', value: drone.speed ?? 1 },
      { trait_type: 'Turning', display_type: 'number', value: drone.turning ?? 1 },
      { trait_type: 'Acceleration', display_type: 'number', value: drone.acceleration ?? 1 },
      { trait_type: 'Durability', display_type: 'number', value: drone.durability ?? 1 },
      { trait_type: 'Night Vision', display_type: 'number', value: drone.nightVision ?? 1 },
      { trait_type: 'Battery Capacity', display_type: 'number', value: drone.batteryCapacity ?? 1 },
      { trait_type: 'Rain Handling', display_type: 'number', value: drone.rainHandling ?? 1 },
      { trait_type: 'Wind Resistance', display_type: 'number', value: drone.windResistance ?? 1 },
      { trait_type: 'Consistency', display_type: 'number', value: drone.consistency ?? 1 },
      { trait_type: 'Total Races', display_type: 'number', value: drone.totalRaces ?? 0 },
      { trait_type: 'Wins', display_type: 'number', value: drone.wins ?? 0 },
    ],
  };
}

/**
 * Minimal valid ERC-721 metadata so a Blockscout indexer that probes
 * sequentially up the tokenId range gets a 200 it can cache instead of
 * a 404 it will retry. Only used when the requested id was numeric -
 * UUID-form lookups that miss are still 404 (app-internal access).
 */
function placeholderMetadata(tokenId) {
  return {
    name: `Hyperdrome Drone #${tokenId}`,
    description: 'Drone not found',
    image: '',
  };
}

export const GET = withApiHandler(
  async ({ params }) => {
    const drone = await lookupDrone(params.droneId);
    if (!drone) {
      // Numeric tokenId that misses = unminted slot the indexer is
      // probing. Return placeholder + cache so it doesn't retry.
      if (/^\d+$/.test(params.droneId)) {
        return Response.json(
          placeholderMetadata(params.droneId),
          { headers: PLACEHOLDER_CACHE_HEADERS },
        );
      }
      // UUID miss = real not-found from app-internal callers.
      return fail('Drone not found', 404);
    }
    return Response.json(buildMetadata(drone), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
  { requireAuth: false },
);
