import { withApiHandler, ok, ApiError } from '@/lib/api/response.js';
import { openPack } from '@/services/pack.service.js';

const VALID_TYPES = new Set(['starter', 'premium', 'legendary']);

export const POST = withApiHandler(async ({ session, request }) => {
  const body = await request.json().catch(() => ({}));
  const packType = body?.packType ?? body?.pack_type;
  if (!VALID_TYPES.has(packType)) {
    throw new ApiError('Invalid pack type', 400);
  }
  const awarded = await openPack(session.user.id, packType);
  return ok({ packType, awarded });
});
