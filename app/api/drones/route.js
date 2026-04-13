import { withApiHandler, ok } from '@/lib/api/response.js';
import { getAllDronesForUser } from '@/services/drone.service.js';

export const GET = withApiHandler(async ({ session }) => {
  const items = await getAllDronesForUser(session.user.id);
  return ok(items);
});
