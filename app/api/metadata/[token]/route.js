import { tokenIdSchema } from '@/lib/validators/gameplay.js';
import { tokenMetadata } from '@/services/metadata.service.js';

/** Wallets and explorers poll metadata; one minute keeps it current after an equip. */
const CACHE = 'public, max-age=60, s-maxage=60';

/**
 * GET /api/metadata/[token] (SPEC.md 4.3, 8): NEP-177 metadata for a drone, skin or mod, the URL
 * the contract's `nft_metadata.base_uri` points at. Read-only and public.
 * @param {Request} request
 * @param {{ params: Promise<{ token: string }> }} context
 */
export async function GET(request, context) {
  const { token } = await context.params;
  const id = safeDecode(token);
  if (!id || !tokenIdSchema.safeParse(id).success) {
    return Response.json({ error: 'Token not found.' }, { status: 404 });
  }
  const metadata = await tokenMetadata(id, { origin: new URL(request.url).origin });
  if (!metadata) return Response.json({ error: 'Token not found.' }, { status: 404 });
  return Response.json(metadata, { headers: { 'Cache-Control': CACHE } });
}

/**
 * The decoded path segment, or null when its percent-encoding is malformed.
 * @param {string} segment
 */
function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}
