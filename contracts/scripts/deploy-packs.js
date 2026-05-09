/**
 * Deploys HyperdromePacks and prints the resulting address.
 *
 * Required env:
 *   VOLT_CONTRACT_ADDRESS
 *   SKIN_CONTRACT_ADDRESS
 *   MOD_CONTRACT_ADDRESS
 *
 * Treasury defaults to the deployer wallet (per Captain's locked
 * decision). Override with TREASURY_ADDRESS if needed.
 *
 * Post-deploy checklist (operator):
 *   1. Save PACKS_CONTRACT_ADDRESS to .env.local + Vercel env
 *   2. Authorize packs to burn VOLT:
 *        volt.setBurner(<packs>, true)
 *   3. Authorize packs to mint skins / mods:
 *        skin.setMinter(<packs>, true)
 *        mod.setMinter(<packs>, true)
 *   4. Set initial pack prices (in wei, 18 decimals):
 *        packs.setPackPrice(0, parseUnits("100", 18))   // STARTER
 *        packs.setPackPrice(1, parseUnits("250", 18))   // PREMIUM
 *        packs.setPackPrice(2, parseUnits("750", 18))   // LEGENDARY
 *
 * Usage:
 *   cd contracts
 *   DEPLOYER_PRIVATE_KEY=0x... \
 *   VOLT_CONTRACT_ADDRESS=0x... \
 *   SKIN_CONTRACT_ADDRESS=0x... \
 *   MOD_CONTRACT_ADDRESS=0x... \
 *   npx hardhat run scripts/deploy-packs.js --network megaethTestnet
 */

const hre = require('hardhat');

async function main() {
  const network = hre.network.name;
  const voltAddress = process.env.VOLT_CONTRACT_ADDRESS;
  const skinAddress = process.env.SKIN_CONTRACT_ADDRESS;
  const modAddress = process.env.MOD_CONTRACT_ADDRESS;
  if (!voltAddress || !skinAddress || !modAddress) {
    console.error('VOLT_CONTRACT_ADDRESS, SKIN_CONTRACT_ADDRESS, and MOD_CONTRACT_ADDRESS are required.');
    process.exit(1);
  }

  const [deployer] = await hre.ethers.getSigners();
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;

  const packs = await hre.ethers.deployContract('HyperdromePacks', [
    voltAddress,
    skinAddress,
    modAddress,
    treasury,
  ]);
  await packs.waitForDeployment();
  const address = await packs.getAddress();

  console.log(`HyperdromePacks deployed to ${address} on ${network}`);
  console.log(`  voltToken : ${voltAddress}`);
  console.log(`  skin      : ${skinAddress}`);
  console.log(`  mod       : ${modAddress}`);
  console.log(`  treasury  : ${treasury}`);
  console.log('');
  console.log(`Set PACKS_CONTRACT_ADDRESS=${address} in .env.local`);
  console.log('');
  console.log('Authorization to set after this deploy:');
  console.log(`  volt.setBurner(${address}, true)`);
  console.log(`  skin.setMinter(${address}, true)`);
  console.log(`  mod.setMinter(${address}, true)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
