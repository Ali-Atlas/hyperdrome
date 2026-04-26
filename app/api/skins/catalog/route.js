import { withApiHandler, ok } from '@/lib/api/response.js';
import { getCatalogImageBacked } from '@/services/skin.service.js';

/**
 * Public read of the image-backed skin catalog. Used by the marketplace
 * packs screen to populate the "WHAT YOU COULD PULL" preview cards with
 * real skin designs (only those that have a `/skins/...webp` image,
 * never the legacy placeholder rows).
 */
export const GET = withApiHandler(
  async () => {
    const items = await getCatalogImageBacked();
    return ok(items);
  },
  { requireAuth: false },
);
