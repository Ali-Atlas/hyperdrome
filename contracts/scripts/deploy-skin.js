/**
 * Deploys HyperdromeSkin (ERC-721), sets baseURI, prints address.
 *
 * Usage:
 *   cd contracts
 *   DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deploy-skin.js --network megaethTestnet
 */

const hre = require('hardhat');

const BASE_URI = 'https://hyperdrome.vercel.app/api/skins/';

async function main() {
  const network = hre.network.name;

  const skin = await hre.ethers.deployContract('HyperdromeSkin');
  await skin.waitForDeployment();
  const address = await skin.getAddress();

  const tx = await skin.setBaseURI(BASE_URI);
  await tx.wait();

  console.log(`HyperdromeSkin deployed to ${address} on ${network}`);
  console.log(`baseURI set to ${BASE_URI}`);
  console.log('');
  console.log(`Set SKIN_CONTRACT_ADDRESS=${address} in .env.local`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
