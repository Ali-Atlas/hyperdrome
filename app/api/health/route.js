import { getHealth } from '@/services/health.service.js';

/** A healthy report is cached for a minute, so monitors and the smoke test never load the RPC. */
const CACHE = 'public, max-age=60, s-maxage=60';

/**
 * GET /api/health (SPEC.md 8): `{ data: { ok, database, rpc, scheduler, racingEnabled, checkedAt } }`.
 * 200 when the database and the RPC both answer, 503 otherwise (never cached). Public, no secrets.
 */
export async function GET() {
  const report = await getHealth();
  return Response.json(
    { data: report },
    {
      status: report.ok ? 200 : 503,
      headers: { 'Cache-Control': report.ok ? CACHE : 'no-store' },
    }
  );
}
