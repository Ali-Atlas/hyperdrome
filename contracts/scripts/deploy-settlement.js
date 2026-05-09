/**
 * Deploys HyperdromeSettlement (immutable) and prints the resulting address.
 *
 * DEVIATION: Captain's spec requested UUPS upgradeable. OZ 5.2.0 ships
 * UUPSUpgradeable / ERC1967Proxy / ERC1967Utils with pragma `^0.8.22`
 * (incompatible with the locked `^0.8.20`), and OwnableUpgradeable lives
 * only in the `@openzeppelin/contracts-upgradeable` package which is not
 * installed. Per Captain's fallback instruction, this is an immutable
 * deploy.
 *
 * Required env:
 *   VOLT_CONTRACT_ADDRESS - deployed HyperdromeVOLT
 *   NEXT_PUBLIC_DRONE_CONTRACT_ADDRESS or DRONE_CONTRACT_ADDRESS -
 *     deployed HyperdromeDrone
 *
 * Post-deploy checklist (operator):
 *   1. Save SETTLEMENT_CONTRACT_ADDRESS to .env.local + Vercel env
 *   2. Authorize settlement to mint VOLT:
 *        await volt.setMinter(<settlement>, true)
 *      (run via a small Hardhat console session or a dedicated script)
 *
 * Usage:
 *   cd contracts
 *   DEPLOYER_PRIVATE_KEY=0x... \
 *   VOLT_CONTRACT_ADDRESS=0x... \
 *   NEXT_PUBLIC_DRONE_CONTRACT_ADDRESS=0x... \
 *   npx hardhat run scripts/deploy-settlement.js --network megaethTestnet
 */

const hre = require('hardhat');

async function main() {
  const network = hre.network.name;
  const voltAddress = process.env.VOLT_CONTRACT_ADDRESS;
  const droneAddress =
    process.env.NEXT_PUBLIC_DRONE_CONTRACT_ADDRESS ||
    process.env.DRONE_CONTRACT_ADDRESS;
  if (!voltAddress) {
    console.error('VOLT_CONTRACT_ADDRESS is required.');
    process.exit(1);
  }
  if (!droneAddress) {
    console.error('NEXT_PUBLIC_DRONE_CONTRACT_ADDRESS (or DRONE_CONTRACT_ADDRESS) is required.');
    process.exit(1);
  }

  const settlement = await hre.ethers.deployContract('HyperdromeSettlement', [
    voltAddress,
    droneAddress,
  ]);
  await settlement.waitForDeployment();
  const address = await settlement.getAddress();

  console.log(`HyperdromeSettlement deployed to ${address} on ${network}`);
  console.log(`  voltToken : ${voltAddress}`);
  console.log(`  droneNft  : ${droneAddress}`);
  console.log('');
  console.log(`Set SETTLEMENT_CONTRACT_ADDRESS=${address} in .env.local`);
  console.log('');
  console.log('Authorize settlement to mint VOLT next:');
  console.log(`  cast send $VOLT_CONTRACT_ADDRESS "setMinter(address,bool)" ${address} true \\`);
  console.log('    --rpc-url $MEGAETH_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
