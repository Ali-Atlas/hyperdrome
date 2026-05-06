require('@nomicfoundation/hardhat-ethers');

const { DEPLOYER_PRIVATE_KEY } = process.env;

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: '0.8.20',
  networks: {
    megaethTestnet: {
      url: 'https://carrot.megaeth.com/rpc',
      chainId: 6343,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};
