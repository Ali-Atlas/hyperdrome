/**
 * Server-side helper to drip a fixed amount of MegaETH-testnet ETH to a
 * brand-new user's wallet so they can pay gas on their own (user-signed)
 * VOLT approvals + marketplace buys. Called once during the wallet
 * sign-up flow in /api/auth/wallet — best-effort, never fail the auth on
 * a gas-drip failure.
 *
 * Source wallet: the deployer (DEPLOYER_PRIVATE_KEY). Same key that mints
 * the starter NFT + VOLT, so a single configured signer covers all three
 * server-side bootstraps for a new user.
 *
 * Amount: 0.001 ETH (Captain's spec). Enough on MegaETH testnet for many
 * tx (a buy + approve costs well under 0.0005 at typical gas), but small
 * enough that an attacker can't drain the deployer by spinning up wallets
 * — the wallet-auth flow is gated on a successful unique-wallet insert
 * upstream so a re-auth of the same address is a no-op.
 */

import { ethers } from 'ethers';

/**
 * Wei amount of ETH to drip to a new user. ethers.parseEther accepts
 * the decimal string and returns a bigint (ethers v6).
 */
const STARTER_GAS_WEI = ethers.parseEther('0.001');

function readEnv() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const rpcUrl = process.env.MEGAETH_RPC_URL;
  if (!privateKey || !rpcUrl) return { ok: false };
  return { ok: true, privateKey, rpcUrl };
}

/**
 * Send 0.001 ETH from the deployer wallet to `walletAddress`. Returns
 * `{ txHash }` on success, `null` when the helper isn't configured (so
 * the caller can degrade gracefully on a testnet without env vars set)
 * or when given a falsy wallet. Throws on RPC / signing errors so the
 * caller can log a real failure, distinct from "not configured".
 *
 * @returns {Promise<null | { txHash: string }>}
 */
export async function sendStarterGas(walletAddress) {
  if (!walletAddress) return null;

  const env = readEnv();
  if (!env.ok) return null;

  const provider = new ethers.JsonRpcProvider(env.rpcUrl);
  const wallet = new ethers.Wallet(env.privateKey, provider);

  const tx = await wallet.sendTransaction({
    to: walletAddress,
    value: STARTER_GAS_WEI,
  });
  const receipt = await tx.wait();
  return { txHash: receipt?.hash ?? tx.hash };
}
