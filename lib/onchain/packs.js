/**
 * Server-side pack purchase orchestrator. Implements the commit-reveal
 * flow against HyperdromePacks: the server generates a seed BEFORE
 * deciding which NFTs the buyer receives, commits a hash on-chain, then
 * reveals + mints in a follow-on tx. On testnet the deployer signs
 * both txs; the commit precedes the off-chain content roll, which
 * prevents the server from biasing outcomes based on the buyer.
 *
 * Pack content selection here is intentionally minimal (default skin /
 * mod templates per tier). It is independent of the rich
 * services/pack.service.js#openPack flow, which remains the legacy
 * DB-only path. A future migration can fold openPack onto this seeded
 * roll once Captain authorizes that refactor.
 */

import { ethers } from 'ethers';
import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { ApiError } from '@/lib/api/response.js';

const { skins, mods, packPurchases, users } = schema;

const PACKS_ABI = [
  'function nextPackId() view returns (uint256)',
  'function commitPack(bytes32 commitHash, uint8 tier) external returns (uint256)',
  'function revealAndMint(uint256 packId, bytes32 seed, address buyer, address[] nftContracts, uint256[] tokenIds) external',
  'event PackCommitted(uint256 indexed packId, uint8 indexed tier, bytes32 commitHash)',
];

/** App tier name -> on-chain uint8 tier id. */
const TIER_ID = {
  starter: 0,
  premium: 1,
  legendary: 2,
};

/**
 * Default content profile per tier. The seed maps to specific templates
 * via deterministic indexing; a richer pack engine slots in here later.
 */
const PACK_TEMPLATES = {
  starter: [{ kind: 'skin', rarity: 'common' }],
  premium: [
    { kind: 'skin', rarity: 'rare' },
    { kind: 'mod', rarity: 'rare' },
  ],
  legendary: [
    { kind: 'skin', rarity: 'legendary' },
    { kind: 'mod', rarity: 'epic' },
  ],
};

function readEnv() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const rpcUrl = process.env.MEGAETH_RPC_URL;
  const packsAddress = process.env.PACKS_CONTRACT_ADDRESS;
  const skinAddress = process.env.SKIN_CONTRACT_ADDRESS;
  const modAddress = process.env.MOD_CONTRACT_ADDRESS;
  const missing = [];
  if (!privateKey) missing.push('DEPLOYER_PRIVATE_KEY');
  if (!rpcUrl) missing.push('MEGAETH_RPC_URL');
  if (!packsAddress) missing.push('PACKS_CONTRACT_ADDRESS');
  if (!skinAddress) missing.push('SKIN_CONTRACT_ADDRESS');
  if (!modAddress) missing.push('MOD_CONTRACT_ADDRESS');
  if (missing.length) {
    throw new ApiError(
      `Server is missing on-chain pack config: ${missing.join(', ')}`,
      500,
    );
  }
  return { privateKey, rpcUrl, packsAddress, skinAddress, modAddress };
}

/**
 * Allocate the next tokenId for a table. Mirrors the batch-mint scripts'
 * `COALESCE(MAX(token_id), 0) + 1` pattern but lets the caller reserve
 * multiple ids in sequence (offset bumps it forward N).
 */
async function nextTokenId(table, offset = 0) {
  const [agg] = await db
    .select({ maxId: sql`COALESCE(MAX(${table.tokenId}), 0)` })
    .from(table);
  return Number(agg?.maxId ?? 0) + 1 + offset;
}

/**
 * Buy a pack on-chain via commit-reveal. Returns details for the route
 * to surface to the caller and persist in pack_purchases.
 *
 * @param {object} args
 * @param {string} args.userId - app user id (for DB row ownership)
 * @param {string} args.buyerAddress - on-chain recipient (the user's wallet)
 * @param {'starter'|'premium'|'legendary'} args.packTier
 */
export async function buyPackOnchain({ userId, buyerAddress, packTier }) {
  const tierId = TIER_ID[packTier];
  if (tierId === undefined) {
    throw new ApiError(`Unknown pack tier: ${packTier}`, 400);
  }
  const template = PACK_TEMPLATES[packTier];
  if (!template) {
    throw new ApiError(`No template for pack tier: ${packTier}`, 400);
  }

  const env = readEnv();
  const provider = new ethers.JsonRpcProvider(env.rpcUrl);
  const wallet = new ethers.Wallet(env.privateKey, provider);
  const packs = new ethers.Contract(env.packsAddress, PACKS_ABI, wallet);

  // Read packId from the contract before computing the commit hash. Only
  // the deployer can commit (onlyOwner), and we await each tx, so the
  // packId we read is the one the contract will use.
  const packId = await packs.nextPackId();

  // 32-byte seed. Cryptographically random; never returned pre-reveal.
  const seedBytes = randomBytes(32);
  const seedHex = `0x${seedBytes.toString('hex')}`;

  // commitHash = keccak256(abi.encodePacked(seed, packId))
  const packed = ethers.solidityPacked(['bytes32', 'uint256'], [seedHex, packId]);
  const commitHash = ethers.keccak256(packed);

  // Pre-allocate tokenIds for each item so revealAndMint can mint them
  // directly. Each table needs its own MAX query; offset within the
  // template handles multiple items targeting the same table.
  const skinSlots = template.filter((t) => t.kind === 'skin').length;
  const modSlots = template.filter((t) => t.kind === 'mod').length;
  const skinBaseId = skinSlots > 0 ? await nextTokenId(skins) : 0;
  const modBaseId = modSlots > 0 ? await nextTokenId(mods) : 0;

  const items = [];
  let skinIdx = 0;
  let modIdx = 0;
  for (const slot of template) {
    if (slot.kind === 'skin') {
      items.push({
        kind: 'skin',
        rarity: slot.rarity,
        nftContract: env.skinAddress,
        tokenId: skinBaseId + skinIdx,
      });
      skinIdx++;
    } else {
      items.push({
        kind: 'mod',
        rarity: slot.rarity,
        nftContract: env.modAddress,
        tokenId: modBaseId + modIdx,
      });
      modIdx++;
    }
  }

  // Persist the commit row up-front so audit shows the in-flight state
  // even if the reveal tx fails.
  const [purchaseRow] = await db
    .insert(packPurchases)
    .values({
      userId,
      packTier,
      onchainPackId: Number(packId),
      commitHash,
    })
    .returning();

  // Phase 1: commit on-chain.
  const commitTx = await packs.commitPack(commitHash, tierId);
  const commitReceipt = await commitTx.wait();
  const commitTxHash = commitReceipt?.hash ?? commitTx.hash;

  await db
    .update(packPurchases)
    .set({ commitTxHash })
    .where(eq(packPurchases.id, purchaseRow.id));

  // Phase 2: reveal + mint.
  const nftContracts = items.map((it) => it.nftContract);
  const tokenIds = items.map((it) => BigInt(it.tokenId));
  const revealTx = await packs.revealAndMint(
    packId,
    seedHex,
    buyerAddress,
    nftContracts,
    tokenIds,
  );
  const revealReceipt = await revealTx.wait();
  const revealTxHash = revealReceipt?.hash ?? revealTx.hash;

  // Insert new skin/mod rows with the assigned tokenIds, owned by the
  // buyer. Names / images are placeholders for the testnet demo - a
  // richer pack engine fills these in later.
  const minted = [];
  for (const it of items) {
    if (it.kind === 'skin') {
      const [row] = await db
        .insert(skins)
        .values({
          userId,
          name: 'Pack Skin',
          rarity: it.rarity,
          imageUrl: '/skins/default.png',
          tokenId: it.tokenId,
          mintTxHash: revealTxHash,
          mintedAt: new Date(),
        })
        .returning();
      minted.push({ kind: 'skin', id: row.id, tokenId: it.tokenId, rarity: it.rarity });
    } else {
      const [row] = await db
        .insert(mods)
        .values({
          userId,
          name: 'Pack Mod',
          rarity: it.rarity,
          imageUrl: '/mods/default.png',
          tokenId: it.tokenId,
          mintTxHash: revealTxHash,
          mintedAt: new Date(),
        })
        .returning();
      minted.push({ kind: 'mod', id: row.id, tokenId: it.tokenId, rarity: it.rarity });
    }
  }

  // Finalize the pack_purchases row.
  await db
    .update(packPurchases)
    .set({
      seed: seedHex,
      revealTxHash,
      revealedAt: new Date(),
    })
    .where(eq(packPurchases.id, purchaseRow.id));

  return {
    packId: Number(packId),
    packTier,
    commitTxHash,
    revealTxHash,
    items: minted,
  };
}

/** Resolve the buyer's wallet address from their user id. */
export async function lookupBuyerWallet(userId) {
  const [row] = await db
    .select({ walletAddress: users.walletAddress })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.walletAddress ?? null;
}
