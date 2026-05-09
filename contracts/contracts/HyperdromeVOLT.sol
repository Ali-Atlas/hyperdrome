// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title HyperdromeVOLT
/// @notice In-game currency for Hyperdrome. ERC-20, 18 decimals (default),
///         uncapped supply, server-only mint and burn.
/// @dev Mint and burn are onlyOwner. The server (deployer wallet) mints
///      race rewards and burns on pack purchase / stat upgrade. No initial
///      supply: every VOLT in circulation traces back to a gameplay event.
contract HyperdromeVOLT is ERC20, Ownable {
    constructor()
        ERC20("Hyperdrome VOLT", "VOLT")
        Ownable(msg.sender)
    {}

    /// @notice Mint `amount` VOLT to `to`. Only the contract owner may call.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Burn `amount` VOLT from `from`. Only the contract owner may call.
    ///         Bypasses allowance because the server is operating on behalf
    ///         of the player (centralized signing model on testnet).
    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }
}
