import { getLiveStrip } from '@/services/live.service.js';

/** Shared with every visitor for 30 s, so the landing page never drives database load. */
const CACHE = 'public, max-age=30, s-maxage=30';

/**
 * GET /api/live (SPEC.md 8): public, no session. The landing strip's next race, last batch results
 * and today's numbers.
 */
export async function GET() {
  try {
    return Response.json({ data: await getLiveStrip() }, { headers: { 'Cache-Control': CACHE } });
  } catch (err) {
    console.error({ scope: 'api', msg: 'live strip failed', err: String(err) });
    return Response.json(
      { error: 'Live data is unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
