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
 * tokenId allocation: claims from `token_counters` (lib/onchain/token-id.js)
 * shared with the auth/wallet endpoint and the other batch scripts. One DB
 * read + one mint + one DB write per drone - no upfront probe, no per-row
 * `ownerOf` call. On a collision the script bumps the counter and retries
 * once; a second collision aborts the batch (the counter is materially
 * out of sync and an operator should reset it before re-running).
 *
 * Per-drone failures log and continue. 200ms gap between mints keeps the
 * Carrot RPC happy under sustained load.
 */

import { ethers } from 'ethers';
import { eq, isNull } from 'drizzle-orm';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '../lib/db/schema.js';
import { claimNextTokenId, bumpAndClaim } from '../lib/onchain/token-id.js';

const { drones } = schema;

const HYPERDROME_DRONE_ABI = [
  'function mint(address to, uint256 tokenId) external',
];

const THROTTLE_MS = 200;

// `--prod` switches the DB connection to PROD_DATABASE_URL while leaving
// the chain-side env (private key, contract address, RPC URL) untouched.
// Same chain in both modes, just a different DB the script reads from /
// writes back to.
const IS_PROD = process.argv.includes('--prod');

function readEnv() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const contractAddress =
    process.env.NEXT_PUBLIC_DRONE_CONTRACT_ADDRESS ??
    process.env.DRONE_CONTRACT_ADDRESS;
  const rpcUrl = process.env.MEGAETH_RPC_URL;
  const dbVar = IS_PROD ? 'PROD_DATABASE_URL' : 'DATABASE_URL';
  const databaseUrl = process.env[dbVar];
  const missing = [];
  if (!privateKey) missing.push('DEPLOYER_PRIVATE_KEY');
  if (!contractAddress) missing.push('NEXT_PUBLIC_DRONE_CONTRACT_ADDRESS');
  if (!rpcUrl) missing.push('MEGAETH_RPC_URL');
  if (!databaseUrl) missing.push(dbVar);
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    console.error(
      `Run via: node --env-file=.env.local scripts/batch-mint-drones.js${IS_PROD ? ' --prod' : ''}`,
    );
    process.exit(1);
  }
  return { privateKey, contractAddress, rpcUrl, databaseUrl, dbVar };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isAlreadyMintedError(err) {
  const msg = (err?.shortMessage ?? err?.reason ?? err?.message ?? '').toLowerCase();
  return msg.includes('already minted') || msg.includes('token already exists');
}

async function main() {
  const env = readEnv();

  const db = drizzle(neon(env.databaseUrl), { schema });

  const provider = new ethers.JsonRpcProvider(env.rpcUrl);
  const wallet = new ethers.Wallet(env.privateKey, provider);
  const deployerAddress = await wallet.getAddress();
  const contract = new ethers.Contract(env.contractAddress, HYPERDROME_DRONE_ABI, wallet);

  const network = await provider.getNetwork();
  console.log(`[batch-mint-drones] db=${env.dbVar} chain=${network.chainId} deployer=${deployerAddress}`);
  console.log(`[batch-mint-drones] contract ${env.contractAddress}`);

  const pending = await db
    .select({ id: drones.id, name: drones.name })
    .from(drones)
    .where(isNull(drones.tokenId))
    .orderBy(drones.createdAt);

  if (pending.length === 0) {
    console.log('[batch-mint-drones] nothing to mint - all drones have a tokenId');
    return;
  }

  console.log(`[batch-mint-drones] ${pending.length} drone(s) pending`);

  let minted = 0;
  let failed = 0;
  let abortedAfter = null;
  const failures = [];

  outer: for (let i = 0; i < pending.length; i++) {
    const drone = pending[i];
    let tokenId = await claimNextTokenId('drone', db);
    let attempts = 0;
    while (true) {
      attempts++;
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
        break;
      } catch (err) {
        if (isAlreadyMintedError(err) && attempts === 1) {
          console.warn(`${label} collided; bumping counter and retrying once`);
          tokenId = await bumpAndClaim('drone', tokenId, db);
          continue;
        }
        const reason = err?.shortMessage ?? err?.message ?? 'unknown';
        console.error(`${label} FAIL ${reason}`);
        failures.push({ id: drone.id, name: drone.name, tokenId, reason });
        failed++;
        // Two consecutive collisions mean the counter is materially
        // out of sync (chain supply is well ahead of the DB). Abort
        // rather than burn through every remaining row and rack up
        // gas. Operator should reset the counter and re-run.
        if (isAlreadyMintedError(err)) {
          console.error(
            '[batch-mint-drones] aborting: token_counters.drone is out of sync with on-chain supply. Reset the counter to chain MAX(tokenId)+1 and re-run.',
          );
          abortedAfter = i + 1;
          break outer;
        }
        break;
      }
    }
    if (i < pending.length - 1) await sleep(THROTTLE_MS);
  }

  console.log('');
  console.log('[batch-mint-drones] summary');
  console.log(`  attempted  : ${abortedAfter ?? pending.length}`);
  console.log(`  minted     : ${minted}`);
  console.log(`  failed     : ${failed}`);
  if (abortedAfter != null) {
    console.log(`  aborted    : after row ${abortedAfter} (counter out of sync)`);
  }
  if (failures.length) {
    console.log('  failures   :');
    for (const f of failures) {
      console.log(`    - ${f.id} ("${f.name}") tokenId=${f.tokenId} reason=${f.reason}`);
    }
  }
}

main().catch((err) => {
  console.error('[batch-mint-drones] fatal', err);
  process.exit(1);
});
