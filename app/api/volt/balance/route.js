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
 * GET /api/volt/balance[?address=0x...]
 *
 * Returns the on-chain VOLT balance for an address, cached for 30s to
 * avoid hammering the Carrot RPC on dashboard polls.
 *
 * Address resolution:
 *   1. If `?address=0x...` is provided, validate it and query that address
 *      directly. NavShell uses this path so the displayed balance reflects
 *      the wallet that's currently RainbowKit-attached, regardless of
 *      whether the user account has that wallet bound in `users` (the
 *      bind can be locked out by a 409 if the same wallet is already on
 *      another account).
 *   2. Otherwise, fall back to the authenticated user's bound
 *      `walletAddress`. Returns `{ hasWallet: false }` if neither is set.
 *
 * Auth is required either way (withApiHandler enforces). On-chain
 * `balanceOf` is public on the chain anyway, so accepting an arbitrary
 * address as input does not leak anything users can't already read from
 * Blockscout.
 */
export const GET = withApiHandler(async ({ session, request }) => {
  const url = new URL(request.url);
  const queryAddress = url.searchParams.get('address');

  let wallet = null;
  if (queryAddress) {
    try {
      // ethers.getAddress validates the EIP-55 checksum (or canonical
      // all-lower / all-upper) and throws on garbage input.
      wallet = ethers.getAddress(queryAddress).toLowerCase();
    } catch {
      return fail('Invalid address parameter', 400);
    }
  } else {
    const [user] = await db
      .select({ walletAddress: users.walletAddress })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    if (user?.walletAddress) {
      wallet = user.walletAddress.toLowerCase();
    }
  }

  if (!wallet) {
    // hasWallet=false signals "no on-chain balance to display" so callers
    // (NavShell when no RainbowKit address is attached) can keep showing
    // the DB-volts fallback instead of mistaking the 0 for an
    // authoritative on-chain reading.
    return ok({ balance: '0', formatted: '0', hasWallet: false });
  }

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
    hasWallet: true,
  });
});
