/**
 * Deploys HyperdromeDrone, sets the metadata baseURI, and prints the
 * resulting address + network for the operator to record.
 *
 * Usage:
 *   cd contracts
 *   DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deploy.js --network megaethTestnet
 */

const hre = require('hardhat');

const BASE_URI = 'https://hyperdrome.vercel.app/api/drones/';

async function main() {
  const network = hre.network.name;

  const drone = await hre.ethers.deployContract('HyperdromeDrone');
  await drone.waitForDeployment();
  const address = await drone.getAddress();

  const tx = await drone.setBaseURI(BASE_URI);
  await tx.wait();

  console.log(`HyperdromeDrone deployed to ${address} on ${network}`);
  console.log(`baseURI set to ${BASE_URI}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
