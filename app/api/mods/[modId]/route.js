import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { withApiHandler, fail } from '@/lib/api/response.js';

const { mods, droneMods, drones } = schema;

/**
 * GET /api/mods/[modId]
 *
 * Public ERC-721 metadata endpoint for HyperdromeMod tokens. The contract's
 * `baseURI` is `https://hyperdrome.vercel.app/api/mods/`, so on-chain
 * `tokenURI(uint256)` resolves to `/api/mods/<integer-token-id>`. Mirrors
 * the drone / skin metadata routes.
 *
 * Path-segment dispatch:
 *   - all-digit string -> on-chain tokenId lookup (mods.token_id).
 *   - UUID -> app-internal lookup.
 *
 * Stat bonus / penalty / special ability surface as attributes so explorer
 * cards can render the mod's effect at a glance.
 */

const uuidSchema = z.uuid();
const PG_INT_MAX = 2_147_483_647;
const SITE_ORIGIN = 'https://hyperdrome.vercel.app';

function resolveImageUrl(mod) {
  const raw = mod.imageUrl;
  if (!raw) return `${SITE_ORIGIN}/mods/default.png`;
  return raw.startsWith('http') ? raw : `${SITE_ORIGIN}${raw}`;
}

async function lookupMod(idOrToken) {
  if (/^\d+$/.test(idOrToken)) {
    const tokenId = Number(idOrToken);
    if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > PG_INT_MAX) {
      return null;
    }
    const [row] = await db
      .select()
      .from(mods)
      .where(eq(mods.tokenId, tokenId))
      .limit(1);
    return row ?? null;
  }
  if (!uuidSchema.safeParse(idOrToken).success) return null;
  const [row] = await db
    .select()
    .from(mods)
    .where(eq(mods.id, idOrToken))
    .limit(1);
  return row ?? null;
}

async function lookupBoundDrone(modId) {
  const [row] = await db
    .select({ droneId: drones.id, droneTokenId: drones.tokenId })
    .from(droneMods)
    .leftJoin(drones, eq(droneMods.droneId, drones.id))
    .where(eq(droneMods.modId, modId))
    .limit(1);
  return row ?? null;
}

function buildMetadata(mod, bound) {
  const displayId = mod.tokenId ?? mod.id;
  const attributes = [
    { trait_type: 'Rarity', value: mod.rarity },
  ];
  // Bonus / penalty values are stored as decimal strings (e.g. "2.00").
  // Surfacing them as numeric where possible keeps explorer rendering
  // sensible; fall back to the raw string when the cast fails.
  if (mod.statBonusType && mod.statBonusValue != null) {
    const num = Number.parseFloat(mod.statBonusValue);
    attributes.push({
      trait_type: `Bonus: ${mod.statBonusType}`,
      value: Number.isFinite(num) ? num : mod.statBonusValue,
    });
  }
  if (mod.statPenaltyType && mod.statPenaltyValue != null) {
    const num = Number.parseFloat(mod.statPenaltyValue);
    attributes.push({
      trait_type: `Penalty: ${mod.statPenaltyType}`,
      value: Number.isFinite(num) ? num : mod.statPenaltyValue,
    });
  }
  if (mod.specialAbility) {
    attributes.push({ trait_type: 'Special Ability', value: mod.specialAbility });
  }
  if (bound?.droneTokenId != null) {
    attributes.push({
      trait_type: 'Bound Drone Token ID',
      display_type: 'number',
      value: bound.droneTokenId,
    });
  } else if (bound?.droneId) {
    attributes.push({ trait_type: 'Bound Drone ID', value: bound.droneId });
  }
  return {
    name: mod.name ?? `Hyperdrome Mod #${displayId}`,
    description:
      mod.description ?? 'An equippable mod for a Hyperdrome racing drone.',
    image: resolveImageUrl(mod),
    external_url: `${SITE_ORIGIN}/marketplace`,
    attributes,
  };
}

export const GET = withApiHandler(
  async ({ params }) => {
    const mod = await lookupMod(params.modId);
    if (!mod) return fail('Mod not found', 404);
    const bound = await lookupBoundDrone(mod.id);
    return Response.json(buildMetadata(mod, bound), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
  { requireAuth: false },
);
