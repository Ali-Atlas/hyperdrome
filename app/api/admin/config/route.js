import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { withApiHandler, ok, ApiError } from '@/lib/api/response.js';
import { updateAdminConfigSchema } from '@/lib/validators';

const { adminConfig } = schema;

/**
 * Admin gate. `withApiHandler` only checks that a session exists, which
 * any demo or wallet user has. The admin_config table tunes live game
 * parameters (racing_enabled, etc.) so unauthorized writes can kill the
 * cron globally - require the caller's email to appear in ADMIN_EMAILS.
 *
 * ADMIN_EMAILS is a comma-separated allowlist of verified human emails.
 * Demo accounts (synthetic pilot_*@demo.hyperdrome.gg) and wallet
 * accounts (synthetic wallet_*@wallet.hyperdrome.gg) cannot match unless
 * the operator explicitly adds those addresses.
 */
function requireAdmin(session) {
  const raw = process.env.ADMIN_EMAILS ?? '';
  const admins = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const email = session?.user?.email?.toLowerCase();
  if (!email || !admins.includes(email)) {
    throw new ApiError('Admin access required', 403);
  }
}

export const GET = withApiHandler(async ({ session }) => {
  requireAdmin(session);
  const rows = await db.select().from(adminConfig);
  return ok(rows);
});

export const PATCH = withApiHandler(async ({ session, request }) => {
  requireAdmin(session);
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
