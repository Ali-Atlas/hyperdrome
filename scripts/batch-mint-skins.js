/**
 * Batch-mint every skin that does not yet have an on-chain tokenId.
 *
 *   node --env-file=.env.local scripts/batch-mint-skins.js
 *
 * Mirrors scripts/batch-mint-drones.js exactly, swapping the target
 * contract (HyperdromeSkin) and table (skins). Mints to the deployer
 * wallet because the existing skin pool spans demo/seeded users without
 * linked wallets.
 */

import { ethers } from 'ethers';
import { eq, isNull, sql } from 'drizzle-orm';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '../lib/db/schema.js';

const { skins } = schema;

const HYPERDROME_SKIN_ABI = [
  'function mint(address to, uint256 tokenId) external',
];

const THROTTLE_MS = 200;

function readEnv() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const contractAddress = process.env.SKIN_CONTRACT_ADDRESS;
  const rpcUrl = process.env.MEGAETH_RPC_URL;
  const databaseUrl = process.env.DATABASE_URL;
  const missing = [];
  if (!privateKey) missing.push('DEPLOYER_PRIVATE_KEY');
  if (!contractAddress) missing.push('SKIN_CONTRACT_ADDRESS');
  if (!rpcUrl) missing.push('MEGAETH_RPC_URL');
  if (!databaseUrl) missing.push('DATABASE_URL');
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    console.error('Run via: node --env-file=.env.local scripts/batch-mint-skins.js');
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
  const contract = new ethers.Contract(env.contractAddress, HYPERDROME_SKIN_ABI, wallet);

  const network = await provider.getNetwork();
  console.log(`[batch-mint-skins] chain id ${network.chainId}, deployer ${deployerAddress}`);
  console.log(`[batch-mint-skins] contract ${env.contractAddress}`);

  const pending = await db
    .select({ id: skins.id, name: skins.name })
    .from(skins)
    .where(isNull(skins.tokenId))
    .orderBy(skins.createdAt);

  if (pending.length === 0) {
    console.log('[batch-mint-skins] nothing to mint - all skins have a tokenId');
    return;
  }

  const [agg] = await db
    .select({ maxId: sql`COALESCE(MAX(${skins.tokenId}), 0)` })
    .from(skins);
  let nextTokenId = Number(agg?.maxId ?? 0) + 1;

  console.log(`[batch-mint-skins] ${pending.length} skin(s) to mint, starting at tokenId ${nextTokenId}`);

  let minted = 0;
  let failed = 0;
  const failures = [];

  for (let i = 0; i < pending.length; i++) {
    const skin = pending[i];
    const tokenId = nextTokenId;
    const label = `[${i + 1}/${pending.length}] skin ${skin.id} ("${skin.name}") tokenId ${tokenId}`;

    try {
      const tx = await contract.mint(deployerAddress, tokenId);
      const receipt = await tx.wait();
      const txHash = receipt?.hash ?? tx.hash;

      await db
        .update(skins)
        .set({ tokenId, mintTxHash: txHash, mintedAt: new Date() })
        .where(eq(skins.id, skin.id));

      console.log(`${label} OK  tx=${txHash}`);
      minted++;
      nextTokenId++;
    } catch (err) {
      const reason = err?.shortMessage ?? err?.message ?? 'unknown';
      console.error(`${label} FAIL ${reason}`);
      failures.push({ id: skin.id, name: skin.name, tokenId, reason });
      failed++;
    }

    if (i < pending.length - 1) await sleep(THROTTLE_MS);
  }

  console.log('');
  console.log('[batch-mint-skins] summary');
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
  console.error('[batch-mint-skins] fatal', err);
  process.exit(1);
});
