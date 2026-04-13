import { withApiHandler, ok } from '@/lib/api/response.js';
import { cancelListing } from '@/services/marketplace.service.js';

export const POST = withApiHandler(async ({ session, params }) => {
  const listing = await cancelListing(session.user.id, params.listingId);
  return ok(listing);
});
