/**
 * Batch-mint every drone that does not yet have an on-chain tokenId.
 *
 *   node --env-file=.env.local scripts/batch-mint-drones.js
 *
 * Mints to the deployer wallet (the same key that owns HyperdromeDrone).
 * Demo / bot drones don't have player wallets, so the deployer is the
 * uniform recipient. Future per-user-wallet mints continue to flow through
 * `app/api/drones/[droneId]/mint/route.js`.
 *
 * Per-drone failures log and continue - one bad mint must not abort the
 * remaining batch. A 200ms gap between mints keeps the Carrot RPC happy
 * under sustained load.
 *
 * Tx ordering: ethers v6 reads the deployer's nonce from the node before
 * each `contract.mint(...)` call and queues sequentially because we
 * `await` each tx end-to-end. tokenId is computed once at script start
 * and incremented in JS - no concurrent mints from another process should
 * run while this script is in flight (the contract's _safeMint would
 * revert on collision, which the per-drone catch handles cleanly).
 */

import { ethers } from 'ethers';
import { eq, isNull, sql } from 'drizzle-orm';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '../lib/db/schema.js';

const { drones } = schema;

const HYPERDROME_DRONE_ABI = [
  'function mint(address to, uint256 tokenId) external',
];

const THROTTLE_MS = 200;

function readEnv() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const contractAddress =
    process.env.NEXT_PUBLIC_DRONE_CONTRACT_ADDRESS ??
    process.env.DRONE_CONTRACT_ADDRESS;
  const rpcUrl = process.env.MEGAETH_RPC_URL;
  const databaseUrl = process.env.DATABASE_URL;
  const missing = [];
  if (!privateKey) missing.push('DEPLOYER_PRIVATE_KEY');
  if (!contractAddress) missing.push('NEXT_PUBLIC_DRONE_CONTRACT_ADDRESS');
  if (!rpcUrl) missing.push('MEGAETH_RPC_URL');
  if (!databaseUrl) missing.push('DATABASE_URL');
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    console.error('Run via: node --env-file=.env.local scripts/batch-mint-drones.js');
    process.exit(1);
  }
  return { privateKey, contractAddress, rpcUrl, databaseUrl };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const env = readEnv();

  const db = drizzle(neon(env.databaseUrl), { schema });

  const provider = new ethers.JsonRpcProvider(env.rpcUrl);
  const wallet = new ethers.Wallet(env.privateKey, provider);
  const deployerAddress = await wallet.getAddress();
  const contract = new ethers.Contract(env.contractAddress, HYPERDROME_DRONE_ABI, wallet);

  // Sanity: contract is reachable + we're on the expected chain.
  const network = await provider.getNetwork();
  console.log(`[batch-mint-drones] chain id ${network.chainId}, deployer ${deployerAddress}`);
  console.log(`[batch-mint-drones] contract ${env.contractAddress}`);

  // Drones missing a tokenId - fetch in stable order so a re-run after
  // partial failure picks up where we left off.
  const pending = await db
    .select({ id: drones.id, name: drones.name })
    .from(drones)
    .where(isNull(drones.tokenId))
    .orderBy(drones.createdAt);

  if (pending.length === 0) {
    console.log('[batch-mint-drones] nothing to mint - all drones have a tokenId');
    return;
  }

  // Seed nextTokenId from current MAX so concurrent app mints (if any
  // happen during the run) collide on the contract side, not silently.
  const [agg] = await db
    .select({ maxId: sql`COALESCE(MAX(${drones.tokenId}), 0)` })
    .from(drones);
  let nextTokenId = Number(agg?.maxId ?? 0) + 1;

  console.log(`[batch-mint-drones] ${pending.length} drone(s) to mint, starting at tokenId ${nextTokenId}`);

  let minted = 0;
  let failed = 0;
  const failures = [];

  for (let i = 0; i < pending.length; i++) {
    const drone = pending[i];
    const tokenId = nextTokenId;
    const label = `[${i + 1}/${pending.length}] drone ${drone.id} ("${drone.name}") tokenId ${tokenId}`;

    try {
      const tx = await contract.mint(deployerAddress, tokenId);
      const receipt = await tx.wait();
      const txHash = receipt?.hash ?? tx.hash;

      await db
        .update(drones)
        .set({ tokenId, mintTxHash: txHash, mintedAt: new Date() })
        .where(eq(drones.id, drone.id));

      console.log(`${label} OK  tx=${txHash}`);
      minted++;
      nextTokenId++;
    } catch (err) {
      const reason = err?.shortMessage ?? err?.message ?? 'unknown';
      console.error(`${label} FAIL ${reason}`);
      failures.push({ id: drone.id, name: drone.name, tokenId, reason });
      failed++;
      // Don't advance nextTokenId on failure - the contract didn't claim
      // this id, so the next drone can re-use it. Avoids silent gaps in
      // the on-chain id sequence.
    }

    if (i < pending.length - 1) await sleep(THROTTLE_MS);
  }

  console.log('');
  console.log('[batch-mint-drones] summary');
  console.log(`  attempted : ${pending.length}`);
  console.log(`  minted    : ${minted}`);
  console.log(`  failed    : ${failed}`);
  if (failures.length) {
    console.log('  failures  :');
    for (const f of failures) {
      console.log(`    - ${f.id} ("${f.name}") tokenId=${f.tokenId} reason=${f.reason}`);
    }
  }
}

main().catch((err) => {
  console.error('[batch-mint-drones] fatal', err);
  process.exit(1);
});
