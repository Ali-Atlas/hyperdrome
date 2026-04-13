import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { withApiHandler, ok, ApiError } from '@/lib/api/response.js';
import { updateAdminConfigSchema } from '@/lib/validators';

const { adminConfig } = schema;

export const GET = withApiHandler(async () => {
  const rows = await db.select().from(adminConfig);
  return ok(rows);
});

export const PATCH = withApiHandler(async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const parsed = updateAdminConfigSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError('Invalid request body', 400, parsed.error.issues);
  }
  const [updated] = await db
    .update(adminConfig)
    .set({ value: parsed.data.value, updatedAt: new Date() })
    .where(eq(adminConfig.key, parsed.data.key))
    .returning();
  if (!updated) throw new ApiError('Config key not found', 404);
  return ok(updated);
});
