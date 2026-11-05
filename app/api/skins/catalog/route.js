import { withApiHandler, ok } from '@/lib/api/response.js';
import { getSkinCatalog } from '@/services/catalog.service.js';

/**
 * GET /api/skins/catalog (SPEC.md 8): the catalog skins from the catalog cache, for the "what you
 * could pull" preview cards of the marketplace packs screen. Public.
 */
export const GET = withApiHandler(
  async () => {
    const items = await getSkinCatalog();
    return ok(items);
  },
  { requireAuth: false }
);
