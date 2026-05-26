import { withApiHandler, ok } from '@/lib/api/response.js';

// Racing is paused for now (auto-race cron disabled to cut DB costs).
// Short-circuit to paused without touching the DB so this endpoint -
// which the countdown bar polls every 30s per active user - stops
// generating per-poll reads. The countdown UI shows "Racing paused"
// whenever this returns { paused: true }.
//
// To re-enable racing: restore the racing_enabled DB check (see git
// history for this file) and add the cron back to vercel.json.
export const GET = withApiHandler(
  async () => {
    return ok({ paused: true, nextRaceAt: null });
  },
  { requireAuth: false },
);
