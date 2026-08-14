// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC721Owner {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title Ultra Rares Utility Registry
/// @notice Stores opt-in utility state without modifying or taking custody of the original NFT.
/// @dev Reward accounting is recorded by a separately configured vault. This contract holds no funds.
contract UtilityRegistry {
    uint8 public constant MAX_TIER = 4;
    uint8 public constant MAX_REWARD_ASSETS = 3;

    IERC721Owner public immutable collection;
    address public owner;
    address public pendingOwner;
    address public rewardVault;
    address public fusionController;
    bool public paused;

    struct UtilityState {
        bool activated;
        uint8 tier;
        uint40 activatedAt;
        uint40 lastAccrualAt;
        uint128 accruedRewards;
        address linkedAccount;
    }

    struct FusionRecord {
        uint256 sourceTokenA;
        uint256 sourceTokenB;
        uint256 sourceTokenC;
        uint256 resultingTokenId;
        uint40 fusedAt;
        uint16 bonusBps;
        address controller;
    }

    mapping(uint256 tokenId => UtilityState) private utility;
    mapping(uint256 tokenId => address[]) private rewardAssets;
    mapping(uint256 tokenId => FusionRecord[]) private fusionHistory;
    mapping(address asset => bool) public allowedRewardAsset;

    error NotOwner();
    error NotTokenOwner();
    error NotRewardVault();
    error NotFusionController();
    error ZeroAddress();
    error Paused();
    error AlreadyActivated();
    error NotActivated();
    error InvalidTier();
    error InvalidAssetCount();
    error AssetNotAllowed(address asset);
    error DuplicateAsset(address asset);
    error RewardOverflow();

    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event RewardVaultUpdated(address indexed previousVault, address indexed newVault);
    event FusionControllerUpdated(address indexed previousController, address indexed newController);
    event RewardAssetPermissionUpdated(address indexed asset, bool allowed);
    event PauseUpdated(bool paused);
    event Activated(uint256 indexed tokenId, address indexed holder, address indexed linkedAccount, uint8 tier);
    event LinkedAccountUpdated(uint256 indexed tokenId, address indexed previousAccount, address indexed newAccount);
    event RewardAssetsSelected(uint256 indexed tokenId, address[] assets);
    event TierUpdated(uint256 indexed tokenId, uint8 previousTier, uint8 newTier);
    event RewardsCheckpointed(uint256 indexed tokenId, uint128 amount, uint128 totalAccrued, uint40 checkpointAt);
    event RewardsDebited(uint256 indexed tokenId, uint128 amount, uint128 remainingAccrued);
    event FusionRecorded(uint256 indexed resultingTokenId, uint256 indexed sourceTokenA, uint256 indexed sourceTokenB, uint256 sourceTokenC, uint16 bonusBps);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor(address collection_, address owner_) {
        if (collection_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        collection = IERC721Owner(collection_);
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    function activate(uint256 tokenId, address linkedAccount) external whenNotPaused {
        if (collection.ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (linkedAccount == address(0)) revert ZeroAddress();
        UtilityState storage state = utility[tokenId];
        if (state.activated) revert AlreadyActivated();

        state.activated = true;
        state.tier = 1;
        state.activatedAt = uint40(block.timestamp);
        state.lastAccrualAt = uint40(block.timestamp);
        state.linkedAccount = linkedAccount;
        emit Activated(tokenId, msg.sender, linkedAccount, 1);
    }

    function selectRewardAssets(uint256 tokenId, address[] calldata assets) external whenNotPaused {
        if (collection.ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (!utility[tokenId].activated) revert NotActivated();
        if (assets.length == 0 || assets.length > MAX_REWARD_ASSETS) revert InvalidAssetCount();

        delete rewardAssets[tokenId];
        for (uint256 i; i < assets.length; ++i) {
            address asset = assets[i];
            if (!allowedRewardAsset[asset]) revert AssetNotAllowed(asset);
            for (uint256 j; j < i; ++j) {
                if (assets[j] == asset) revert DuplicateAsset(asset);
            }
            rewardAssets[tokenId].push(asset);
        }
        emit RewardAssetsSelected(tokenId, assets);
    }

    function setLinkedAccount(uint256 tokenId, address linkedAccount) external onlyOwner {
        if (linkedAccount == address(0)) revert ZeroAddress();
        UtilityState storage state = utility[tokenId];
        if (!state.activated) revert NotActivated();
        address previous = state.linkedAccount;
        state.linkedAccount = linkedAccount;
        emit LinkedAccountUpdated(tokenId, previous, linkedAccount);
    }

    function setTier(uint256 tokenId, uint8 newTier) external whenNotPaused {
        if (msg.sender != rewardVault && msg.sender != fusionController) revert NotRewardVault();
        if (newTier == 0 || newTier > MAX_TIER) revert InvalidTier();
        UtilityState storage state = utility[tokenId];
        if (!state.activated) revert NotActivated();
        uint8 previous = state.tier;
        state.tier = newTier;
        emit TierUpdated(tokenId, previous, newTier);
    }

    function checkpointRewards(uint256 tokenId, uint128 amount) external whenNotPaused {
        if (msg.sender != rewardVault) revert NotRewardVault();
        UtilityState storage state = utility[tokenId];
        if (!state.activated) revert NotActivated();
        uint128 total;
        unchecked { total = state.accruedRewards + amount; }
        if (total < state.accruedRewards) revert RewardOverflow();
        state.accruedRewards = total;
        state.lastAccrualAt = uint40(block.timestamp);
        emit RewardsCheckpointed(tokenId, amount, total, state.lastAccrualAt);
    }

    function debitRewards(uint256 tokenId, uint128 amount) external whenNotPaused {
        if (msg.sender != rewardVault) revert NotRewardVault();
        UtilityState storage state = utility[tokenId];
        state.accruedRewards -= amount;
        emit RewardsDebited(tokenId, amount, state.accruedRewards);
    }

    function recordFusion(
        uint256 resultingTokenId,
        uint256 sourceTokenA,
        uint256 sourceTokenB,
        uint256 sourceTokenC,
        uint16 bonusBps
    ) external whenNotPaused {
        if (msg.sender != fusionController) revert NotFusionController();
        fusionHistory[resultingTokenId].push(FusionRecord({
            sourceTokenA: sourceTokenA,
            sourceTokenB: sourceTokenB,
            sourceTokenC: sourceTokenC,
            resultingTokenId: resultingTokenId,
            fusedAt: uint40(block.timestamp),
            bonusBps: bonusBps,
            controller: msg.sender
        }));
        emit FusionRecorded(resultingTokenId, sourceTokenA, sourceTokenB, sourceTokenC, bonusBps);
    }

    function getUtilityState(uint256 tokenId) external view returns (UtilityState memory) {
        return utility[tokenId];
    }

    function getRewardAssets(uint256 tokenId) external view returns (address[] memory) {
        return rewardAssets[tokenId];
    }

    function getFusionHistory(uint256 tokenId) external view returns (FusionRecord[] memory) {
        return fusionHistory[tokenId];
    }

    function setRewardAssetAllowed(address asset, bool allowed) external onlyOwner {
        if (asset == address(0)) revert ZeroAddress();
        allowedRewardAsset[asset] = allowed;
        emit RewardAssetPermissionUpdated(asset, allowed);
    }

    function setRewardVault(address newVault) external onlyOwner {
        if (newVault == address(0)) revert ZeroAddress();
        address previous = rewardVault;
        rewardVault = newVault;
        emit RewardVaultUpdated(previous, newVault);
    }

    function setFusionController(address newController) external onlyOwner {
        if (newController == address(0)) revert ZeroAddress();
        address previous = fusionController;
        fusionController = newController;
        emit FusionControllerUpdated(previous, newController);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PauseUpdated(paused_);
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
}
