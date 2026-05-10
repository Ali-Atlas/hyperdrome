/**
 * POST /api/auth/wallet/bootstrap
 *
 * Idempotent on-chain provisioning for a new wallet user. The fast-path
 * /api/auth/wallet route now responds as soon as the DB user + drone
 * row are inserted (sub-second on Neon HTTP); the on-chain mints +
 * gas drip happen here, fired-and-forgotten by the client right after
 * the auth response lands. The user is already on /dashboard and sees
 * loading states while this runs.
 *
 * Why a separate endpoint instead of an unawaited promise inside the
 * auth route: Vercel's serverless runtime kills the function as soon
 * as the response is sent, dropping any non-awaited work. A second
 * client-initiated request is the only reliable way to keep the
 * mints alive past the auth response.
 *
 * Idempotency:
 *   - Drone NFT: mints only when `drones.tokenId IS NULL` for the
 *     user's starter drone.
 *   - Starter skin: clones + mints only when the user has zero skin
 *     rows in the DB.
 *   - Starter mod: same shape as skin.
 *   - VOLT mint: gated on `users.starter_volt_minted_at`.
 *   - Gas drip: gated on `users.starter_gas_sent_at`.
 *
 * Called from HeroConnectWallet (and HeaderConnectWallet) immediately
 * after auth succeeds, with `{ method: 'POST' }` and no body. Auth is
 * required - the session resolves the wallet to provision against.
 *
 * Each step is best-effort: a failure logs but does not abort the
 * remaining steps. The endpoint returns 200 with per-asset status
 * even on partial failure so the caller can decide whether to retry.
 */

import { eq } from 'drizzle-orm';
import { ethers, getAddress } from 'ethers';
import { db, schema } from '@/lib/db';
import {
  withApiHandler,
  ok,
  ApiError,
} from '@/lib/api/response.js';
import { cloneStarterSkin, cloneStarterMod } from '@/lib/auth';
import { mintVoltToWallet } from '@/lib/onchain/volt.js';
import { sendStarterGas } from '@/lib/onchain/gas.js';
import { claimNextTokenId, bumpAndClaim } from '@/lib/onchain/token-id.js';

const { users, drones, skins, mods } = schema;

const STARTER_VOLTS = 1000;

export const runtime = 'nodejs';
export const maxDuration = 60;

const HYPERDROME_NFT_ABI = [
  'function mint(address to, uint256 tokenId) external',
];

function isAlreadyMintedError(err) {
  const msg = (err?.shortMessage ?? err?.reason ?? err?.message ?? '').toLowerCase();
  return msg.includes('already minted') || msg.includes('token already exists');
}

/**
 * Mint an NFT to a wallet using the counter-allocator + retry-once
 * pattern. Pure helper: callers handle the DB writeback and any
 * downstream bookkeeping.
 */
async function mintViaCounter({
  contractKey,
  contractAddress,
  walletAddress,
  rpcUrl,
  privateKey,
}) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(contractAddress, HYPERDROME_NFT_ABI, wallet);

  let tokenId = await claimNextTokenId(contractKey);
  try {
    const tx = await contract.mint(walletAddress, tokenId);
    const receipt = await tx.wait();
    return { tokenId, txHash: receipt?.hash ?? tx.hash };
  } catch (err) {
    if (!isAlreadyMintedError(err)) throw err;
    console.warn(
      `[bootstrap] ${contractKey} tokenId=${tokenId} collided; retrying once`,
    );
    tokenId = await bumpAndClaim(contractKey, tokenId);
    const tx = await contract.mint(walletAddress, tokenId);
    const receipt = await tx.wait();
    return { tokenId, txHash: receipt?.hash ?? tx.hash };
  }
}

export const POST = withApiHandler(async ({ session }) => {
  const userId = session?.user?.id;
  if (!userId) throw new ApiError('Not authenticated', 401);

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new ApiError('User not found', 404);

  // Bootstrap is wallet-only. Demo accounts skip everything cleanly so a
  // misfired call (e.g. a refresh on /dashboard) is a no-op.
  if (!user.walletAddress) {
    return ok({
      skipped: true,
      reason: 'no wallet bound to this account',
    });
  }

  let checksummed;
  try {
    checksummed = getAddress(user.walletAddress);
  } catch {
    throw new ApiError('Stored wallet address is malformed', 500);
  }
  const stored = checksummed.toLowerCase();

  const result = {
    drone: { status: 'skipped', reason: 'not-applicable' },
    skin: { status: 'skipped', reason: 'not-applicable' },
    mod: { status: 'skipped', reason: 'not-applicable' },
    volt: { status: 'skipped', reason: 'not-applicable' },
    gas: { status: 'skipped', reason: 'not-applicable' },
  };

  const droneEnv = {
    privateKey: process.env.DEPLOYER_PRIVATE_KEY,
    rpcUrl: process.env.MEGAETH_RPC_URL,
    droneAddress:
      process.env.NEXT_PUBLIC_DRONE_CONTRACT_ADDRESS ??
      process.env.DRONE_CONTRACT_ADDRESS,
    skinAddress: process.env.SKIN_CONTRACT_ADDRESS,
    modAddress: process.env.MOD_CONTRACT_ADDRESS,
  };

  // 1. Drone NFT - mint when the user's starter drone exists and has
  //    no tokenId yet. The starter drone was inserted by /api/auth/wallet;
  //    here we just look it up (most-recent for this user).
  try {
    const [drone] = await db
      .select()
      .from(drones)
      .where(eq(drones.userId, userId))
      .orderBy(drones.createdAt)
      .limit(1);
    if (!drone) {
      result.drone = { status: 'skipped', reason: 'no drone in DB' };
    } else if (drone.tokenId != null) {
      result.drone = { status: 'already', tokenId: drone.tokenId };
    } else if (!droneEnv.privateKey || !droneEnv.rpcUrl || !droneEnv.droneAddress) {
      result.drone = { status: 'failed', reason: 'env not configured' };
    } else {
      const mint = await mintViaCounter({
        contractKey: 'drone',
        contractAddress: droneEnv.droneAddress,
        walletAddress: checksummed,
        rpcUrl: droneEnv.rpcUrl,
        privateKey: droneEnv.privateKey,
      });
      await db
        .update(drones)
        .set({
          tokenId: mint.tokenId,
          mintTxHash: mint.txHash,
          mintedAt: new Date(),
        })
        .where(eq(drones.id, drone.id));
      result.drone = { status: 'minted', tokenId: mint.tokenId, txHash: mint.txHash };
      console.log(
        `[bootstrap] drone mint ok tokenId=${mint.tokenId} tx=${mint.txHash} wallet=${stored}`,
      );
    }
  } catch (err) {
    result.drone = {
      status: 'failed',
      reason: err?.shortMessage ?? err?.message ?? 'unknown',
    };
    console.error('[bootstrap] drone mint failed', { wallet: stored, err });
  }

  // 2. Starter skin - clone Ember (cloneStarterSkin enforces it; falls
  //    back to a random common with a warning if Ember isn't in the
  //    vault). Idempotent via "user already owns at least one skin".
  try {
    const [existingSkin] = await db
      .select({ id: skins.id, tokenId: skins.tokenId })
      .from(skins)
      .where(eq(skins.userId, userId))
      .limit(1);
    if (existingSkin && existingSkin.tokenId != null) {
      result.skin = { status: 'already', tokenId: existingSkin.tokenId };
    } else if (!droneEnv.privateKey || !droneEnv.rpcUrl || !droneEnv.skinAddress) {
      result.skin = { status: 'failed', reason: 'env not configured' };
    } else {
      let skinRow = existingSkin ?? null;
      if (!skinRow) {
        skinRow = await cloneStarterSkin(userId);
      }
      if (!skinRow) {
        result.skin = { status: 'failed', reason: 'common skin vault empty' };
      } else {
        const mint = await mintViaCounter({
          contractKey: 'skin',
          contractAddress: droneEnv.skinAddress,
          walletAddress: checksummed,
          rpcUrl: droneEnv.rpcUrl,
          privateKey: droneEnv.privateKey,
        });
        await db
          .update(skins)
          .set({
            tokenId: mint.tokenId,
            mintTxHash: mint.txHash,
            mintedAt: new Date(),
          })
          .where(eq(skins.id, skinRow.id));
        result.skin = { status: 'minted', tokenId: mint.tokenId, txHash: mint.txHash };
        console.log(
          `[bootstrap] skin mint ok skinId=${skinRow.id} tokenId=${mint.tokenId} tx=${mint.txHash}`,
        );
      }
    }
  } catch (err) {
    result.skin = {
      status: 'failed',
      reason: err?.shortMessage ?? err?.message ?? 'unknown',
    };
    console.error('[bootstrap] skin step failed', { wallet: stored, err });
  }

  // 3. Starter mod - same shape as skin.
  try {
    const [existingMod] = await db
      .select({ id: mods.id, tokenId: mods.tokenId })
      .from(mods)
      .where(eq(mods.userId, userId))
      .limit(1);
    if (existingMod && existingMod.tokenId != null) {
      result.mod = { status: 'already', tokenId: existingMod.tokenId };
    } else if (!droneEnv.privateKey || !droneEnv.rpcUrl || !droneEnv.modAddress) {
      result.mod = { status: 'failed', reason: 'env not configured' };
    } else {
      let modRow = existingMod ?? null;
      if (!modRow) {
        modRow = await cloneStarterMod(userId);
      }
      if (!modRow) {
        result.mod = { status: 'failed', reason: 'common mod vault empty' };
      } else {
        const mint = await mintViaCounter({
          contractKey: 'mod',
          contractAddress: droneEnv.modAddress,
          walletAddress: checksummed,
          rpcUrl: droneEnv.rpcUrl,
          privateKey: droneEnv.privateKey,
        });
        await db
          .update(mods)
          .set({
            tokenId: mint.tokenId,
            mintTxHash: mint.txHash,
            mintedAt: new Date(),
          })
          .where(eq(mods.id, modRow.id));
        result.mod = { status: 'minted', tokenId: mint.tokenId, txHash: mint.txHash };
        console.log(
          `[bootstrap] mod mint ok modId=${modRow.id} tokenId=${mint.tokenId} tx=${mint.txHash}`,
        );
      }
    }
  } catch (err) {
    result.mod = {
      status: 'failed',
      reason: err?.shortMessage ?? err?.message ?? 'unknown',
    };
    console.error('[bootstrap] mod step failed', { wallet: stored, err });
  }

  // 4. Starter VOLT - 1000 to the player wallet. Idempotent via
  //    users.starter_volt_minted_at.
  try {
    if (user.starterVoltMintedAt) {
      result.volt = { status: 'already' };
    } else {
      const mint = await mintVoltToWallet(checksummed, STARTER_VOLTS);
      if (!mint?.txHash) {
        result.volt = { status: 'failed', reason: 'env not configured or mint returned null' };
      } else {
        await db
          .update(users)
          .set({ starterVoltMintedAt: new Date() })
          .where(eq(users.id, userId));
        result.volt = { status: 'minted', txHash: mint.txHash };
        console.log(`[bootstrap] starter VOLT mint ok tx=${mint.txHash} wallet=${stored}`);
      }
    }
  } catch (err) {
    result.volt = {
      status: 'failed',
      reason: err?.shortMessage ?? err?.message ?? 'unknown',
    };
    console.error('[bootstrap] starter VOLT mint failed', { wallet: stored, err });
  }

  // 5. Gas drip - 0.001 ETH so the user can pay for their own
  //    user-signed marketplace buys. Idempotent via users.starter_gas_sent_at.
  try {
    if (user.starterGasSentAt) {
      result.gas = { status: 'already' };
    } else {
      const gas = await sendStarterGas(checksummed);
      if (!gas?.txHash) {
        result.gas = { status: 'failed', reason: 'env not configured or transfer returned null' };
      } else {
        await db
          .update(users)
          .set({ starterGasSentAt: new Date() })
          .where(eq(users.id, userId));
        result.gas = { status: 'sent', txHash: gas.txHash };
        console.log(`[bootstrap] starter gas drop ok tx=${gas.txHash} wallet=${stored}`);
      }
    }
  } catch (err) {
    result.gas = {
      status: 'failed',
      reason: err?.shortMessage ?? err?.message ?? 'unknown',
    };
    console.error('[bootstrap] starter gas drop failed', { wallet: stored, err });
  }

  return ok({ ...result });
});
