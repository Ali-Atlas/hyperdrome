// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title HyperdromeMarketplace
/// @notice Escrow marketplace for any Hyperdrome ERC-721 (drone, skin, mod)
///         priced in HyperdromeVOLT. 90% goes to the seller, 10% to the
///         treasury.
/// @dev On testnet the deployer signs every tx, so msg.sender is the
///      deployer for both list and buy. The contract is written to the
///      generic msg.sender pattern so it transitions cleanly to user-signed
///      calls (or EIP-2612 permits) once gas-paying users come online.
contract HyperdromeMarketplace is IERC721Receiver, ReentrancyGuard, Ownable {
    /// @dev 10% in basis points. Hard-coded per Captain's locked decision -
    ///      adjusting the fee is a redeploy, not a config write.
    uint256 public constant TREASURY_BPS = 1000;
    uint256 private constant BPS_DENOM = 10_000;

    IERC20 public immutable voltToken;
    address public treasury;

    struct Listing {
        address seller;
        address nftContract;
        uint256 tokenId;
        uint256 price;
        bool active;
    }

    /// @notice listingId starts at 1 so a zero return from a stale read can
    ///         be interpreted as "not listed".
    uint256 public nextListingId = 1;
    mapping(uint256 => Listing) public listings;

    event ItemListed(
        uint256 indexed listingId,
        address indexed seller,
        address indexed nftContract,
        uint256 tokenId,
        uint256 price
    );
    event ItemSold(
        uint256 indexed listingId,
        address indexed buyer,
        address indexed seller,
        uint256 sellerProceeds,
        uint256 treasuryCut
    );
    event ItemCancelled(uint256 indexed listingId, address indexed seller);
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);

    constructor(address voltTokenAddress, address treasuryAddress)
        Ownable(msg.sender)
    {
        require(voltTokenAddress != address(0), "VOLT zero");
        require(treasuryAddress != address(0), "treasury zero");
        voltToken = IERC20(voltTokenAddress);
        treasury = treasuryAddress;
    }

    /// @notice Update the treasury sink. Owner-only because re-routing
    ///         platform fees is a privileged operation.
    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "treasury zero");
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    /// @notice List `tokenId` of `nftContract` for sale at `priceInVolt`. The
    ///         caller must have approved this contract for that tokenId.
    ///         The NFT is escrowed in this contract until sale or cancel.
    /// @return listingId The id assigned to the new listing.
    function listItem(
        address nftContract,
        uint256 tokenId,
        uint256 priceInVolt
    ) external returns (uint256 listingId) {
        require(priceInVolt > 0, "price zero");
        require(nftContract != address(0), "nft zero");

        listingId = nextListingId++;
        listings[listingId] = Listing({
            seller: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            price: priceInVolt,
            active: true
        });

        IERC721(nftContract).safeTransferFrom(msg.sender, address(this), tokenId);

        emit ItemListed(listingId, msg.sender, nftContract, tokenId, priceInVolt);
    }

    /// @notice Buy an active listing. Requires the buyer (msg.sender) to
    ///         have approved this contract for `price` worth of VOLT.
    ///         nonReentrant in case a future NFT token's safeTransfer
    ///         re-enters via a malicious receiver hook.
    function buyItem(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "not active");
        require(msg.sender != listing.seller, "self buy");

        uint256 treasuryCut = (listing.price * TREASURY_BPS) / BPS_DENOM;
        uint256 sellerProceeds = listing.price - treasuryCut;

        // Mark inactive BEFORE external calls (CEI). The reentrancy guard
        // is a belt; the inactive flag is the suspenders.
        listing.active = false;

        // VOLT split. transferFrom returns bool by spec; OZ ERC-20 reverts
        // on insufficient allowance / balance, so a return-false branch is
        // effectively unreachable, but check anyway for non-OZ tokens.
        require(
            voltToken.transferFrom(msg.sender, listing.seller, sellerProceeds),
            "seller payout failed"
        );
        if (treasuryCut > 0) {
            require(
                voltToken.transferFrom(msg.sender, treasury, treasuryCut),
                "treasury fee failed"
            );
        }

        IERC721(listing.nftContract).safeTransferFrom(
            address(this),
            msg.sender,
            listing.tokenId
        );

        emit ItemSold(listingId, msg.sender, listing.seller, sellerProceeds, treasuryCut);
    }

    /// @notice Cancel an active listing and return the NFT to the seller.
    ///         Only the original seller may cancel.
    function cancelListing(uint256 listingId) external {
        Listing storage listing = listings[listingId];
        require(listing.active, "not active");
        require(msg.sender == listing.seller, "not seller");

        listing.active = false;

        IERC721(listing.nftContract).safeTransferFrom(
            address(this),
            listing.seller,
            listing.tokenId
        );

        emit ItemCancelled(listingId, listing.seller);
    }

    /// @notice IERC721Receiver implementation - required to accept
    ///         safeTransferFrom into this contract during listItem.
    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }
}
