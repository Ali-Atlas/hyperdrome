// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IHyperdromeVOLT {
    function burn(address from, uint256 amount) external;
}

interface IMintableERC721 {
    function mint(address to, uint256 tokenId) external;
}

/// @title HyperdromePacks
/// @notice Pack purchase + open flow with commit-reveal randomness. The
///         server commits a hash before knowing the user's purchase,
///         then reveals the seed when minting; this prevents the server
///         from biasing pack contents based on the buyer.
/// @dev On testnet the server signs both txs (commit + reveal), so the
///      operator must call `setMinter` on each NFT contract this packs
///      contract will mint into and `setBurner` on the VOLT contract
///      after deploy.
contract HyperdromePacks is ReentrancyGuard, Ownable {
    /// @notice Pack tiers. Mirror the off-chain enumeration:
    ///         0 = STARTER, 1 = PREMIUM, 2 = LEGENDARY.
    uint8 public constant TIER_STARTER = 0;
    uint8 public constant TIER_PREMIUM = 1;
    uint8 public constant TIER_LEGENDARY = 2;

    IHyperdromeVOLT public immutable voltToken;
    address public immutable skinContract;
    address public immutable modContract;
    address public treasury;

    /// @notice VOLT price (in wei, 18 decimals) per tier. Tier ids must
    ///         have a non-zero price set before they can be committed.
    mapping(uint8 => uint256) public packPrice;

    struct Commit {
        bytes32 hash;
        uint8 tier;
        bool revealed;
    }

    /// @notice packId -> commit. nextPackId starts at 1 so a stale-zero
    ///         read implies "not yet issued".
    mapping(uint256 => Commit) public commits;
    uint256 public nextPackId = 1;

    event PackPriceUpdated(uint8 indexed tier, uint256 priceInWei);
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event PackCommitted(uint256 indexed packId, uint8 indexed tier, bytes32 commitHash);
    event PackRevealed(uint256 indexed packId, address indexed buyer, uint8 indexed tier, uint256 itemCount);

    constructor(
        address voltTokenAddress,
        address skinContractAddress,
        address modContractAddress,
        address treasuryAddress
    ) Ownable(msg.sender) {
        require(voltTokenAddress != address(0), "VOLT zero");
        require(skinContractAddress != address(0), "skin zero");
        require(modContractAddress != address(0), "mod zero");
        require(treasuryAddress != address(0), "treasury zero");
        voltToken = IHyperdromeVOLT(voltTokenAddress);
        skinContract = skinContractAddress;
        modContract = modContractAddress;
        treasury = treasuryAddress;
    }

    /// @notice Set the VOLT price (in wei, 18 decimals) for a pack tier.
    function setPackPrice(uint8 tier, uint256 priceInWei) external onlyOwner {
        packPrice[tier] = priceInWei;
        emit PackPriceUpdated(tier, priceInWei);
    }

    /// @notice Update the treasury sink. Reserved for future fee splits;
    ///         current burn-only flow does not route to treasury.
    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "treasury zero");
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    /// @notice Commit to a pack purchase. Server precomputes
    ///         keccak256(abi.encodePacked(seed, packId)) using the value
    ///         of `nextPackId` it just read (race-free on testnet because
    ///         only the deployer can call this).
    /// @return packId The id assigned to the new commit.
    function commitPack(bytes32 commitHash, uint8 tier)
        external
        onlyOwner
        returns (uint256 packId)
    {
        require(packPrice[tier] > 0, "tier price unset");
        require(commitHash != bytes32(0), "hash zero");
        packId = nextPackId++;
        commits[packId] = Commit({ hash: commitHash, tier: tier, revealed: false });
        emit PackCommitted(packId, tier, commitHash);
    }

    /// @notice Reveal the seed, verify against the stored commit, burn
    ///         VOLT from the buyer, and mint each (nftContract, tokenId)
    ///         pair to the buyer. nftContracts is constrained to the
    ///         skin and mod addresses set at construction so a malicious
    ///         reveal can't redirect mints to an unrelated contract.
    function revealAndMint(
        uint256 packId,
        bytes32 seed,
        address buyer,
        address[] calldata nftContracts,
        uint256[] calldata tokenIds
    ) external onlyOwner nonReentrant {
        Commit storage c = commits[packId];
        require(!c.revealed, "already revealed");
        require(c.hash != bytes32(0), "no commit");
        require(
            keccak256(abi.encodePacked(seed, packId)) == c.hash,
            "bad reveal"
        );
        require(nftContracts.length == tokenIds.length, "arr mismatch");
        require(nftContracts.length > 0, "empty pack");

        c.revealed = true;

        // Burn VOLT from buyer (allowance bypass per HyperdromeVOLT.burn).
        uint256 price = packPrice[c.tier];
        if (price > 0) {
            voltToken.burn(buyer, price);
        }

        // Mint each item to buyer. Constrain target contract addresses
        // so a buggy server can't redirect the mint to an attacker-owned
        // contract that happens to expose a mint-shape function.
        for (uint256 i = 0; i < nftContracts.length; i++) {
            address target = nftContracts[i];
            require(
                target == skinContract || target == modContract,
                "bad nft target"
            );
            IMintableERC721(target).mint(buyer, tokenIds[i]);
        }

        emit PackRevealed(packId, buyer, c.tier, nftContracts.length);
    }
}
