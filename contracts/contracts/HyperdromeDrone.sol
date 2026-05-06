// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title HyperdromeDrone
/// @notice ERC-721 representation of a Hyperdrome racing drone.
/// @dev Mints are owner-only (the deployer wallet, called server-side by the
///      Hyperdrome API). tokenURI resolves to the metadata API via baseURI;
///      no per-token URI overrides are used today.
contract HyperdromeDrone is ERC721, ERC721URIStorage, Ownable {
    string private _baseTokenURI;

    constructor()
        ERC721("Hyperdrome Drone", "HDRONE")
        Ownable(msg.sender)
    {}

    /// @notice Mint `tokenId` to `to`. Only the contract owner may call.
    function mint(address to, uint256 tokenId) external onlyOwner {
        _safeMint(to, tokenId);
    }

    /// @notice Set the prefix used by tokenURI for all tokens. Only the
    ///         contract owner may call.
    function setBaseURI(string memory baseURI_) external onlyOwner {
        _baseTokenURI = baseURI_;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
