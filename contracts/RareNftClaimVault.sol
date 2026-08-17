// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20ClaimToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IERC721ClaimCollection {
    function ownerOf(uint256 tokenId) external view returns (address);
    function totalSupply() external view returns (uint256);
}

/// @title Ultra Rares NFT Claim Vault
/// @notice Distributes pre-funded RARE inventory once per eligible Ultra Rares token ID.
/// @dev Funding requires an explicit ERC-20 approval. This vault never has blanket access to the owner's wallet.
contract RareNftClaimVault {
    IERC721ClaimCollection public immutable collection;
    IERC20ClaimToken public immutable rareToken;
    uint256 public immutable eligibleSupply;
    address public owner;
    address public pendingOwner;
    uint256 public defaultRewardPerNft;
    uint256 public configuredRewardCount;
    uint256 public configuredRewardsTotal;
    bool public allocationsLocked;
    bool public claimingEnabled;
    uint256 private locked = 1;

    mapping(uint256 tokenId => uint256 amount) private tokenReward;
    mapping(uint256 tokenId => bool configured) private tokenRewardConfigured;
    mapping(uint256 tokenId => bool hasClaimed) public claimed;

    error NotOwner();
    error NotTokenOwner(uint256 tokenId);
    error ZeroAddress();
    error InvalidAmount();
    error InvalidBatch();
    error AllocationsAlreadyLocked();
    error AllocationsNotLocked();
    error ClaimsAlreadyEnabled();
    error ClaimsNotEnabled();
    error AlreadyClaimed(uint256 tokenId);
    error NoReward(uint256 tokenId);
    error InsufficientInventory();
    error UnsupportedCollectionSupply(uint256 actualSupply);
    error CollectionSupplyChanged(uint256 actualSupply);
    error TransferFailed();
    error Reentrancy();

    event VaultFunded(address indexed funder, uint256 amount);
    event DefaultRewardUpdated(uint256 amount);
    event TokenRewardUpdated(uint256 indexed tokenId, uint256 amount);
    event AllocationsLocked();
    event ClaimsEnabled();
    event RareClaimed(address indexed holder, uint256 indexed tokenId, uint256 amount);
    event PreLaunchWithdrawal(address indexed recipient, uint256 amount);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(address collection_, address rareToken_, address owner_) {
        if (collection_ == address(0) || rareToken_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        collection = IERC721ClaimCollection(collection_);
        rareToken = IERC20ClaimToken(rareToken_);
        uint256 supply = IERC721ClaimCollection(collection_).totalSupply();
        if (supply != 420) revert UnsupportedCollectionSupply(supply);
        eligibleSupply = supply;
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    function fund(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        uint256 balanceBefore = rareToken.balanceOf(address(this));
        _safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = rareToken.balanceOf(address(this)) - balanceBefore;
        if (received == 0) revert InvalidAmount();
        emit VaultFunded(msg.sender, received);
    }

    function setDefaultReward(uint256 amount) external onlyOwner {
        if (allocationsLocked) revert AllocationsAlreadyLocked();
        defaultRewardPerNft = amount;
        emit DefaultRewardUpdated(amount);
    }

    function setTokenRewards(uint256[] calldata tokenIds, uint256[] calldata amounts) external onlyOwner {
        if (allocationsLocked) revert AllocationsAlreadyLocked();
        uint256 length = tokenIds.length;
        if (length == 0 || length != amounts.length || length > 420) revert InvalidBatch();
        for (uint256 i; i < length; ++i) {
            uint256 tokenId = tokenIds[i];
            collection.ownerOf(tokenId); // Reverts if the token does not exist.
            if (tokenRewardConfigured[tokenId]) {
                configuredRewardsTotal -= tokenReward[tokenId];
            } else {
                tokenRewardConfigured[tokenId] = true;
                configuredRewardCount += 1;
            }
            tokenReward[tokenId] = amounts[i];
            configuredRewardsTotal += amounts[i];
            emit TokenRewardUpdated(tokenId, amounts[i]);
        }
    }

    /// @notice Exact inventory needed to cover every NFT allocation.
    function requiredInventory() public view returns (uint256) {
        return defaultRewardPerNft * (eligibleSupply - configuredRewardCount) + configuredRewardsTotal;
    }

    function rewardFor(uint256 tokenId) public view returns (uint256) {
        return tokenRewardConfigured[tokenId] ? tokenReward[tokenId] : defaultRewardPerNft;
    }

    function claimable(uint256 tokenId, address holder) external view returns (uint256 amount) {
        if (collection.totalSupply() != eligibleSupply) return 0;
        if (!claimingEnabled || claimed[tokenId] || collection.ownerOf(tokenId) != holder) return 0;
        return rewardFor(tokenId);
    }

    function lockAllocations() external onlyOwner {
        if (allocationsLocked) revert AllocationsAlreadyLocked();
        allocationsLocked = true;
        emit AllocationsLocked();
    }

    /// @notice Irreversibly opens claims and permanently disables owner withdrawals.
    function enableClaimsForever() external onlyOwner {
        if (!allocationsLocked) revert AllocationsNotLocked();
        if (claimingEnabled) revert ClaimsAlreadyEnabled();
        uint256 required = requiredInventory();
        if (required == 0) revert InvalidAmount();
        if (rareToken.balanceOf(address(this)) < required) revert InsufficientInventory();
        claimingEnabled = true;
        emit ClaimsEnabled();
    }

    function claim(uint256[] calldata tokenIds) external nonReentrant returns (uint256 totalAmount) {
        if (!claimingEnabled) revert ClaimsNotEnabled();
        uint256 currentSupply = collection.totalSupply();
        if (currentSupply != eligibleSupply) revert CollectionSupplyChanged(currentSupply);
        uint256 length = tokenIds.length;
        if (length == 0 || length > 50) revert InvalidBatch();

        for (uint256 i; i < length; ++i) {
            uint256 tokenId = tokenIds[i];
            if (collection.ownerOf(tokenId) != msg.sender) revert NotTokenOwner(tokenId);
            if (claimed[tokenId]) revert AlreadyClaimed(tokenId);
            uint256 amount = rewardFor(tokenId);
            if (amount == 0) revert NoReward(tokenId);
            claimed[tokenId] = true;
            totalAmount += amount;
            emit RareClaimed(msg.sender, tokenId, amount);
        }

        if (rareToken.balanceOf(address(this)) < totalAmount) revert InsufficientInventory();
        _safeTransfer(msg.sender, totalAmount);
    }

    /// @notice Recovers mistaken or test funding only before claims are irreversibly enabled.
    function withdrawBeforeLaunch(address recipient, uint256 amount) external onlyOwner nonReentrant {
        if (claimingEnabled) revert ClaimsAlreadyEnabled();
        if (recipient == address(0) || amount == 0) revert InvalidAmount();
        _safeTransfer(recipient, amount);
        emit PreLaunchWithdrawal(recipient, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        address previous = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, msg.sender);
    }

    function _safeTransfer(address to, uint256 amount) private {
        (bool ok, bytes memory data) = address(rareToken).call(abi.encodeCall(IERC20ClaimToken.transfer, (to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = address(rareToken).call(abi.encodeCall(IERC20ClaimToken.transferFrom, (from, to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
