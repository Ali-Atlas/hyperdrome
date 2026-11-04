import { ApiError } from '@/lib/api/response.js';
import { droneIdParamSchema } from '@/lib/validators/gameplay.js';
import { getDroneById } from '@/services/drone.service.js';

/**
 * GET /api/drones/[droneId] (SPEC.md 8): one drone from the cache, with its owner (id, username,
 * NEAR account), equipped and bound items and its last 10 races. Public, no balances. Token
 * metadata for wallets moved to GET /api/metadata/[token].
 * @param {Request} _request
 * @param {{ params: Promise<{ droneId: string }> }} context
 */
export async function GET(_request, context) {
  const { droneId } = await context.params;
  if (!droneIdParamSchema.safeParse(droneId).success) {
    return Response.json({ error: 'Drone not found.' }, { status: 404 });
  }
  try {
    return Response.json({ data: await getDroneById(droneId) });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return Response.json({ error: 'Drone not found.' }, { status: 404 });
    }
    throw err;
  }
}
