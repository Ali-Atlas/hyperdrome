import { eq } from 'drizzle-orm';
import { ethers } from 'ethers';
import { db, schema } from '@/lib/db';
import { withApiHandler, ok, fail, ApiError } from '@/lib/api/response.js';

const { users } = schema;

// ethers v6 needs Node crypto APIs the Edge runtime doesn't expose.
export const runtime = 'nodejs';

const HYPERDROME_VOLT_ABI = [
  'function balanceOf(address account) view returns (uint256)',
];

/**
 * In-memory cache of `walletAddress -> { balance: bigint, expiresAt: number }`.
 * Keyed by wallet (not user id) so re-binds and shared addresses still hit
 * the same cell. Lives for the lifetime of the server instance; on Vercel
 * that means per-warm-start, which is the right granularity - cold starts
 * naturally re-fetch.
 */
const CACHE_TTL_MS = 30_000;
const balanceCache = new Map();

function readEnv() {
  const contractAddress = process.env.VOLT_CONTRACT_ADDRESS;
  const rpcUrl = process.env.MEGAETH_RPC_URL;
  if (!contractAddress || !rpcUrl) {
    throw new ApiError(
      'Server is missing VOLT configuration; contact an admin',
      500,
    );
  }
  return { contractAddress, rpcUrl };
}

async function fetchOnchainBalance(walletAddress) {
  const env = readEnv();
  const provider = new ethers.JsonRpcProvider(env.rpcUrl);
  const contract = new ethers.Contract(
    env.contractAddress,
    HYPERDROME_VOLT_ABI,
    provider,
  );
  return contract.balanceOf(walletAddress);
}

/**
 * GET /api/volt/balance
 *
 * Returns the authenticated user's on-chain VOLT balance, cached for 30s
 * to avoid hammering the Carrot RPC on dashboard polls. Users without a
 * linked wallet receive a soft `{ balance: "0", formatted: "0" }` so the
 * route is non-throwing for any logged-in caller. NavShell still treats a
 * present-but-zero on-chain value as the source of truth when the wallet
 * is connected; a 200 with zeros is preferable to a 400 since RainbowKit
 * may have a session before the bind round-trip lands.
 */
export const GET = withApiHandler(async ({ session }) => {
  const [user] = await db
    .select({ walletAddress: users.walletAddress })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!user?.walletAddress) {
    return ok({ balance: '0', formatted: '0' });
  }

  const wallet = user.walletAddress.toLowerCase();
  const now = Date.now();

  let raw;
  const cached = balanceCache.get(wallet);
  if (cached && cached.expiresAt > now) {
    raw = cached.balance;
  } else {
    try {
      raw = await fetchOnchainBalance(wallet);
    } catch (err) {
      console.error('[volt/balance] RPC read failed', { wallet, err });
      return fail('On-chain balance read failed', 502);
    }
    balanceCache.set(wallet, { balance: raw, expiresAt: now + CACHE_TTL_MS });
  }

  // 18 decimals matches the contract default. The "formatted" form is for
  // display (e.g. NavShell renders this directly); "balance" is the raw
  // wei-equivalent string callers can do precise math on.
  return ok({
    balance: raw.toString(),
    formatted: ethers.formatUnits(raw, 18),
  });
});
