import { withApiHandler, ok, ApiError } from '@/lib/api/response.js';
import { createListingSchema, paginationSchema } from '@/lib/validators';
import {
  createListing,
  getListings,
} from '@/services/marketplace.service.js';

export const GET = withApiHandler(
  async ({ request }) => {
    const url = new URL(request.url);
    const parsed = paginationSchema.safeParse(
      Object.fromEntries(url.searchParams),
    );
    const pagination = parsed.success ? parsed.data : { page: 1, limit: 20 };
    const rawStatus = url.searchParams.get('status') || undefined;
    const filters = {
      itemType: url.searchParams.get('item_type') || undefined,
      status: rawStatus === 'sold' ? 'sold' : undefined,
      minPrice: url.searchParams.get('min_price')
        ? Number(url.searchParams.get('min_price'))
        : undefined,
      maxPrice: url.searchParams.get('max_price')
        ? Number(url.searchParams.get('max_price'))
        : undefined,
    };
    const items = await getListings(filters, pagination);
    return ok({ items, page: pagination.page, limit: pagination.limit });
  },
  { requireAuth: false },
);

export const POST = withApiHandler(async ({ session, request }) => {
  const body = await request.json().catch(() => ({}));
  const parsed = createListingSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError('Invalid request body', 400, parsed.error.issues);
  }
  const { item_type, drone_id, skin_id, price } = parsed.data;
  const itemId = item_type === 'drone' ? drone_id : skin_id;
  const listing = await createListing(session.user.id, item_type, itemId, price);
  return ok(listing, 201);
});
