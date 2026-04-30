import { withApiHandler, ok, ApiError } from '@/lib/api/response.js';
import { openCapsule } from '@/services/pack.service.js';

const VALID_TIERS = new Set(['starter', 'premium', 'legendary']);

export const POST = withApiHandler(async ({ session, request }) => {
  const body = await request.json().catch(() => ({}));
  // Accept either `tier` (clean key) or `capsuleType` (the pack.id from the
  // marketplace which carries the `capsule-` prefix). Both normalize to the
  // tier the service understands.
  const raw = body?.tier ?? body?.capsuleType ?? body?.capsule_type;
  const tier =
    typeof raw === 'string' && raw.startsWith('capsule-') ? raw.slice(8) : raw;
  if (!VALID_TIERS.has(tier)) {
    throw new ApiError('Invalid capsule type', 400);
  }
  const { awarded, balance } = await openCapsule(session.user.id, tier);
  return ok({ tier, awarded, balance });
});
