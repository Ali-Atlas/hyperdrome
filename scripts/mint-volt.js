/**
 * Mint VOLT to an arbitrary recipient from the deployer wallet.
 *
 *   node --env-file=.env.local scripts/mint-volt.js <recipient> <amount>
 *
 *   <recipient>  EIP-55 wallet address (case-insensitive 0x + 40 hex)
 *   <amount>     positive integer "volts" (display units). Converted to
 *                18-decimal wei before submission, matching how the
 *                game-engine economy stores VOLT throughout the app.
 *
 * Usage example (seed Ali's wallet for the demo):
 *
 *   node --env-file=.env.local scripts/mint-volt.js \
 *     0xF7Ba0000000000000000000000000000000009888 110000
 *
 * Auth model: HyperdromeVOLT.mint() requires the caller to be the owner
 * or an authorized minter. The deployer key in .env.local is the owner
 * by construction (Ownable(msg.sender)), so it can mint directly.
 */

import { ethers } from 'ethers';

const HYPERDROME_VOLT_ABI = [
  'function mint(address to, uint256 amount) external',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

function readEnv() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const rpcUrl = process.env.MEGAETH_RPC_URL;
  const contractAddress = process.env.VOLT_CONTRACT_ADDRESS;
  const missing = [];
  if (!privateKey) missing.push('DEPLOYER_PRIVATE_KEY');
  if (!rpcUrl) missing.push('MEGAETH_RPC_URL');
  if (!contractAddress) missing.push('VOLT_CONTRACT_ADDRESS');
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    console.error('Run via: node --env-file=.env.local scripts/mint-volt.js <recipient> <amount>');
    process.exit(1);
  }
  return { privateKey, rpcUrl, contractAddress };
}

function parseArgs() {
  const [, , recipientArg, amountArg] = process.argv;
  if (!recipientArg || !amountArg) {
    console.error('Usage: node --env-file=.env.local scripts/mint-volt.js <recipient> <amount>');
    process.exit(1);
  }

  let recipient;
  try {
    // Validates EIP-55 checksum or accepts all-lower / all-upper canonical
    // forms. Throws on a bad address; we surface a clean error message.
    recipient = ethers.getAddress(recipientArg);
  } catch {
    console.error(`Invalid recipient address: "${recipientArg}"`);
    process.exit(1);
  }

  // Display-unit volts. Reject non-integer inputs so a typo like "110.5"
  // doesn't silently truncate. Use BigInt for the bound check so very
  // large mints (>2^53) are still safe.
  if (!/^\d+$/.test(amountArg)) {
    console.error(`Amount must be a non-negative integer in display VOLT units; got "${amountArg}"`);
    process.exit(1);
  }
  const amount = BigInt(amountArg);
  if (amount === 0n) {
    console.error('Amount must be > 0');
    process.exit(1);
  }

  return { recipient, amount };
}

async function main() {
  const env = readEnv();
  const { recipient, amount } = parseArgs();

  const provider = new ethers.JsonRpcProvider(env.rpcUrl);
  const wallet = new ethers.Wallet(env.privateKey, provider);
  const deployerAddress = await wallet.getAddress();
  const contract = new ethers.Contract(env.contractAddress, HYPERDROME_VOLT_ABI, wallet);

  const network = await provider.getNetwork();
  console.log(`[mint-volt] chain id ${network.chainId}, deployer ${deployerAddress}`);
  console.log(`[mint-volt] VOLT contract ${env.contractAddress}`);

  // The contract uses ERC-20 default 18 decimals; we still query so a
  // future contract change doesn't silently mint the wrong amount.
  const decimals = await contract.decimals();
  const wei = ethers.parseUnits(amount.toString(), decimals);
  console.log(`[mint-volt] minting ${amount} VOLT (${wei.toString()} wei) to ${recipient}`);

  const beforeWei = await contract.balanceOf(recipient);
  const tx = await contract.mint(recipient, wei);
  console.log(`[mint-volt] tx submitted: ${tx.hash}`);
  const receipt = await tx.wait();
  const txHash = receipt?.hash ?? tx.hash;
  const afterWei = await contract.balanceOf(recipient);

  console.log('');
  console.log('[mint-volt] OK');
  console.log(`  tx          : ${txHash}`);
  console.log(`  blockscout  : https://megaeth-testnet-v2.blockscout.com/tx/${txHash}`);
  console.log(`  recipient   : ${recipient}`);
  console.log(`  before VOLT : ${ethers.formatUnits(beforeWei, decimals)}`);
  console.log(`  after VOLT  : ${ethers.formatUnits(afterWei, decimals)}`);
}

main().catch((err) => {
  const reason = err?.shortMessage ?? err?.message ?? String(err);
  console.error('[mint-volt] fatal:', reason);
  process.exit(1);
});
