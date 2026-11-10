import { getReplayDecisions } from '@/services/economy.service.js';

/** Shared with every visitor for 30 s, like `GET /api/economy`. */
const CACHE = 'public, max-age=30, s-maxage=30';

/**
 * GET /api/economy/decisions (SPEC.md 8): public, no session. Every AI team decision of the last
 * 24 hours in compact form, read by the economy page only when a replay starts.
 */
export async function GET() {
  try {
    return Response.json(
      { data: { decisions: await getReplayDecisions() } },
      { headers: { 'Cache-Control': CACHE } }
    );
  } catch (err) {
    console.error({ scope: 'api', msg: 'economy decisions failed', err: String(err) });
    return Response.json(
      { error: 'Economy data is unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
