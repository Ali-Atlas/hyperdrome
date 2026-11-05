import { getHealth } from '@/services/health.service.js';

/** A healthy report is cached for a minute, so monitors and the smoke test never load the RPC. */
const CACHE = 'public, max-age=60, s-maxage=60';

/** A request that misses the CDN (a new query string) reuses a healthy report this long. */
const MEMO_MS = 10_000;

/** Each check gives up after 8 s (services/health.service.js), so the answer is always the JSON. */
export const maxDuration = 15;

/** @type {{ at: number, report: import('@/services/health.service.js').HealthReport } | null} */
let memo = null;

/**
 * GET /api/health (SPEC.md 8): `{ data: { ok, database, rpc, scheduler, racingEnabled, checkedAt } }`.
 * 200 when the database and the RPC both answer, 503 otherwise (never cached). Public, no secrets.
 */
export async function GET() {
  if (!memo || Date.now() - memo.at >= MEMO_MS) {
    const checked = await getHealth();
    memo = checked.ok ? { at: Date.now(), report: checked } : null;
    if (!memo) return respond(checked);
  }
  return respond(memo.report);
}

/** @param {import('@/services/health.service.js').HealthReport} report */
function respond(report) {
  return Response.json(
    { data: report },
    {
      status: report.ok ? 200 : 503,
      headers: { 'Cache-Control': report.ok ? CACHE : 'no-store' },
    }
  );
}
