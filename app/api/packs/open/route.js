import { handleMutation } from '@/lib/http/mutation.js';
import { packOpenBodySchema } from '@/lib/validators/gameplay.js';
import { openPack } from '@/services/pack-open.service.js';

/** Two chain calls (commit, then reveal in a later block), each waiting for execution. */
export const maxDuration = 60;

/**
 * POST /api/packs/open (SPEC.md 2.7, 4.4 `open_pack` then `reveal_pack`): body
 * `{ actionId, kind, tier }`. 200 with the three minted tokens; 202 while an outcome is unknown
 * (send the same body again to resume).
 * @param {Request} request
 */
export async function POST(request) {
  return handleMutation(request, packOpenBodySchema, ({ userId, body }) =>
    openPack({ userId, ...body })
  );
}
