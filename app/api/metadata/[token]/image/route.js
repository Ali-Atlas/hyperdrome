import { tokenIdSchema } from '@/lib/validators/gameplay.js';
import { tokenImage } from '@/services/metadata.service.js';

/** A drone's image follows its equipped skin and level, so it is cached for a minute. */
const REDIRECT_CACHE = 'public, max-age=60, s-maxage=60';
/** A generated item card changes only when art is added for it. */
const CARD_CACHE = 'public, max-age=86400, s-maxage=86400';

/**
 * GET /api/metadata/[token]/image (SPEC.md 4.3, 8): the token's `media`. Redirects to the art
 * file (a drone's tier render with its equipped skin where one exists, else the tier base; a
 * skin's art) or answers a generated SVG card for mods and placeholder skins without art.
 * @param {Request} request
 * @param {{ params: Promise<{ token: string }> }} context
 */
export async function GET(request, context) {
  const { token } = await context.params;
  const id = safeDecode(token);
  if (!id || !tokenIdSchema.safeParse(id).success) {
    return Response.json({ error: 'Token not found.' }, { status: 404 });
  }
  const image = await tokenImage(id);
  if (!image) return Response.json({ error: 'Token not found.' }, { status: 404 });
  if ('redirect' in image) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: new URL(image.redirect, request.url).toString(),
        'Cache-Control': REDIRECT_CACHE,
      },
    });
  }
  return new Response(image.svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': CARD_CACHE,
    },
  });
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
