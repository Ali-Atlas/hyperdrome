import { withApiHandler, ok } from '@/lib/api/response.js';
import { buyListing } from '@/services/marketplace.service.js';

/**
 * Optional body: `{ userTxHash: '0x...' }` when the user has already
 * signed marketplace.buyItem from their own wallet. Server verifies the
 * tx + ItemSold event match this listing and this session's wallet
 * before flipping the DB row. Empty body falls back to the legacy
 * server-signed mirror (the deployer pays + signs).
 *
 * The buyer's bound wallet comes from `session.user.walletAddress` (set
 * by the wallet auth provider) - never trusted from the request body, so
 * a malicious caller can't forward a stranger's tx hash and claim the
 * listing in our DB.
 */
export const POST = withApiHandler(async ({ session, params, request }) => {
  const body = await request.json().catch(() => ({}));
  const userTxHash =
    typeof body?.userTxHash === 'string' && body.userTxHash.startsWith('0x')
      ? body.userTxHash
      : null;

  const { listing, balance } = await buyListing(
    session.user.id,
    params.listingId,
    {
      userTxHash,
      buyerWalletAddress: session.user.walletAddress ?? null,
    },
  );
  // Spread the listing into the top-level payload so existing UI consumers
  // that read `body.data.itemType` etc. keep working; surface `balance` as
  // an extra field for the buyer-balance refresh path.
  return ok({ ...listing, balance });
});
