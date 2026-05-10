/**
 * Batch-mint every mod that does not yet have an on-chain tokenId.
 *
 *   node --env-file=.env.local scripts/batch-mint-mods.js
 *
 * Mirrors scripts/batch-mint-drones.js / batch-mint-skins.js: counter-based
 * tokenId allocation via the shared lib/onchain/token-id.js helper.
 */

import { ethers } from 'ethers';
import { eq, isNull } from 'drizzle-orm';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '../lib/db/schema.js';
import { claimNextTokenId, bumpAndClaim } from '../lib/onchain/token-id.js';

const { mods } = schema;

const HYPERDROME_MOD_ABI = [
  'function mint(address to, uint256 tokenId) external',
];

const THROTTLE_MS = 200;

const IS_PROD = process.argv.includes('--prod');

function readEnv() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const contractAddress = process.env.MOD_CONTRACT_ADDRESS;
  const rpcUrl = process.env.MEGAETH_RPC_URL;
  const dbVar = IS_PROD ? 'PROD_DATABASE_URL' : 'DATABASE_URL';
  const databaseUrl = process.env[dbVar];
  const missing = [];
  if (!privateKey) missing.push('DEPLOYER_PRIVATE_KEY');
  if (!contractAddress) missing.push('MOD_CONTRACT_ADDRESS');
  if (!rpcUrl) missing.push('MEGAETH_RPC_URL');
  if (!databaseUrl) missing.push(dbVar);
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    console.error(
      `Run via: node --env-file=.env.local scripts/batch-mint-mods.js${IS_PROD ? ' --prod' : ''}`,
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
  const contract = new ethers.Contract(env.contractAddress, HYPERDROME_MOD_ABI, wallet);

  const network = await provider.getNetwork();
  console.log(`[batch-mint-mods] db=${env.dbVar} chain=${network.chainId} deployer=${deployerAddress}`);
  console.log(`[batch-mint-mods] contract ${env.contractAddress}`);

  const pending = await db
    .select({ id: mods.id, name: mods.name })
    .from(mods)
    .where(isNull(mods.tokenId))
    .orderBy(mods.createdAt);

  if (pending.length === 0) {
    console.log('[batch-mint-mods] nothing to mint - all mods have a tokenId');
    return;
  }

  console.log(`[batch-mint-mods] ${pending.length} mod(s) pending`);

  let minted = 0;
  let failed = 0;
  let abortedAfter = null;
  const failures = [];

  outer: for (let i = 0; i < pending.length; i++) {
    const mod = pending[i];
    let tokenId = await claimNextTokenId('mod', db);
    let attempts = 0;
    while (true) {
      attempts++;
      const label = `[${i + 1}/${pending.length}] mod ${mod.id} ("${mod.name}") tokenId ${tokenId}`;
      try {
        const tx = await contract.mint(deployerAddress, tokenId);
        const receipt = await tx.wait();
        const txHash = receipt?.hash ?? tx.hash;
        await db
          .update(mods)
          .set({ tokenId, mintTxHash: txHash, mintedAt: new Date() })
          .where(eq(mods.id, mod.id));
        console.log(`${label} OK  tx=${txHash}`);
        minted++;
        break;
      } catch (err) {
        if (isAlreadyMintedError(err) && attempts === 1) {
          console.warn(`${label} collided; bumping counter and retrying once`);
          tokenId = await bumpAndClaim('mod', tokenId, db);
          continue;
        }
        const reason = err?.shortMessage ?? err?.message ?? 'unknown';
        console.error(`${label} FAIL ${reason}`);
        failures.push({ id: mod.id, name: mod.name, tokenId, reason });
        failed++;
        if (isAlreadyMintedError(err)) {
          console.error(
            '[batch-mint-mods] aborting: token_counters.mod is out of sync with on-chain supply. Reset the counter and re-run.',
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
  console.log('[batch-mint-mods] summary');
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
  console.error('[batch-mint-mods] fatal', err);
  process.exit(1);
});
