/**
 * Server-side helper for the on-chain marketplace flow. Wraps ethers v6
 * around HyperdromeMarketplace + the per-item NFT contracts and the VOLT
 * token. All txs are signed by the deployer wallet (the only key the
 * server holds). Concurrent calls are serialized through ethers' nonce
 * management because every call awaits its own receipt before returning.
 *
 * The helper is the single source of truth for marketplace tx logic;
 * both the dedicated /api/marketplace/list|buy|cancel routes and the
 * existing services/marketplace.service.js paths call into it.
 */

import { ethers } from 'ethers';
import { ApiError } from '@/lib/api/response.js';

const NFT_ABI = [
  'function approve(address to, uint256 tokenId) external',
  'function ownerOf(uint256 tokenId) view returns (address)',
];

const VOLT_ABI = [
  'function approve(address spender, uint256 value) external returns (bool)',
];

const MARKETPLACE_ABI = [
  'function listItem(address nftContract, uint256 tokenId, uint256 priceInVolt) external returns (uint256)',
  'function buyItem(uint256 listingId) external',
  'function cancelListing(uint256 listingId) external',
  'event ItemListed(uint256 indexed listingId, address indexed seller, address indexed nftContract, uint256 tokenId, uint256 price)',
  'event ItemSold(uint256 indexed listingId, address indexed buyer, address indexed seller, uint256 sellerProceeds, uint256 treasuryCut)',
];

function readEnv() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const rpcUrl = process.env.MEGAETH_RPC_URL;
  const marketplaceAddress = process.env.MARKETPLACE_CONTRACT_ADDRESS;
  const voltAddress = process.env.VOLT_CONTRACT_ADDRESS;
  const droneAddress =
    process.env.NEXT_PUBLIC_DRONE_CONTRACT_ADDRESS ??
    process.env.DRONE_CONTRACT_ADDRESS;
  const skinAddress = process.env.SKIN_CONTRACT_ADDRESS;
  const modAddress = process.env.MOD_CONTRACT_ADDRESS;
  const missing = [];
  if (!privateKey) missing.push('DEPLOYER_PRIVATE_KEY');
  if (!rpcUrl) missing.push('MEGAETH_RPC_URL');
  if (!marketplaceAddress) missing.push('MARKETPLACE_CONTRACT_ADDRESS');
  if (!voltAddress) missing.push('VOLT_CONTRACT_ADDRESS');
  if (missing.length) {
    throw new ApiError(
      `Server is missing on-chain marketplace config: ${missing.join(', ')}`,
      500,
    );
  }
  return { privateKey, rpcUrl, marketplaceAddress, voltAddress, droneAddress, skinAddress, modAddress };
}

function nftAddressFor(env, itemType) {
  if (itemType === 'drone') return env.droneAddress;
  if (itemType === 'skin') return env.skinAddress;
  if (itemType === 'mod') return env.modAddress;
  throw new ApiError(`Unknown item type: ${itemType}`, 400);
}

function buildSigner(env) {
  const provider = new ethers.JsonRpcProvider(env.rpcUrl);
  const wallet = new ethers.Wallet(env.privateKey, provider);
  return { provider, wallet };
}

/**
 * VOLT prices throughout the app are integer "volts" (e.g. 100 volts);
 * the ERC-20 holds 18 decimals. Convert app-units to wei-equivalents
 * here so callers don't have to think about it.
 */
export function voltsToWei(volts) {
  return ethers.parseUnits(String(volts), 18);
}

/**
 * Approve `tokenId` of the per-item NFT contract to the marketplace and
 * call listItem. Returns the listingId emitted by ItemListed and the
 * tx hash of the listItem call.
 */
export async function listItemOnchain({ itemType, tokenId, priceInVolts }) {
  const env = readEnv();
  const nftAddress = nftAddressFor(env, itemType);
  if (!nftAddress) {
    throw new ApiError(`Server is missing the ${itemType} NFT contract address`, 500);
  }

  const { wallet } = buildSigner(env);

  const nft = new ethers.Contract(nftAddress, NFT_ABI, wallet);
  const marketplace = new ethers.Contract(env.marketplaceAddress, MARKETPLACE_ABI, wallet);

  // approve(marketplace, tokenId) - standard escrow pre-step.
  const approveTx = await nft.approve(env.marketplaceAddress, tokenId);
  await approveTx.wait();

  const priceWei = voltsToWei(priceInVolts);
  const listTx = await marketplace.listItem(nftAddress, tokenId, priceWei);
  const receipt = await listTx.wait();

  // Pull listingId out of ItemListed - simpler and safer than reading
  // nextListingId before the call (which races with concurrent deploys).
  const iface = new ethers.Interface(MARKETPLACE_ABI);
  let listingId = null;
  for (const log of receipt?.logs ?? []) {
    if (log.address.toLowerCase() !== env.marketplaceAddress.toLowerCase()) continue;
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === 'ItemListed') {
        listingId = Number(parsed.args.listingId);
        break;
      }
    } catch {
      /* not our event - keep scanning */
    }
  }

  if (listingId == null) {
    throw new ApiError('Listing tx confirmed but ItemListed event not found', 500);
  }

  return {
    listingId,
    txHash: receipt?.hash ?? listTx.hash,
    nftContract: nftAddress,
  };
}

/**
 * Approve `priceInVolts` worth of VOLT to the marketplace and call
 * buyItem. Returns the buy tx hash.
 */
export async function buyItemOnchain({ listingId, priceInVolts }) {
  const env = readEnv();
  const { wallet } = buildSigner(env);

  const volt = new ethers.Contract(env.voltAddress, VOLT_ABI, wallet);
  const marketplace = new ethers.Contract(env.marketplaceAddress, MARKETPLACE_ABI, wallet);

  const priceWei = voltsToWei(priceInVolts);

  const approveTx = await volt.approve(env.marketplaceAddress, priceWei);
  await approveTx.wait();

  const buyTx = await marketplace.buyItem(listingId);
  const receipt = await buyTx.wait();

  return { txHash: receipt?.hash ?? buyTx.hash };
}

/**
 * Verify a user-signed buyItem tx before letting the DB flip the listing
 * to sold. Reads the receipt, parses the ItemSold event from the
 * marketplace contract's logs, and confirms (a) the tx succeeded,
 * (b) the listingId in the event matches the listing the caller is
 * trying to buy, and (c) the buyer in the event matches the calling
 * user's wallet (so a malicious user can't forward someone else's
 * txHash to claim ownership of the listing in our DB).
 *
 * Throws ApiError(400) on any verification failure - those are
 * client-attributable. Throws plain Error on RPC unreachability so the
 * caller can decide whether to surface a 500 or retry.
 *
 * @param {{ txHash: string, expectedListingId: number|bigint, expectedBuyer: string }} args
 */
export async function verifyBuyTx({ txHash, expectedListingId, expectedBuyer }) {
  if (!txHash || typeof txHash !== 'string' || !txHash.startsWith('0x')) {
    throw new ApiError('Invalid transaction hash', 400);
  }
  if (!expectedBuyer) {
    throw new ApiError('Buyer wallet not bound to session', 400);
  }

  const env = readEnv();
  const provider = new ethers.JsonRpcProvider(env.rpcUrl);

  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    throw new ApiError(
      'Buy transaction not found on-chain (still propagating?). Wait a moment and retry.',
      400,
    );
  }
  if (receipt.status !== 1) {
    throw new ApiError('Buy transaction reverted on-chain', 400);
  }

  const iface = new ethers.Interface(MARKETPLACE_ABI);
  const expectedListingIdBn = BigInt(expectedListingId);
  const expectedBuyerLower = expectedBuyer.toLowerCase();

  for (const log of receipt.logs ?? []) {
    if (log.address.toLowerCase() !== env.marketplaceAddress.toLowerCase()) {
      continue;
    }
    let parsed;
    try {
      parsed = iface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed?.name !== 'ItemSold') continue;

    const eventListingId = BigInt(parsed.args.listingId);
    const eventBuyer = String(parsed.args.buyer).toLowerCase();

    if (eventListingId !== expectedListingIdBn) {
      throw new ApiError(
        `Tx settles a different listing (${eventListingId}, expected ${expectedListingIdBn})`,
        400,
      );
    }
    if (eventBuyer !== expectedBuyerLower) {
      throw new ApiError(
        'Buy transaction was signed by a different wallet than your session',
        403,
      );
    }
    return {
      ok: true,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
    };
  }

  throw new ApiError(
    'Buy transaction did not emit ItemSold for the expected listing',
    400,
  );
}

/**
 * Cancel an active on-chain listing. Marketplace returns the NFT to the
 * seller (the deployer in the testnet model).
 */
export async function cancelListingOnchain(listingId) {
  const env = readEnv();
  const { wallet } = buildSigner(env);

  const marketplace = new ethers.Contract(env.marketplaceAddress, MARKETPLACE_ABI, wallet);

  const tx = await marketplace.cancelListing(listingId);
  const receipt = await tx.wait();

  return { txHash: receipt?.hash ?? tx.hash };
}
