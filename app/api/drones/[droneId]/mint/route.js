import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { ethers } from 'ethers';
import { db, schema } from '@/lib/db';
import { withApiHandler, ok, fail, ApiError } from '@/lib/api/response.js';

const { drones, users } = schema;

// ethers v6 needs Node crypto APIs that the Edge runtime lacks. Pin to
// Node and extend the function timeout: a mint + receipt round-trip on
// Carrot RPC can take 5-15s, comfortably above Vercel's 10s default.
export const runtime = 'nodejs';
export const maxDuration = 60;

const uuidSchema = z.uuid();

const EXPLORER_BASE = 'https://megaeth-testnet-v2.blockscout.com';

/**
 * Minimal ABI - we only call mint() server-side. Full ABI lives in the
 * Hardhat artifact under contracts/artifacts/; pulling it in here would
 * couple the app build to a JSON we don't otherwise need.
 */
const HYPERDROME_DRONE_ABI = [
  'function mint(address to, uint256 tokenId) external',
];

function readEnv() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const contractAddress =
    process.env.NEXT_PUBLIC_DRONE_CONTRACT_ADDRESS ??
    process.env.DRONE_CONTRACT_ADDRESS;
  const rpcUrl = process.env.MEGAETH_RPC_URL;
  if (!privateKey || !contractAddress || !rpcUrl) {
    throw new ApiError(
      'Server is missing minting configuration; contact an admin',
      500,
    );
  }
  return { privateKey, contractAddress, rpcUrl };
}

/**
 * POST /api/drones/[droneId]/mint
 *
 * Mint the drone as an NFT on MegaETH testnet v2 from the deployer wallet
 * to the user's linked wallet. Server-side only - the user never signs;
 * we use the deployer's onlyOwner permission on HyperdromeDrone.mint().
 *
 * Order of operations:
 *   1. validate (UUID, ownership, not already minted, wallet linked)
 *   2. compute next tokenId (max + 1) - NO DB write yet
 *   3. submit mint() and wait for receipt
 *   4. on success, write {tokenId, mintTxHash, mintedAt} to the drone row
 *   5. on DB-write failure post-mint, log everything for manual recovery
 *
 * Rationale per Captain: never reserve a tokenId in the DB before the
 * on-chain mint confirms. If the chain succeeds and the DB write fails,
 * the contract still has the token; recovery is a manual UPDATE keyed
 * off the txHash logged here.
 *
 * Race notes: between (2) and (3), a second concurrent request could
 * compute the same nextTokenId. The contract's _safeMint will revert
 * the second mint (`ERC721: token already minted`); we surface that as
 * a 500 with the chain error and the user can retry. The UNIQUE on
 * drones.token_id catches any DB-side race for the same value too.
 */
export const POST = withApiHandler(async ({ session, params }) => {
  const parsed = uuidSchema.safeParse(params.droneId);
  if (!parsed.success) return fail('Drone not found', 404);
  const droneId = parsed.data;

  // 1. Drone + owner + wallet checks. Joined query so we get user's
  // wallet_address in the same round-trip as the drone validation.
  const [row] = await db
    .select({
      droneId: drones.id,
      droneUserId: drones.userId,
      tokenId: drones.tokenId,
      walletAddress: users.walletAddress,
    })
    .from(drones)
    .leftJoin(users, eq(users.id, drones.userId))
    .where(eq(drones.id, droneId))
    .limit(1);

  if (!row) return fail('Drone not found', 404);
  if (row.droneUserId !== session.user.id) {
    return fail('You do not own this drone', 403);
  }
  if (row.tokenId != null) {
    return fail('This drone is already minted', 409);
  }
  if (!row.walletAddress) {
    return fail('Connect a wallet first', 400);
  }

  // 2. Compute next tokenId. COALESCE handles the empty-table case so the
  // very first mint takes id 1 instead of NaN+1. Number() coerces the
  // pg-driver bigint-ish return to a plain JS number safe for ethers.
  const [agg] = await db
    .select({ maxId: sql`COALESCE(MAX(${drones.tokenId}), 0)` })
    .from(drones);
  const nextTokenId = Number(agg?.maxId ?? 0) + 1;

  // 3. Submit on-chain mint and await receipt.
  const env = readEnv();
  const provider = new ethers.JsonRpcProvider(env.rpcUrl);
  const wallet = new ethers.Wallet(env.privateKey, provider);
  const contract = new ethers.Contract(
    env.contractAddress,
    HYPERDROME_DRONE_ABI,
    wallet,
  );

  let txHash;
  try {
    const tx = await contract.mint(row.walletAddress, nextTokenId);
    const receipt = await tx.wait();
    txHash = receipt?.hash ?? tx.hash;
  } catch (err) {
    // Mint did NOT succeed on chain - safe to surface the error and let
    // the user retry. No DB state to roll back since we haven't written.
    console.error('[mint] on-chain mint failed', { droneId, nextTokenId, err });
    return fail('On-chain mint failed; please try again', 500, {
      reason: err?.shortMessage ?? err?.message ?? 'unknown',
    });
  }

  // 4. Persist on-chain success to the drone row.
  const mintedAt = new Date();
  try {
    await db
      .update(drones)
      .set({ tokenId: nextTokenId, mintTxHash: txHash, mintedAt })
      .where(eq(drones.id, droneId));
  } catch (err) {
    // 5. The chain has the token but our DB doesn't. Recovery: an admin
    // runs UPDATE drones SET token_id=<nextTokenId>, mint_tx_hash=<txHash>,
    // minted_at=<mintedAt> WHERE id=<droneId>. Log everything needed.
    console.error(
      '[mint] CRITICAL: on-chain mint succeeded but DB update failed - manual recovery required',
      { droneId, tokenId: nextTokenId, txHash, mintedAt: mintedAt.toISOString(), err },
    );
    return fail(
      'Mint succeeded on-chain but the drone record could not be updated; an admin has been notified',
      500,
      { txHash, tokenId: nextTokenId },
    );
  }

  return ok({
    success: true,
    tokenId: nextTokenId,
    txHash,
    explorerUrl: `${EXPLORER_BASE}/token/${env.contractAddress}/instance/${nextTokenId}`,
  });
});
