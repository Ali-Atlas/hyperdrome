import { z } from 'zod';
import { withApiHandler, ok } from '@/lib/api/response.js';
import { listItemOnchain } from '@/lib/onchain/marketplace.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

const bodySchema = z.object({
  itemType: z.enum(['drone', 'skin', 'mod']),
  tokenId: z.coerce.number().int().min(1),
  priceInVolts: z.coerce.number().int().min(1),
});

/**
 * POST /api/marketplace/list
 *
 * Server-side on-chain listing: deployer approves the marketplace for the
 * specified NFT, then calls listItem. Returns the on-chain listingId and
 * tx hash. Auth-required so the route can't be exercised anonymously even
 * though the deployer signs.
 */
export const POST = withApiHandler(async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid request body', details: parsed.error.issues },
      { status: 400 },
    );
  }
  const result = await listItemOnchain(parsed.data);
  return ok(result);
});
