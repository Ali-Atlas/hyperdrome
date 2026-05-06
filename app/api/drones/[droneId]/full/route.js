import { z } from 'zod';
import { withApiHandler, ok, ApiError } from '@/lib/api/response.js';
import { getDroneById } from '@/services/drone.service.js';

/**
 * GET /api/drones/[droneId]/full
 *
 * Rich app-internal drone shape: drone + owner + applied skin + recent
 * races + bound mods + bound skins. Used by the in-app drone detail page.
 *
 * Lives at `/full` because the canonical `/api/drones/[droneId]` is now
 * the public ERC-721 metadata endpoint (the contract's tokenURI prefix
 * resolves to that path; it must be metadata-shaped, not the rich shape).
 *
 * Public read-only - matches the previous endpoint's semantics. No
 * authorization gate beyond rate limiting via withApiHandler.
 */

const uuidSchema = z.uuid();

export const GET = withApiHandler(
  async ({ params }) => {
    const parsed = uuidSchema.safeParse(params.droneId);
    if (!parsed.success) {
      throw new ApiError('Drone not found', 404);
    }
    const drone = await getDroneById(parsed.data);
    return ok(drone);
  },
  { requireAuth: false },
);
