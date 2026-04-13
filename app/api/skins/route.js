import { withApiHandler, ok } from '@/lib/api/response.js';
import { getUserSkins } from '@/services/skin.service.js';

export const GET = withApiHandler(async ({ session }) => {
  const items = await getUserSkins(session.user.id);
  return ok(items);
});
