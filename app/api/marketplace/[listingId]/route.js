import { z } from 'zod';
import { withApiHandler, ok, ApiError } from '@/lib/api/response.js';
import { updateListingPrice } from '@/services/marketplace.service.js';

const updatePriceSchema = z.object({
  price: z.number().int().min(10),
});

export const PUT = withApiHandler(async ({ session, params, request }) => {
  const body = await request.json().catch(() => ({}));
  const parsed = updatePriceSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError('Invalid request body', 400, parsed.error.issues);
  }
  const listing = await updateListingPrice(
    session.user.id,
    params.listingId,
    parsed.data.price,
  );
  return ok(listing);
});
