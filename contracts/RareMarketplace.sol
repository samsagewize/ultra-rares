// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20MarketplaceToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IRareFeeVaultMarketplace {
    function recordFee(uint256 amount) external;
}

interface IERC721MarketplaceCollection {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
}

/// @title Ultra Rares fixed-price RARE marketplace
/// @notice Non-custodial listings settled directly from buyer to seller in RARE.
contract RareMarketplace {
    uint256 public constant FEE_BPS = 200;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    struct Listing {
        address seller;
        uint256 price;
    }

    IERC721MarketplaceCollection public immutable collection;
    IERC20MarketplaceToken public immutable rareToken;
    IRareFeeVaultMarketplace public immutable feeVault;
    uint256 private locked = 1;
    mapping(uint256 tokenId => Listing) public listings;

    error InvalidAmount();
    error NotTokenOwner();
    error NotSeller();
    error MarketplaceNotApproved();
    error ListingUnavailable();
    error SelfPurchase();
    error TransferFailed();
    error Reentrancy();

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event ListingCancelled(uint256 indexed tokenId, address indexed seller);
    event Purchased(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price);

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(address collection_, address rareToken_, address feeVault_) {
        if (collection_ == address(0) || rareToken_ == address(0) || feeVault_ == address(0)) revert TransferFailed();
        collection = IERC721MarketplaceCollection(collection_);
        rareToken = IERC20MarketplaceToken(rareToken_);
        feeVault = IRareFeeVaultMarketplace(feeVault_);
    }

    function createListing(uint256 tokenId, uint256 price) external {
        if (price * FEE_BPS / BPS_DENOMINATOR == 0) revert InvalidAmount();
        if (collection.ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (!_isApproved(msg.sender, tokenId)) revert MarketplaceNotApproved();
        listings[tokenId] = Listing(msg.sender, price);
        emit Listed(tokenId, msg.sender, price);
    }

    function cancelListing(uint256 tokenId) external {
        Listing memory listing = listings[tokenId];
        if (listing.seller != msg.sender) revert NotSeller();
        delete listings[tokenId];
        emit ListingCancelled(tokenId, msg.sender);
    }

    function cancelInvalidListing(uint256 tokenId) external {
        Listing memory listing = listings[tokenId];
        if (listing.seller == address(0)) revert ListingUnavailable();
        if (collection.ownerOf(tokenId) == listing.seller && _isApproved(listing.seller, tokenId)) {
            revert ListingUnavailable();
        }
        delete listings[tokenId];
        emit ListingCancelled(tokenId, listing.seller);
    }

    function buy(uint256 tokenId) external nonReentrant {
        Listing memory listing = listings[tokenId];
        if (listing.seller == address(0)) revert ListingUnavailable();
        if (msg.sender == listing.seller) revert SelfPurchase();
        if (collection.ownerOf(tokenId) != listing.seller || !_isApproved(listing.seller, tokenId)) {
            revert ListingUnavailable();
        }

        delete listings[tokenId];
        uint256 balanceBefore = rareToken.balanceOf(address(this));
        _safeRareTransferFrom(msg.sender, address(this), listing.price);
        if (rareToken.balanceOf(address(this)) - balanceBefore != listing.price) revert TransferFailed();
        uint256 fee = listing.price * FEE_BPS / BPS_DENOMINATOR;
        _safeRareTransfer(listing.seller, listing.price - fee);
        _safeRareTransfer(address(feeVault), fee);
        feeVault.recordFee(fee);
        collection.safeTransferFrom(listing.seller, msg.sender, tokenId);
        emit Purchased(tokenId, listing.seller, msg.sender, listing.price);
    }

    function isActive(uint256 tokenId) external view returns (bool) {
        Listing memory listing = listings[tokenId];
        return listing.seller != address(0)
            && collection.ownerOf(tokenId) == listing.seller
            && _isApproved(listing.seller, tokenId);
    }

    function _isApproved(address seller, uint256 tokenId) private view returns (bool) {
        return collection.getApproved(tokenId) == address(this)
            || collection.isApprovedForAll(seller, address(this));
    }

    function _safeRareTransferFrom(address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = address(rareToken).call(
            abi.encodeCall(IERC20MarketplaceToken.transferFrom, (from, to, amount))
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeRareTransfer(address to, uint256 amount) private {
        (bool ok, bytes memory data) = address(rareToken).call(
            abi.encodeCall(IERC20MarketplaceToken.transfer, (to, amount))
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
