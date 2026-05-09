/**
 * Deploys HyperdromeMarketplace and prints the resulting address.
 *
 * Required env (read at deploy time, not contract args):
 *   VOLT_CONTRACT_ADDRESS - the deployed HyperdromeVOLT address.
 *
 * Treasury defaults to the deployer wallet (per Captain's locked
 * decision for testnet). Override with TREASURY_ADDRESS if needed.
 *
 * Usage:
 *   cd contracts
 *   DEPLOYER_PRIVATE_KEY=0x... \
 *   VOLT_CONTRACT_ADDRESS=0x... \
 *   npx hardhat run scripts/deploy-marketplace.js --network megaethTestnet
 */

const hre = require('hardhat');

async function main() {
  const network = hre.network.name;
  const voltAddress = process.env.VOLT_CONTRACT_ADDRESS;
  if (!voltAddress) {
    console.error('VOLT_CONTRACT_ADDRESS is required.');
    process.exit(1);
  }

  const [deployer] = await hre.ethers.getSigners();
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;

  const marketplace = await hre.ethers.deployContract('HyperdromeMarketplace', [
    voltAddress,
    treasury,
  ]);
  await marketplace.waitForDeployment();
  const address = await marketplace.getAddress();

  console.log(`HyperdromeMarketplace deployed to ${address} on ${network}`);
  console.log(`  voltToken : ${voltAddress}`);
  console.log(`  treasury  : ${treasury}`);
  console.log('');
  console.log(`Set MARKETPLACE_CONTRACT_ADDRESS=${address} in .env.local`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
