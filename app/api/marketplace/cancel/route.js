import { z } from 'zod';
import { withApiHandler, ok } from '@/lib/api/response.js';
import { cancelListingOnchain } from '@/lib/onchain/marketplace.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

const bodySchema = z.object({
  listingId: z.coerce.number().int().min(1),
});

/**
 * POST /api/marketplace/cancel
 *
 * Server-side on-chain cancel. Marketplace returns the escrowed NFT to
 * the original seller (the deployer in the testnet model).
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
  const result = await cancelListingOnchain(parsed.data);
  return ok(result);
});
