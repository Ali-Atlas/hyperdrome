/**
 * Deploys HyperdromeMod (ERC-721), sets baseURI, prints address.
 *
 * Usage:
 *   cd contracts
 *   DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deploy-mod.js --network megaethTestnet
 */

const hre = require('hardhat');

const BASE_URI = 'https://hyperdrome.vercel.app/api/mods/';

async function main() {
  const network = hre.network.name;

  const mod = await hre.ethers.deployContract('HyperdromeMod');
  await mod.waitForDeployment();
  const address = await mod.getAddress();

  const tx = await mod.setBaseURI(BASE_URI);
  await tx.wait();

  console.log(`HyperdromeMod deployed to ${address} on ${network}`);
  console.log(`baseURI set to ${BASE_URI}`);
  console.log('');
  console.log(`Set MOD_CONTRACT_ADDRESS=${address} in .env.local`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
