import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { withApiHandler, fail } from '@/lib/api/response.js';

const { skins, droneSkins, drones } = schema;

/**
 * GET /api/skins/[skinId]
 *
 * Public ERC-721 metadata endpoint for HyperdromeSkin tokens. The contract's
 * `baseURI` is `https://hyperdrome.vercel.app/api/skins/`, so on-chain
 * `tokenURI(uint256)` resolves to `/api/skins/<integer-token-id>`.
 *
 * Path-segment dispatch matches the drone metadata route:
 *   - all-digit string -> on-chain tokenId lookup (skins.token_id).
 *   - UUID -> direct app-internal access (kept for testing).
 *
 * `bound_drone_token_id` (or `bound_drone_id` when the bound drone is
 * unminted) is exposed as an attribute so marketplace UIs can show that a
 * skin is locked to a specific drone NFT. Equipped state is incidental;
 * any binding row is enough to mark the skin as bound.
 */

const uuidSchema = z.uuid();
const PG_INT_MAX = 2_147_483_647;
const SITE_ORIGIN = 'https://hyperdrome.vercel.app';

function resolveImageUrl(skin) {
  const raw = skin.imageUrl;
  if (!raw) return `${SITE_ORIGIN}/skins/default.png`;
  return raw.startsWith('http') ? raw : `${SITE_ORIGIN}${raw}`;
}

async function lookupSkin(idOrToken) {
  if (/^\d+$/.test(idOrToken)) {
    const tokenId = Number(idOrToken);
    if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > PG_INT_MAX) {
      return null;
    }
    const [row] = await db
      .select()
      .from(skins)
      .where(eq(skins.tokenId, tokenId))
      .limit(1);
    return row ?? null;
  }
  if (!uuidSchema.safeParse(idOrToken).success) return null;
  const [row] = await db
    .select()
    .from(skins)
    .where(eq(skins.id, idOrToken))
    .limit(1);
  return row ?? null;
}

/**
 * Find any drone this skin is bound to. droneSkins enforces a single
 * binding per (drone, skin) pair but a skin instance only ever attaches
 * to one drone in practice. Pull the drone row so we can surface its
 * tokenId when minted.
 */
async function lookupBoundDrone(skinId) {
  const [row] = await db
    .select({ droneId: drones.id, droneTokenId: drones.tokenId })
    .from(droneSkins)
    .leftJoin(drones, eq(droneSkins.droneId, drones.id))
    .where(eq(droneSkins.skinId, skinId))
    .limit(1);
  return row ?? null;
}

function buildMetadata(skin, bound) {
  const displayId = skin.tokenId ?? skin.id;
  const attributes = [
    { trait_type: 'Rarity', value: skin.rarity },
  ];
  if (bound?.droneTokenId != null) {
    attributes.push({
      trait_type: 'Bound Drone Token ID',
      display_type: 'number',
      value: bound.droneTokenId,
    });
  } else if (bound?.droneId) {
    // Bound to a drone that hasn't been minted yet - surface the app id
    // so marketplace UIs can still show the binding.
    attributes.push({ trait_type: 'Bound Drone ID', value: bound.droneId });
  }
  return {
    name: skin.name ?? `Hyperdrome Skin #${displayId}`,
    description:
      skin.description ?? 'A cosmetic skin for a Hyperdrome racing drone.',
    image: resolveImageUrl(skin),
    external_url: `${SITE_ORIGIN}/marketplace`,
    attributes,
  };
}

export const GET = withApiHandler(
  async ({ params }) => {
    const skin = await lookupSkin(params.skinId);
    if (!skin) return fail('Skin not found', 404);
    const bound = await lookupBoundDrone(skin.id);
    return Response.json(buildMetadata(skin, bound), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
  { requireAuth: false },
);
