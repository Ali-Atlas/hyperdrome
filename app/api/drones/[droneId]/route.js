import { withApiHandler, ok } from '@/lib/api/response.js';
import { getDroneById } from '@/services/drone.service.js';

export const GET = withApiHandler(async ({ params }) => {
  const drone = await getDroneById(params.droneId);
  return ok(drone);
});
