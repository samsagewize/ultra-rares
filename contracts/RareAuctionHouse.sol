// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20AuctionToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IERC721AuctionCollection {
    function ownerOf(uint256 tokenId) external view returns (address);
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function transferFrom(address from, address to, uint256 tokenId) external;
}

interface IERC721ReceiverMinimal {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data) external returns (bytes4);
}

interface IRareFeeVaultAuction {
    function recordFee(uint256 amount) external;
}

/// @title Ultra Rares RARE Auction House
/// @notice Escrows an Ultra Rare during a 2-hour to 7-day auction settled in RARE.
contract RareAuctionHouse is IERC721ReceiverMinimal {
    uint256 public constant MIN_DURATION = 2 hours;
    uint256 public constant MAX_DURATION = 7 days;
    uint256 public constant FEE_BPS = 200;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    struct Auction {
        address seller;
        uint64 endTime;
        uint256 reservePrice;
        address highestBidder;
        uint256 highestBid;
    }

    IERC721AuctionCollection public immutable collection;
    IERC20AuctionToken public immutable rareToken;
    IRareFeeVaultAuction public immutable feeVault;
    mapping(uint256 tokenId => Auction) public auctions;
    mapping(address bidder => uint256 amount) public pendingReturns;

    uint256 private locked = 1;
    address private expectedSeller;
    uint256 private expectedTokenId;
    bool private expectingNft;

    error InvalidDuration();
    error InvalidAmount();
    error NotTokenOwner();
    error AuctionExists();
    error AuctionUnavailable();
    error AuctionStillRunning();
    error AuctionEnded();
    error BidTooLow();
    error SellerCannotBid();
    error BidsAlreadyPlaced();
    error NotSeller();
    error UnexpectedNft();
    error TransferFailed();
    error Reentrancy();

    event AuctionCreated(uint256 indexed tokenId, address indexed seller, uint256 reservePrice, uint256 endTime);
    event BidPlaced(uint256 indexed tokenId, address indexed bidder, uint256 amount);
    event AuctionCancelled(uint256 indexed tokenId, address indexed seller);
    event AuctionSettled(uint256 indexed tokenId, address indexed seller, address indexed winner, uint256 amount);
    event AuctionExpired(uint256 indexed tokenId, address indexed seller);
    event RefundWithdrawn(address indexed bidder, uint256 amount);

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(address collection_, address rareToken_, address feeVault_) {
        if (collection_ == address(0) || rareToken_ == address(0) || feeVault_ == address(0)) revert TransferFailed();
        collection = IERC721AuctionCollection(collection_);
        rareToken = IERC20AuctionToken(rareToken_);
        feeVault = IRareFeeVaultAuction(feeVault_);
    }

    function createAuction(uint256 tokenId, uint256 reservePrice, uint256 duration) external nonReentrant {
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert InvalidDuration();
        if (reservePrice * FEE_BPS / BPS_DENOMINATOR == 0) revert InvalidAmount();
        if (collection.ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (auctions[tokenId].seller != address(0)) revert AuctionExists();

        uint64 endTime = uint64(block.timestamp + duration);
        auctions[tokenId] = Auction(msg.sender, endTime, reservePrice, address(0), 0);
        expectedSeller = msg.sender;
        expectedTokenId = tokenId;
        expectingNft = true;
        collection.safeTransferFrom(msg.sender, address(this), tokenId);
        expectingNft = false;
        expectedSeller = address(0);
        emit AuctionCreated(tokenId, msg.sender, reservePrice, endTime);
    }

    function bid(uint256 tokenId, uint256 amount) external nonReentrant {
        Auction storage auction = auctions[tokenId];
        if (auction.seller == address(0)) revert AuctionUnavailable();
        if (block.timestamp >= auction.endTime) revert AuctionEnded();
        if (msg.sender == auction.seller) revert SellerCannotBid();
        if (amount <= auction.highestBid || amount * FEE_BPS / BPS_DENOMINATOR == 0) revert BidTooLow();

        uint256 balanceBefore = rareToken.balanceOf(address(this));
        _safeTransferFrom(msg.sender, address(this), amount);
        if (rareToken.balanceOf(address(this)) - balanceBefore != amount) revert TransferFailed();

        if (auction.highestBidder != address(0)) pendingReturns[auction.highestBidder] += auction.highestBid;
        auction.highestBidder = msg.sender;
        auction.highestBid = amount;
        emit BidPlaced(tokenId, msg.sender, amount);
    }

    function cancelAuction(uint256 tokenId) external nonReentrant {
        Auction memory auction = auctions[tokenId];
        if (auction.seller != msg.sender) revert NotSeller();
        if (auction.highestBidder != address(0)) revert BidsAlreadyPlaced();
        delete auctions[tokenId];
        collection.transferFrom(address(this), auction.seller, tokenId);
        emit AuctionCancelled(tokenId, auction.seller);
    }

    function settle(uint256 tokenId) external nonReentrant {
        Auction memory auction = auctions[tokenId];
        if (auction.seller == address(0)) revert AuctionUnavailable();
        if (block.timestamp < auction.endTime) revert AuctionStillRunning();
        delete auctions[tokenId];

        if (auction.highestBidder == address(0) || auction.highestBid < auction.reservePrice) {
            if (auction.highestBidder != address(0)) pendingReturns[auction.highestBidder] += auction.highestBid;
            collection.transferFrom(address(this), auction.seller, tokenId);
            emit AuctionExpired(tokenId, auction.seller);
            return;
        }

        uint256 fee = auction.highestBid * FEE_BPS / BPS_DENOMINATOR;
        _safeTransfer(auction.seller, auction.highestBid - fee);
        _safeTransfer(address(feeVault), fee);
        feeVault.recordFee(fee);
        collection.transferFrom(address(this), auction.highestBidder, tokenId);
        emit AuctionSettled(tokenId, auction.seller, auction.highestBidder, auction.highestBid);
    }

    function withdrawRefund() external nonReentrant {
        uint256 amount = pendingReturns[msg.sender];
        if (amount == 0) revert InvalidAmount();
        pendingReturns[msg.sender] = 0;
        _safeTransfer(msg.sender, amount);
        emit RefundWithdrawn(msg.sender, amount);
    }

    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata) external view returns (bytes4) {
        if (msg.sender != address(collection) || operator != address(this) || !expectingNft || from != expectedSeller || tokenId != expectedTokenId) {
            revert UnexpectedNft();
        }
        return IERC721ReceiverMinimal.onERC721Received.selector;
    }

    function _safeTransfer(address to, uint256 amount) private {
        (bool ok, bytes memory data) = address(rareToken).call(abi.encodeCall(IERC20AuctionToken.transfer, (to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = address(rareToken).call(abi.encodeCall(IERC20AuctionToken.transferFrom, (from, to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
