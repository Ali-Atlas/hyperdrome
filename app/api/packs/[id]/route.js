import { requireSession } from '@/lib/http/session.js';
import { getPackOpen } from '@/services/pack-open.service.js';

/**
 * GET /api/packs/[id] (SPEC.md 8): one of the player's pack opens, by action id or on-chain pack
 * id: status, transactions and the minted items. Never the secret.
 * @param {Request} _request
 * @param {{ params: Promise<{ id: string }> }} context
 */
export async function GET(_request, context) {
  const who = await requireSession();
  if (who instanceof Response) return who;
  const { id } = await context.params;
  const pack = await getPackOpen(who.userId, id);
  if (!pack) return Response.json({ error: 'Pack not found.' }, { status: 404 });
  return Response.json(pack);
}
