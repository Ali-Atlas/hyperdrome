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
  'function ownerOf(uint256 tokenId) view returns (address)',
];

const THROTTLE_MS = 200;
// Hard cap on the initial probe walk so a corrupt RPC can't burn unlimited
// calls. 10k tokens is comfortably above any realistic on-chain supply on
// testnet for a single batch script.
const PROBE_MAX = 10_000;

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

/**
 * ownerOf reverts on a non-existent tokenId per the ERC-721 spec; ethers
 * v6 throws CALL_EXCEPTION which we collapse to "false". Any other error
 * also surfaces as "false" - the worst case is the per-row defensive
 * check then mints and the contract's own _safeMint reverts the dup,
 * which we catch and log as a normal mint failure.
 */
async function tokenExists(contract, tokenId) {
  try {
    await contract.ownerOf(tokenId);
    return true;
  } catch {
    return false;
  }
}

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

  // Seed nextTokenId from current MAX. The probe below reconciles this
  // with the on-chain truth in case a previous run minted but failed to
  // write the DB row (the only path we know of that creates orphans).
  const [agg] = await db
    .select({ maxId: sql`COALESCE(MAX(${skins.tokenId}), 0)` })
    .from(skins);
  let nextTokenId = Number(agg?.maxId ?? 0) + 1;

  // Probe upward from the DB-derived starting tokenId until ownerOf
  // reverts. Anything below the first revert was minted on-chain in a
  // previous (interrupted) run; the iteration loop recovers those into
  // pending DB rows in createdAt order rather than re-minting.
  console.log(`[batch-mint-skins] probing on-chain from tokenId ${nextTokenId}...`);
  let onchainHighest = nextTokenId - 1;
  {
    let probeId = nextTokenId;
    while (await tokenExists(contract, probeId)) {
      onchainHighest = probeId;
      probeId++;
      if (probeId - nextTokenId > PROBE_MAX) {
        throw new Error(
          `probe overran ${PROBE_MAX} tokens above ${nextTokenId}; aborting to avoid runaway RPC calls`,
        );
      }
    }
  }
  const orphans = onchainHighest >= nextTokenId ? onchainHighest - nextTokenId + 1 : 0;
  if (orphans > 0) {
    console.log(
      `[batch-mint-skins] found ${orphans} on-chain orphan(s) at tokenIds ${nextTokenId}..${onchainHighest}; will recover into DB rows in createdAt order`,
    );
  } else {
    console.log(`[batch-mint-skins] no orphans; on-chain and DB are in sync at tokenId ${onchainHighest}`);
  }
  console.log(`[batch-mint-skins] ${pending.length} skin(s) pending; fresh mints start at tokenId ${onchainHighest + 1}`);

  let minted = 0;
  let recovered = 0;
  let failed = 0;
  const failures = [];

  for (let i = 0; i < pending.length; i++) {
    const skin = pending[i];
    const tokenId = nextTokenId;
    const label = `[${i + 1}/${pending.length}] skin ${skin.id} ("${skin.name}") tokenId ${tokenId}`;

    // Recovery branch: tokenId is in the orphan range identified by the
    // probe (or, defensively, became taken between probe and now).
    let alreadyOnchain = tokenId <= onchainHighest;
    if (!alreadyOnchain) {
      // Belt-and-suspenders re-check before fresh mints. Cheap (one
      // ownerOf call) compared to a wasted mint that reverts on dup.
      alreadyOnchain = await tokenExists(contract, tokenId);
      if (alreadyOnchain) {
        // Extend the orphan range so subsequent rows pick up this token
        // without paying for the same defensive check.
        onchainHighest = tokenId;
      }
    }

    if (alreadyOnchain) {
      try {
        await db
          .update(skins)
          .set({ tokenId, mintTxHash: 'recovered', mintedAt: new Date() })
          .where(eq(skins.id, skin.id));
        console.log(`${label} RECOVERED (already minted on-chain)`);
        recovered++;
        nextTokenId++;
      } catch (err) {
        const reason = err?.shortMessage ?? err?.message ?? 'unknown';
        console.error(`${label} FAIL (recovery) ${reason}`);
        failures.push({ id: skin.id, name: skin.name, tokenId, reason });
        failed++;
      }
      if (i < pending.length - 1) await sleep(THROTTLE_MS);
      continue;
    }

    // Fresh mint path.
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
  console.log(`  attempted  : ${pending.length}`);
  console.log(`  minted     : ${minted}`);
  console.log(`  recovered  : ${recovered}`);
  console.log(`  failed     : ${failed}`);
  if (failures.length) {
    console.log('  failures   :');
    for (const f of failures) {
      console.log(`    - ${f.id} ("${f.name}") tokenId=${f.tokenId} reason=${f.reason}`);
    }
  }
}

main().catch((err) => {
  console.error('[batch-mint-skins] fatal', err);
  process.exit(1);
});
