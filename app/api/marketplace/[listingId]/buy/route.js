import { withApiHandler, ok } from '@/lib/api/response.js';
import { buyListing } from '@/services/marketplace.service.js';

export const POST = withApiHandler(async ({ session, params }) => {
  const listing = await buyListing(session.user.id, params.listingId);
  return ok(listing);
});
