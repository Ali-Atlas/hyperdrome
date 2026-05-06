import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getAddress } from 'viem';
import { db, schema } from '@/lib/db';
import { withApiHandler, ok, fail, ApiError } from '@/lib/api/response.js';

const { users } = schema;

/**
 * Body shape: { walletAddress: string }. Regex is intentionally loose
 * (case-insensitive 0x + 40 hex) - viem's getAddress() does the
 * authoritative validation downstream and rejects invalid checksums.
 */
const linkWalletSchema = z.object({
  walletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
});

/**
 * POST /api/user/wallet
 *
 * Link a connected wallet to the authenticated user. The address is stored
 * lowercased so DB lookups are case-insensitive without LOWER() everywhere;
 * the EIP-55 checksummed form is returned to the caller for display.
 *
 * Idempotent: re-binding the same address is a no-op write.
 *
 * Auth: required (withApiHandler returns 401 otherwise).
 *
 * The DB write is inlined here rather than living in a service. This is a
 * single-table column update with no business logic to abstract, and the
 * Phase 2 prompt restricted modifications to existing service files.
 */
export const POST = withApiHandler(async ({ session, request }) => {
  const body = await request.json().catch(() => null);
  const parsed = linkWalletSchema.safeParse(body);
  if (!parsed.success) {
    return fail('Invalid request body', 400, parsed.error.issues);
  }

  let checksummed;
  try {
    checksummed = getAddress(parsed.data.walletAddress);
  } catch {
    return fail('Invalid Ethereum address checksum', 400);
  }

  const stored = checksummed.toLowerCase();
  let row;
  try {
    [row] = await db
      .update(users)
      .set({ walletAddress: stored })
      .where(eq(users.id, session.user.id))
      .returning({ id: users.id, walletAddress: users.walletAddress });
  } catch (err) {
    // PostgreSQL unique_violation (SQLSTATE 23505). The only UNIQUE
    // constraint touched by this UPDATE is wallet_address, so a hit
    // here means a different user has already linked the same wallet.
    // Same-user re-bind to the same address is a no-op and does NOT
    // raise this error.
    const code = err?.code ?? err?.cause?.code;
    if (code === '23505') {
      return fail('This wallet is already linked to another account', 409);
    }
    throw err;
  }

  if (!row) throw new ApiError('User not found', 404);

  return ok({
    id: row.id,
    walletAddress: row.walletAddress ? getAddress(row.walletAddress) : null,
  });
});
