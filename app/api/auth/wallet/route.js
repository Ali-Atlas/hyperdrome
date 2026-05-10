import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getAddress } from 'ethers';
import { db, schema } from '@/lib/db';
import { auth, signIn } from '@/lib/auth';
import { generateUniqueDroneName } from '@/lib/game-engine/drone-names.js';

const { users, drones, droneOwnershipHistory } = schema;

// ethers' getAddress (used for the EIP-55 checksum on the input
// address) is the only crypto-ish call left in this route. Everything
// heavy (NFT mints, VOLT mint, gas drip) moved to
// /api/auth/wallet/bootstrap. Node runtime is still required because
// ethers' checksum impl uses keccak256 from the crypto module.
export const runtime = 'nodejs';

const STARTER_VOLTS = 1000;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;


const bodySchema = z.object({
  walletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
});

/** @type {Map<string, { count: number, resetAt: number }>} */
const ipBuckets = new Map();

function getClientIp(request) {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = ipBuckets.get(ip);
  if (!entry || now > entry.resetAt) {
    ipBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count += 1;
  return true;
}

/**
 * Truncated-address username (`0xF7Ba...9888` style). Bounded to 13 chars,
 * well under the schema's 50-char limit. The address is unique by DB
 * constraint, but two distinct addresses can share the same prefix +
 * suffix; collisions on the username are resolved by appending the next
 * 4 chars from the address middle.
 */
function buildUsernameFromAddress(checksummed) {
  return `${checksummed.slice(0, 6)}...${checksummed.slice(-4)}`;
}

function fallbackUsername(checksummed) {
  // 4 chars from the middle of the lowercased form; deterministic per
  // address so a retry produces the same value (idempotent on re-bind).
  const mid = checksummed.slice(10, 14).toLowerCase();
  return `${checksummed.slice(0, 6)}-${mid}-${checksummed.slice(-4)}`;
}

function syntheticEmail(addressLower) {
  return `wallet_${addressLower}@wallet.hyperdrome.gg`;
}


/**
 * POST /api/auth/wallet
 *
 * Wallet-connect entry point. Two paths:
 *
 *   1. Existing wallet:  lookup by lowercased address, sign in, redirect.
 *   2. New wallet:       create user + starter drone (DB), mint drone NFT
 *                        and 1000 VOLT to the player's address, sign in,
 *                        redirect with `isNew: true` so the dashboard
 *                        knows to surface the onboarding overlay.
 *
 * Auth model (testnet MVP): the server trusts the wallet address from the
 * POST body. SIWE / signed-message auth is mainnet polish - acceptable for
 * a testnet demo where the worst case is "someone else takes over an empty
 * starter account", and the on-chain assets are minted to the address itself
 * (so even a forged sign-in cannot steal the drone NFT or VOLT balance).
 *
 * Order of operations (best-effort, Neon HTTP has no transactions):
 *   - insert user                      (must succeed; otherwise 500)
 *   - insert drone + ownership history (best-effort; failure logged)
 *   - mint NFT to player wallet        (best-effort; tokenId/txHash recorded
 *                                       on the drone row when it succeeds)
 *   - mint 1000 VOLT to player wallet  (best-effort; failure logged)
 *   - signIn                           (must succeed; otherwise 500)
 *
 * The drone mint endpoint at /api/drones/[droneId]/mint can re-mint a drone
 * that didn't get a tokenId here, so a partial bootstrap is recoverable
 * from the user's drone manager.
 */
export async function POST(request) {
  // Skip work entirely when the caller already has a session - avoids
  // a redundant DB lookup + signIn on every dashboard remount.
  const session = await auth();
  if (session?.user?.id) {
    return NextResponse.json({ redirectUrl: '/dashboard', isNew: false });
  }

  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many wallet sign-in attempts. Try again later.' },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.issues },
      { status: 400 },
    );
  }

  let checksummed;
  try {
    // ethers' getAddress() validates EIP-55 checksum on mixed-case input
    // and accepts all-lower / all-upper canonical forms. Throws on a bad
    // checksum so a typo can never bind a wrong address.
    checksummed = getAddress(parsed.data.walletAddress);
  } catch {
    return NextResponse.json(
      { error: 'Invalid Ethereum address checksum' },
      { status: 400 },
    );
  }
  const stored = checksummed.toLowerCase();

  // 1. Lookup. The wallet_address column is unique + lowercased so a single
  // SELECT settles the existing-vs-new branch.
  const [existing] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      username: users.username,
    })
    .from(users)
    .where(eq(users.walletAddress, stored))
    .limit(1);

  if (existing) {
    try {
      await signIn('wallet', {
        userId: existing.id,
        walletSecret: process.env.NEXTAUTH_SECRET,
        redirect: false,
      });
    } catch (err) {
      console.error('[auth/wallet] signIn (existing) failed:', err);
      return NextResponse.json(
        { error: 'Wallet recognized but sign-in failed. Try refreshing.' },
        { status: 500 },
      );
    }
    return NextResponse.json({
      redirectUrl: '/dashboard',
      isNew: false,
      user: {
        id: existing.id,
        username: existing.username,
        walletAddress: checksummed,
      },
    });
  }

  // 2. New wallet. Create user with truncated-address username + synthetic
  // email (the schema makes email NOT NULL UNIQUE for the NextAuth adapter;
  // wallet@<lowercased>@wallet.hyperdrome.gg is unique by construction).
  const baseUsername = buildUsernameFromAddress(checksummed);
  let user = null;
  for (const candidateUsername of [baseUsername, fallbackUsername(checksummed)]) {
    try {
      const [created] = await db
        .insert(users)
        .values({
          name: candidateUsername,
          username: candidateUsername,
          email: syntheticEmail(stored),
          emailVerified: new Date(),
          walletAddress: stored,
          // Mirror the on-chain starter so the DB-side stat-upgrade gate
          // (services/drone.service.js validateStatAllocation) sees the
          // user's spendable balance. The on-chain mint below is the
          // source of truth for display via /api/volt/balance.
          points: STARTER_VOLTS,
        })
        .returning();
      user = created;
      break;
    } catch (err) {
      const code = err?.code ?? err?.cause?.code;
      // 23505 = unique_violation. Either username collision (fall through
      // to the fallback form) or wallet/email collision (a concurrent
      // request just created this user; re-lookup and sign in).
      if (code !== '23505') {
        console.error('[auth/wallet] user insert failed:', err);
        return NextResponse.json(
          { error: 'Could not provision a wallet account. Try again.' },
          { status: 500 },
        );
      }
    }
  }

  if (!user) {
    // Concurrent insert won the race - re-read and sign in.
    const [raced] = await db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.walletAddress, stored))
      .limit(1);
    if (!raced) {
      return NextResponse.json(
        { error: 'Could not provision a wallet account. Try again.' },
        { status: 500 },
      );
    }
    try {
      await signIn('wallet', {
        userId: raced.id,
        walletSecret: process.env.NEXTAUTH_SECRET,
        redirect: false,
      });
    } catch (err) {
      console.error('[auth/wallet] signIn (race recovery) failed:', err);
      return NextResponse.json(
        { error: 'Wallet recognized but sign-in failed. Try refreshing.' },
        { status: 500 },
      );
    }
    return NextResponse.json({
      redirectUrl: '/dashboard',
      isNew: false,
      user: {
        id: raced.id,
        username: raced.username,
        walletAddress: checksummed,
      },
    });
  }

  // 3. Starter drone (DB row). Every stat starts at 1 (sum 9, TSB 29 ->
  // 20 points of allocation headroom). Same baseline as the magic-link
  // email starter (lib/auth/index.js#createStarterDrone) so wallet and
  // email signups produce identical starter rosters and every new player
  // has the same day-one reason to engage with stat allocation.
  let drone = null;
  try {
    const droneName = await generateUniqueDroneName(db, drones);
    [drone] = await db
      .insert(drones)
      .values({
        userId: user.id,
        name: droneName,
        level: 1,
        xp: 0,
        xpToNextLevel: 300,
        totalStatBudget: 29,
        speed: 1,
        turning: 1,
        acceleration: 1,
        durability: 1,
        nightVision: 1,
        batteryCapacity: 1,
        rainHandling: 1,
        windResistance: 1,
        consistency: 1,
        active: true,
        imageUrl: '/drones/default.png',
        isBot: false,
      })
      .returning();
    await db.insert(droneOwnershipHistory).values({
      droneId: drone.id,
      ownerUserId: user.id,
      transactionType: 'creation',
    });
  } catch (err) {
    console.error('[auth/wallet] starter drone insert failed:', err);
  }

  // 4. Sign in. The on-chain mints (drone NFT, starter skin + mod, VOLT,
  // gas drip) are NOT awaited here - they're handled by a follow-up
  // POST to /api/auth/wallet/bootstrap that the client fires immediately
  // after the auth response lands. Splitting keeps this endpoint under
  // ~2s on Neon HTTP so the user reaches /dashboard immediately and
  // sees loading states for the in-flight assets, instead of waiting
  // ~95s for sequential RPC mints.
  try {
    await signIn('wallet', {
      userId: user.id,
      walletSecret: process.env.NEXTAUTH_SECRET,
      redirect: false,
    });
  } catch (err) {
    console.error('[auth/wallet] signIn (new) failed:', err);
    return NextResponse.json(
      { error: 'Account created but sign-in failed. Try connecting again.' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    redirectUrl: '/dashboard',
    isNew: true,
    // bootstrapNeeded is the client's signal to fire the (async, fire-
    // and-forget) POST /api/auth/wallet/bootstrap that runs the NFT +
    // VOLT + gas mints. Always true on the new-wallet branch since
    // we just inserted the user with no on-chain assets yet. Existing
    // users hit a separate response path above (no isNew, no
    // bootstrapNeeded).
    bootstrapNeeded: true,
    user: {
      id: user.id,
      username: user.username,
      walletAddress: checksummed,
    },
    starterDrone: drone
      ? { id: drone.id, name: drone.name }
      : null,
  });
}
