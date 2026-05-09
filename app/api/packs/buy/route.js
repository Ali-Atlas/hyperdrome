import { z } from 'zod';
import { withApiHandler, ok, fail } from '@/lib/api/response.js';
import { buyPackOnchain, lookupBuyerWallet } from '@/lib/onchain/packs.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

const bodySchema = z.object({
  packTier: z.enum(['starter', 'premium', 'legendary']),
});

/**
 * POST /api/packs/buy
 *
 * On-chain pack purchase via commit-reveal. Server signs both txs in
 * sequence per Captain's testnet model. The buyer's wallet must be
 * linked - the contract mints NFTs to it directly. VOLT is burned from
 * the buyer's wallet by the packs contract.
 *
 * This route is parallel to the legacy DB-only flow at
 * /api/marketplace/packs/open; the legacy flow remains the dashboard's
 * pack-open path until a follow-on migration consolidates them.
 */
export const POST = withApiHandler(async ({ session, request }) => {
  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return fail('Invalid request body', 400, parsed.error.issues);
  }

  const buyerAddress = await lookupBuyerWallet(session.user.id);
  if (!buyerAddress) {
    return fail('Connect a wallet first', 400);
  }

  const result = await buyPackOnchain({
    userId: session.user.id,
    buyerAddress,
    packTier: parsed.data.packTier,
  });

  return ok(result);
});
