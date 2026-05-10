import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { ethers, getAddress } from 'ethers';
import { db, schema } from '@/lib/db';
import { auth, signIn } from '@/lib/auth';
import { buildLowRangeStats } from '@/lib/game-engine/drone-spawn.js';
import { generateUniqueDroneName } from '@/lib/game-engine/drone-names.js';
import { mintVoltToWallet } from '@/lib/onchain/volt.js';
import { sendStarterGas } from '@/lib/onchain/gas.js';

const { users, drones, droneOwnershipHistory } = schema;

// ethers v6 needs Node crypto APIs the Edge runtime doesn't expose, and the
// drone-mint round-trip on Carrot RPC can take 5-15s. Match the existing
// drone mint route's nodejs runtime + 60s ceiling.
export const runtime = 'nodejs';
export const maxDuration = 60;

const STARTER_VOLTS = 1000;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const HYPERDROME_DRONE_ABI = [
  'function mint(address to, uint256 tokenId) external',
  'function ownerOf(uint256 tokenId) view returns (address)',
];

// Hard cap on the upward probe. 10k is comfortably above any realistic
// on-chain supply for a single batch script and keeps a corrupt RPC from
// burning unbounded calls. Mirrors `scripts/batch-mint-drones.js` PROBE_MAX.
const PROBE_MAX = 10_000;

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

function readMintEnv() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const contractAddress =
    process.env.NEXT_PUBLIC_DRONE_CONTRACT_ADDRESS ??
    process.env.DRONE_CONTRACT_ADDRESS;
  const rpcUrl = process.env.MEGAETH_RPC_URL;
  const missing = [];
  if (!privateKey) missing.push('DEPLOYER_PRIVATE_KEY');
  if (!contractAddress) missing.push('NEXT_PUBLIC_DRONE_CONTRACT_ADDRESS');
  if (!rpcUrl) missing.push('MEGAETH_RPC_URL');
  if (missing.length) return { ok: false, missing };
  return { ok: true, privateKey, contractAddress, rpcUrl };
}

/**
 * ERC-721 `ownerOf` reverts on a non-existent tokenId. Collapse the throw
 * to `false` so the probe loop reads "is this id taken?" cleanly. Mirrors
 * `scripts/batch-mint-drones.js` `tokenExists`.
 */
async function tokenExists(contract, tokenId) {
  try {
    await contract.ownerOf(tokenId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mint a freshly created drone to the player's wallet on MegaETH testnet v2.
 *
 * Probe pattern: the DB's `MAX(tokenId) + 1` is just a starting hint. The
 * contract's on-chain supply may already be ahead of the DB (this exact
 * route is the cause - earlier sign-ups minted on-chain but a follow-up
 * write or a different DB instance left the row without a tokenId). Walk
 * upward via `ownerOf` until we find the first unused slot, then mint
 * there. Without this probe a fresh wallet sign-up always tried tokenId=1
 * on a contract whose supply was already at N, so every sign-up reverted
 * with "ERC721 token already minted".
 *
 * Returns null when env is missing or the mint fails - the caller keeps
 * the DB drone unminted and the user can re-mint via the drone manager.
 *
 * @returns {Promise<null | { tokenId: number, txHash: string }>}
 */
async function mintStarterDroneNft(walletAddress) {
  const env = readMintEnv();
  if (!env.ok) {
    console.warn(
      `[auth/wallet] starter drone mint skipped - missing env: ${env.missing.join(', ')}`,
    );
    return null;
  }

  const [agg] = await db
    .select({ maxId: sql`COALESCE(MAX(${drones.tokenId}), 0)` })
    .from(drones);
  const dbStart = Number(agg?.maxId ?? 0) + 1;

  const provider = new ethers.JsonRpcProvider(env.rpcUrl);
  const wallet = new ethers.Wallet(env.privateKey, provider);
  const contract = new ethers.Contract(
    env.contractAddress,
    HYPERDROME_DRONE_ABI,
    wallet,
  );

  let tokenId = dbStart;
  let probed = 0;
  while (await tokenExists(contract, tokenId)) {
    tokenId += 1;
    probed += 1;
    if (probed > PROBE_MAX) {
      throw new Error(
        `tokenId probe overran ${PROBE_MAX} above DB max ${dbStart - 1}; aborting`,
      );
    }
  }
  if (probed > 0) {
    console.log(
      `[auth/wallet] tokenId probe found ${probed} on-chain orphans above DB max; minting at tokenId=${tokenId}`,
    );
  }

  const tx = await contract.mint(walletAddress, tokenId);
  const receipt = await tx.wait();
  const txHash = receipt?.hash ?? tx.hash;
  return { tokenId, txHash };
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

  // 3. Starter drone (DB row). Same low-range LV1 roll as the magic-link
  // starter so wallet and email signups produce comparable starter rosters.
  let drone = null;
  try {
    const stats = buildLowRangeStats(1, 5);
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
        ...stats,
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

  // 4. NFT mint. Best-effort - on failure the drone stays in DB without a
  // tokenId and the user can re-mint from the drone manager later.
  let mintTxHash = null;
  let mintTokenId = null;
  if (drone) {
    try {
      const mint = await mintStarterDroneNft(checksummed);
      if (mint) {
        mintTxHash = mint.txHash;
        mintTokenId = mint.tokenId;
        await db
          .update(drones)
          .set({
            tokenId: mint.tokenId,
            mintTxHash: mint.txHash,
            mintedAt: new Date(),
          })
          .where(eq(drones.id, drone.id));
        console.log(
          `[auth/wallet] starter drone mint ok - droneId=${drone.id} tokenId=${mint.tokenId} tx=${mint.txHash} wallet=${stored}`,
        );
      } else {
        console.warn(
          `[auth/wallet] starter drone mint returned null - droneId=${drone.id} wallet=${stored} (env or pre-flight failure)`,
        );
      }
    } catch (err) {
      console.error('[auth/wallet] starter drone mint failed:', {
        droneId: drone.id,
        wallet: stored,
        reason: err?.shortMessage ?? err?.message ?? 'unknown',
        code: err?.code,
      });
    }
  }

  // 5. Starter VOLT to the player's wallet. Best-effort - failure leaves the
  // user with the DB-side STARTER_VOLTS mirror so the upgrade gate still
  // works; on-chain balance can be topped up via scripts/mint-volt.js.
  let voltMintTxHash = null;
  try {
    const result = await mintVoltToWallet(checksummed, STARTER_VOLTS);
    voltMintTxHash = result?.txHash ?? null;
    if (result?.txHash) {
      console.log(
        `[auth/wallet] starter VOLT mint ok - amount=${STARTER_VOLTS} tx=${result.txHash} wallet=${stored}`,
      );
    } else {
      console.warn(
        `[auth/wallet] starter VOLT mint returned null - wallet=${stored} (likely missing DEPLOYER_PRIVATE_KEY / MEGAETH_RPC_URL / VOLT_CONTRACT_ADDRESS)`,
      );
    }
  } catch (err) {
    console.error('[auth/wallet] starter VOLT mint failed:', {
      wallet: stored,
      reason: err?.shortMessage ?? err?.message ?? 'unknown',
      code: err?.code,
    });
  }

  // 6. Starter gas drop. Send 0.001 ETH from the deployer so the user can
  // pay gas on their own (user-signed) VOLT approvals + marketplace buys.
  // Best-effort - failure leaves the user with their starter NFT + VOLT
  // but no gas; they can be topped up manually if it matters. We don't
  // block sign-in on this because most flows still work for a gasless
  // user (race rewards, level-ups, on-chain reads).
  let gasTxHash = null;
  try {
    const gas = await sendStarterGas(checksummed);
    gasTxHash = gas?.txHash ?? null;
    if (gas?.txHash) {
      console.log(
        `[auth/wallet] starter gas drop ok - 0.001 ETH tx=${gas.txHash} wallet=${stored}`,
      );
    } else {
      console.warn(
        `[auth/wallet] starter gas drop returned null - wallet=${stored} (likely missing DEPLOYER_PRIVATE_KEY / MEGAETH_RPC_URL)`,
      );
    }
  } catch (err) {
    console.error('[auth/wallet] starter gas drop failed:', {
      wallet: stored,
      reason: err?.shortMessage ?? err?.message ?? 'unknown',
      code: err?.code,
    });
  }

  // 7. Sign in. If this fails the bootstrap is wasted - the row exists but
  // the user has no session; the next press will hit the existing-wallet
  // branch and sign in cleanly, so a transient signIn failure is recoverable.
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
    user: {
      id: user.id,
      username: user.username,
      walletAddress: checksummed,
    },
    starterDrone: drone
      ? { id: drone.id, name: drone.name, tokenId: mintTokenId, mintTxHash }
      : null,
    voltMintTxHash,
    gasTxHash,
  });
}
