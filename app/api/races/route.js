import { withApiHandler, ok } from '@/lib/api/response.js';
import { getRaces, getTotalRaceCount } from '@/services/race.service.js';
import { paginationSchema } from '@/lib/validators';

export const GET = withApiHandler(
  async ({ request }) => {
    const url = new URL(request.url);
    const parsed = paginationSchema.safeParse(
      Object.fromEntries(url.searchParams),
    );
    const pagination = parsed.success ? parsed.data : { page: 1, limit: 20 };
    const filters = {
      trackId: url.searchParams.get('track_id') || undefined,
      weather: url.searchParams.get('weather') || undefined,
      timeOfDay: url.searchParams.get('time_of_day') || undefined,
      droneId: url.searchParams.get('drone_id') || undefined,
      userId: url.searchParams.get('user_id') || undefined,
      status: url.searchParams.get('status') || undefined,
    };
    const [items, total] = await Promise.all([
      getRaces(filters, pagination),
      getTotalRaceCount({ userId: filters.userId }),
    ]);
    return ok({ items, total, page: pagination.page, limit: pagination.limit });
  },
  { requireAuth: false },
);
