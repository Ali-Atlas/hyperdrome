import { getEconomy } from '@/services/economy.service.js';

/** Shared with every visitor for 30 s, so the page never drives database load. */
const CACHE = 'public, max-age=30, s-maxage=30';

/**
 * GET /api/economy (SPEC.md 8): public, no session. The last 24 hours of economy snapshots, the
 * latest AI team decisions with their reasons, and the rules the teams follow.
 */
export async function GET() {
  try {
    return Response.json({ data: await getEconomy() }, { headers: { 'Cache-Control': CACHE } });
  } catch (err) {
    console.error({ scope: 'api', msg: 'economy failed', err: String(err) });
    return Response.json(
      { error: 'Economy data is unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
