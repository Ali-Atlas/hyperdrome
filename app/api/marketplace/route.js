import { withApiHandler, ok } from '@/lib/api/response.js';
import { paginationSchema } from '@/lib/validators';
import { getListings } from '@/services/marketplace.service.js';

export const GET = withApiHandler(
  async ({ request }) => {
    const url = new URL(request.url);
    const parsed = paginationSchema.safeParse(Object.fromEntries(url.searchParams));
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
  { requireAuth: false }
);

/** POST /api/marketplace: listing moved to the contract's `list` (SPEC.md 8, BUILD_PLAN T10). */
export function POST() {
  return Response.json({ error: 'Marketplace trading moved to NEAR in T10' }, { status: 501 });
}
