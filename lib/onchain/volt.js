/**
 * Server-side helpers for direct HyperdromeVOLT mint / burn calls (the
 * deployer signs as VOLT owner, no role grant needed). Used by the
 * stat-upgrade flow today; race settlement and packs go through their
 * own helpers because their burns / mints are scoped to those contracts.
 */

import { ethers } from 'ethers';

const VOLT_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function mint(address to, uint256 amount) external',
  'function burn(address from, uint256 amount) external',
];

function readEnv() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const rpcUrl = process.env.MEGAETH_RPC_URL;
  const voltAddress = process.env.VOLT_CONTRACT_ADDRESS;
  if (!privateKey || !rpcUrl || !voltAddress) {
    return { ok: false };
  }
  return { ok: true, privateKey, rpcUrl, voltAddress };
}

function voltsToWei(volts) {
  return ethers.parseUnits(String(volts), 18);
}

/**
 * Burn `volts` worth of VOLT from `walletAddress`. Returns null when the
 * helper isn't configured (so callers can no-op on stat upgrades for
 * users without a linked wallet). Throws on RPC / contract errors so
 * the caller can reject the upgrade per Captain's spec.
 *
 * @returns {Promise<null | { txHash: string }>}
 */
export async function burnVoltFromWallet(walletAddress, volts) {
  if (!walletAddress) return null;
  if (volts <= 0) return null;

  const env = readEnv();
  if (!env.ok) return null;

  const provider = new ethers.JsonRpcProvider(env.rpcUrl);
  const wallet = new ethers.Wallet(env.privateKey, provider);
  const volt = new ethers.Contract(env.voltAddress, VOLT_ABI, wallet);

  const tx = await volt.burn(walletAddress, voltsToWei(volts));
  const receipt = await tx.wait();
  return { txHash: receipt?.hash ?? tx.hash };
}
