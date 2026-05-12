import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { withApiHandler, ok, fail } from '@/lib/api/response.js';
import { buyPackOnchain, lookupBuyerWallet } from '@/lib/onchain/packs.js';
import { PACK_PRICES } from '@/services/pack.service.js';

const { users } = schema;

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
 * the deployer (signer) on-chain; the user is debited in app-side VOLT
 * (`users.points`) up-front so an authenticated caller cannot drain the
 * deployer by repeatedly hitting this route. On-chain failure refunds.
 */
export const POST = withApiHandler(async ({ session, request }) => {
  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return fail('Invalid request body', 400, parsed.error.issues);
  }

  const price = PACK_PRICES[parsed.data.packTier];
  if (!price) {
    return fail('Unknown pack tier', 400);
  }

  const buyerAddress = await lookupBuyerWallet(session.user.id);
  if (!buyerAddress) {
    return fail('Connect a wallet first', 400);
  }

  const [buyer] = await db
    .select({ points: users.points })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!buyer) return fail('Buyer not found', 404);
  if (buyer.points < price) {
    return fail(
      `Not enough volts. Need +${(price - buyer.points).toLocaleString()} more.`,
      400,
    );
  }

  // Debit first. If the chain leg fails below we refund in the catch.
  await db
    .update(users)
    .set({ points: sql`${users.points} - ${price}` })
    .where(eq(users.id, session.user.id));

  let result;
  try {
    result = await buyPackOnchain({
      userId: session.user.id,
      buyerAddress,
      packTier: parsed.data.packTier,
    });
  } catch (err) {
    await db
      .update(users)
      .set({ points: sql`${users.points} + ${price}` })
      .where(eq(users.id, session.user.id));
    throw err;
  }

  return ok({ ...result, price, balance: buyer.points - price });
});
