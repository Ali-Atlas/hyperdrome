import { z } from 'zod';
import { withApiHandler, ok } from '@/lib/api/response.js';
import { buyItemOnchain } from '@/lib/onchain/marketplace.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

const bodySchema = z.object({
  listingId: z.coerce.number().int().min(1),
  priceInVolts: z.coerce.number().int().min(1),
});

/**
 * POST /api/marketplace/buy
 *
 * Server-side on-chain buy: deployer approves marketplace for VOLT
 * spending, then calls buyItem. Marketplace's nonReentrant guard handles
 * any malicious receiver hooks on the NFT side.
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
  const result = await buyItemOnchain(parsed.data);
  return ok(result);
});
