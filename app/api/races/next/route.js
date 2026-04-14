import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { withApiHandler, ok } from '@/lib/api/response.js';
import { getNextRaceTime } from '@/services/race.service.js';

const { adminConfig } = schema;

export const GET = withApiHandler(
  async () => {
    // Check the master racing kill-switch first
    const [flag] = await db
      .select()
      .from(adminConfig)
      .where(eq(adminConfig.key, 'racing_enabled'))
      .limit(1);
    const enabled = flag?.value === 'true';

    if (!enabled) {
      return ok({ paused: true, nextRaceAt: null });
    }

    const next = await getNextRaceTime();
    return ok({ paused: false, nextRaceAt: next.toISOString() });
  },
  { requireAuth: false },
);
