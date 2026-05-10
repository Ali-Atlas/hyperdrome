/**
 * Server-side helper for HyperdromeSettlement.settleEpoch.
 *
 * Called once per cron tick after Phase 2 finishes executing pending
 * races. The cron orchestrator collects per-race results into a
 * SettlementResult[] (each row sources from the same race the engine
 * just resolved) and submits one batched on-chain tx.
 *
 * Settlement requires the deployer to have authorized this contract as
 * a VOLT minter (`HyperdromeVOLT.setMinter(<settlement>, true)`); see
 * deploy-settlement.js.
 */

import { ethers } from 'ethers';

const SETTLEMENT_ABI = [
  'function settleEpoch(uint256 epochId, tuple(uint256 droneATokenId,uint256 droneBTokenId,uint256 winnerTokenId,int16 eloDeltaA,int16 eloDeltaB,uint256 voltRewardA,uint256 voltRewardB)[] results) external',
];

function readEnv() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const rpcUrl = process.env.MEGAETH_RPC_URL;
  const settlementAddress = process.env.SETTLEMENT_CONTRACT_ADDRESS;
  const missing = [];
  if (!privateKey) missing.push('DEPLOYER_PRIVATE_KEY');
  if (!rpcUrl) missing.push('MEGAETH_RPC_URL');
  if (!settlementAddress) missing.push('SETTLEMENT_CONTRACT_ADDRESS');
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, privateKey, rpcUrl, settlementAddress };
}

/**
 * VOLT prices throughout the app are integer "volts"; the ERC-20 holds
 * 18 decimals. Mirror lib/onchain/marketplace.js#voltsToWei.
 */
function voltsToWei(volts) {
  return ethers.parseUnits(String(volts), 18);
}

/**
 * Submit a batched epoch settlement. Returns the tx hash and the count
 * of results actually submitted on-chain. Returns null when the helper
 * is not configured (no settlement address, or no eligible races) so
 * the caller can no-op gracefully.
 *
 * @param {object} args
 * @param {number} args.epochId - monotonic integer per cron tick (the
 *   contract rejects re-submission of the same epochId).
 * @param {Array<{
 *   droneATokenId: number,
 *   droneBTokenId: number,
 *   winnerTokenId: number,
 *   eloDeltaA: number,
 *   eloDeltaB: number,
 *   voltRewardA: number,
 *   voltRewardB: number,
 * }>} args.results - off-chain race results, all in app units. eloDelta
 *   is a small signed int (typically -32..+32); voltReward is integer
 *   "volts" which the helper converts to 18-decimal wei.
 */
export async function settleEpochOnchain({ epochId, results }) {
  const env = readEnv();
  if (!env.ok) {
    console.warn(
      '[settlement] skipping on-chain settleEpoch - missing env: ' +
        env.missing.join(', '),
    );
    return null;
  }
  if (!Array.isArray(results) || results.length === 0) return null;

  const provider = new ethers.JsonRpcProvider(env.rpcUrl);
  const wallet = new ethers.Wallet(env.privateKey, provider);
  const settlement = new ethers.Contract(env.settlementAddress, SETTLEMENT_ABI, wallet);

  // Tuple-encode each result. ethers v6 accepts arrays-of-arrays for
  // structs in this order; field ordering must match the Solidity
  // declaration in HyperdromeSettlement.sol.
  const encoded = results.map((r) => [
    BigInt(r.droneATokenId),
    BigInt(r.droneBTokenId),
    BigInt(r.winnerTokenId),
    r.eloDeltaA,
    r.eloDeltaB,
    voltsToWei(r.voltRewardA),
    voltsToWei(r.voltRewardB),
  ]);

  const tx = await settlement.settleEpoch(BigInt(epochId), encoded);
  const receipt = await tx.wait();
  return { txHash: receipt?.hash ?? tx.hash, count: results.length };
}
