import { withApiHandler, ok } from '@/lib/api/response.js';
import { buyListing } from '@/services/marketplace.service.js';

export const POST = withApiHandler(async ({ session, params }) => {
  const { listing, balance } = await buyListing(
    session.user.id,
    params.listingId,
  );
  // Spread the listing into the top-level payload so existing UI consumers
  // that read `body.data.itemType` etc. keep working; surface `balance` as
  // an extra field for the buyer-balance refresh path.
  return ok({ ...listing, balance });
});
