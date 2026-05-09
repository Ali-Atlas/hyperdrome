// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title HyperdromeVOLT
/// @notice In-game currency for Hyperdrome. ERC-20, 18 decimals (default),
///         uncapped supply, role-gated mint and burn.
/// @dev Owner authorizes additional minter/burner contracts (settlement,
///      packs) so the multi-contract architecture can mint rewards and
///      burn purchase costs without ownership-transfer hand-offs. Owner
///      retains direct mint/burn for stat-upgrade and ad-hoc admin ops.
///      No initial supply: every VOLT in circulation traces back to a
///      gameplay event.
contract HyperdromeVOLT is ERC20, Ownable {
    /// @notice Addresses authorized to mint VOLT in addition to the owner.
    mapping(address => bool) public minters;
    /// @notice Addresses authorized to burn VOLT in addition to the owner.
    ///         Burns bypass ERC-20 allowance because the server / pack
    ///         contract is operating on behalf of the player (centralized
    ///         signing model on testnet).
    mapping(address => bool) public burners;

    event MinterUpdated(address indexed account, bool enabled);
    event BurnerUpdated(address indexed account, bool enabled);

    modifier onlyMinter() {
        require(msg.sender == owner() || minters[msg.sender], "not minter");
        _;
    }

    modifier onlyBurner() {
        require(msg.sender == owner() || burners[msg.sender], "not burner");
        _;
    }

    constructor()
        ERC20("Hyperdrome VOLT", "VOLT")
        Ownable(msg.sender)
    {}

    /// @notice Authorize / revoke `account` as an additional minter.
    function setMinter(address account, bool enabled) external onlyOwner {
        minters[account] = enabled;
        emit MinterUpdated(account, enabled);
    }

    /// @notice Authorize / revoke `account` as an additional burner.
    function setBurner(address account, bool enabled) external onlyOwner {
        burners[account] = enabled;
        emit BurnerUpdated(account, enabled);
    }

    /// @notice Mint `amount` VOLT to `to`. Owner or any authorized minter.
    function mint(address to, uint256 amount) external onlyMinter {
        _mint(to, amount);
    }

    /// @notice Burn `amount` VOLT from `from`. Owner or any authorized burner.
    function burn(address from, uint256 amount) external onlyBurner {
        _burn(from, amount);
    }
}
