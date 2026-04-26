import { withApiHandler, ok } from '@/lib/api/response.js';
import { getUserMods } from '@/services/mod.service.js';

export const GET = withApiHandler(async ({ session }) => {
  const items = await getUserMods(session.user.id);
  return ok(items);
});
