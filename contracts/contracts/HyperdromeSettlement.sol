// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IHyperdromeVOLT {
    function mint(address to, uint256 amount) external;
}

/// @title HyperdromeSettlement
/// @notice On-chain settlement for Hyperdrome race epochs. The cron
///         submits one batched `settleEpoch` per cycle: the contract
///         updates per-drone ELO and mints VOLT rewards to drone owners.
/// @dev DEVIATION: Captain's spec requested UUPS upgradeable. The
///      installed OpenZeppelin contracts 5.2.0 ships UUPSUpgradeable
///      and ERC1967Proxy with pragma `^0.8.22` (incompatible with the
///      locked `^0.8.20`), and `OwnableUpgradeable` lives only in the
///      separate openzeppelin-contracts-upgradeable package which is
///      not installed. Per Captain's instruction "If any OZ upgradeable
///      imports are missing, fall back to immutable and document the
///      deviation," this contract is immutable. A future upgrade is a
///      redeploy + DB pointer swap.
///
///      The contract calls `voltToken.mint(...)` directly. For this to
///      succeed, the deployer must call `HyperdromeVOLT.setMinter(<this>,
///      true)` after deploy.
contract HyperdromeSettlement is ReentrancyGuard, Ownable {
    /// @notice ELO seed for any drone whose first settlement lands here.
    int32 public constant DEFAULT_ELO = 1000;

    IHyperdromeVOLT public immutable voltToken;
    IERC721 public immutable droneNft;

    /// @notice Current ELO per drone tokenId. Lazily seeded to
    ///         DEFAULT_ELO on first settle (`droneEloInitialized` is the
    ///         seed marker so a legitimate ELO of 0 is distinguishable).
    mapping(uint256 => int32) public droneElo;
    mapping(uint256 => bool) public droneEloInitialized;

    /// @notice Whether `epochId` has already been settled. Prevents the
    ///         cron from accidentally double-paying an epoch on retry.
    mapping(uint256 => bool) public epochSettled;

    struct SettlementResult {
        uint256 droneATokenId;
        uint256 droneBTokenId;
        uint256 winnerTokenId;
        int16 eloDeltaA;
        int16 eloDeltaB;
        uint256 voltRewardA;
        uint256 voltRewardB;
    }

    event EpochSettled(uint256 indexed epochId, uint256 raceCount);
    event RaceSettled(
        uint256 indexed droneA,
        uint256 indexed droneB,
        uint256 winner,
        int16 eloDeltaA,
        int16 eloDeltaB
    );

    constructor(address voltTokenAddress, address droneNftAddress)
        Ownable(msg.sender)
    {
        require(voltTokenAddress != address(0), "VOLT zero");
        require(droneNftAddress != address(0), "drone zero");
        voltToken = IHyperdromeVOLT(voltTokenAddress);
        droneNft = IERC721(droneNftAddress);
    }

    /// @notice View the current ELO for a drone, returning the default
    ///         seed for drones that have never settled.
    function getElo(uint256 tokenId) external view returns (int32) {
        if (!droneEloInitialized[tokenId]) return DEFAULT_ELO;
        return droneElo[tokenId];
    }

    /// @notice Settle a batch of races. Must be called by the cron / owner.
    ///         nonReentrant in case voltToken.mint or ownerOf re-enters.
    function settleEpoch(uint256 epochId, SettlementResult[] calldata results)
        external
        onlyOwner
        nonReentrant
    {
        require(!epochSettled[epochId], "epoch settled");
        epochSettled[epochId] = true;

        uint256 len = results.length;
        for (uint256 i = 0; i < len; i++) {
            SettlementResult calldata r = results[i];

            _applyEloDelta(r.droneATokenId, r.eloDeltaA);
            _applyEloDelta(r.droneBTokenId, r.eloDeltaB);

            // Mint to current on-chain holder of each drone NFT. Skips
            // when the reward is zero (loser payout could be 0 in some
            // engine configurations).
            if (r.voltRewardA > 0) {
                address ownerA = droneNft.ownerOf(r.droneATokenId);
                voltToken.mint(ownerA, r.voltRewardA);
            }
            if (r.voltRewardB > 0) {
                address ownerB = droneNft.ownerOf(r.droneBTokenId);
                voltToken.mint(ownerB, r.voltRewardB);
            }

            emit RaceSettled(
                r.droneATokenId,
                r.droneBTokenId,
                r.winnerTokenId,
                r.eloDeltaA,
                r.eloDeltaB
            );
        }

        emit EpochSettled(epochId, len);
    }

    /// @dev First-touch initializes to DEFAULT_ELO; subsequent updates
    ///      add the delta. int32 storage with int16 deltas comfortably
    ///      bounds even pathological streaks.
    function _applyEloDelta(uint256 tokenId, int16 delta) internal {
        int32 current;
        if (!droneEloInitialized[tokenId]) {
            current = DEFAULT_ELO;
            droneEloInitialized[tokenId] = true;
        } else {
            current = droneElo[tokenId];
        }
        droneElo[tokenId] = current + int32(delta);
    }
}
