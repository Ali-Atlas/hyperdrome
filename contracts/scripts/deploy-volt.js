/**
 * Deploys HyperdromeVOLT (ERC-20) and prints the resulting address.
 *
 * Usage:
 *   cd contracts
 *   DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deploy-volt.js --network megaethTestnet
 */

const hre = require('hardhat');

async function main() {
  const network = hre.network.name;

  const volt = await hre.ethers.deployContract('HyperdromeVOLT');
  await volt.waitForDeployment();
  const address = await volt.getAddress();

  console.log(`HyperdromeVOLT deployed to ${address} on ${network}`);
  console.log('');
  console.log(`Set VOLT_CONTRACT_ADDRESS=${address} in .env.local`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
