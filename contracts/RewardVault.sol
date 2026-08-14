// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20RewardAsset {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IERC721Collection {
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IUtilityRegistryRewards {
    function checkpointRewards(uint256 tokenId, uint128 amount) external;
    function debitRewards(uint256 tokenId, uint128 amount) external;
}

interface IUltraRaresCredit {
    function totalSupply() external view returns (uint256);
    function mintFromVault(address to, uint256 amount) external;
    function burnFromVault(address from, uint256 amount) external;
}

interface IClaimEligibility {
    function canClaim(address claimant, address rewardAsset) external view returns (bool);
}

/// @title Ultra Rares Reward Vault
/// @notice Converts registry accrual into RARE and burns RARE for inventory-backed rewards.
/// @dev Stock Tokens must be canonical, explicitly allowlisted, pre-funded, and transferable to the claimant.
contract RewardVault {
    uint256 private constant WAD = 1e18;

    IERC721Collection public immutable collection;
    IUtilityRegistryRewards public immutable registry;
    IUltraRaresCredit public immutable creditToken;
    address public owner;
    address public pendingOwner;
    address public eligibilityModule;
    bool public paused;
    uint256 private locked = 1;

    struct AssetConfig {
        bool enabled;
        uint96 unitsPerCreditWad;
        uint128 lifetimePaid;
    }

    mapping(address asset => AssetConfig) public assetConfig;

    error NotOwner();
    error NotTokenOwner();
    error ZeroAddress();
    error Paused();
    error Reentrancy();
    error InvalidAmount();
    error InvalidRate();
    error AssetDisabled();
    error ClaimantIneligible();
    error SlippageExceeded();
    error InsufficientInventory();
    error TransferFailed();
    error LifetimePaidOverflow();
    error ArrayLengthMismatch();

    event CreditsClaimed(address indexed holder, uint256 indexed tokenId, uint128 amount);
    event RewardsAccrued(uint256 indexed tokenId, uint128 amount);
    event CreditsAirdropped(address indexed recipient, uint256 amount);
    event RewardRedeemed(address indexed holder, address indexed asset, uint256 creditsBurned, uint256 assetAmount);
    event VaultFunded(address indexed funder, address indexed asset, uint256 amount);
    event AssetConfigured(address indexed asset, bool enabled, uint96 unitsPerCreditWad);
    event EligibilityModuleUpdated(address indexed previousModule, address indexed newModule);
    event PauseUpdated(bool paused);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event UnsupportedAssetRecovered(address indexed asset, address indexed recipient, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(address collection_, address registry_, address creditToken_, address owner_) {
        if (collection_ == address(0) || registry_ == address(0) || creditToken_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        collection = IERC721Collection(collection_);
        registry = IUtilityRegistryRewards(registry_);
        creditToken = IUltraRaresCredit(creditToken_);
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    /// @notice Prototype accrual entry point. Production should delegate this to a bounded keeper/oracle role.
    function accrueRewards(uint256 tokenId, uint128 amount) external onlyOwner whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        registry.checkpointRewards(tokenId, amount);
        emit RewardsAccrued(tokenId, amount);
    }

    /// @notice Mints an owner-controlled airdrop while preserving the token's fixed cap.
    function airdropCredits(address[] calldata recipients, uint256[] calldata amounts) external onlyOwner whenNotPaused {
        uint256 length = recipients.length;
        if (length != amounts.length) revert ArrayLengthMismatch();
        for (uint256 i; i < length; ++i) {
            if (recipients[i] == address(0) || amounts[i] == 0) revert InvalidAmount();
            creditToken.mintFromVault(recipients[i], amounts[i]);
            emit CreditsAirdropped(recipients[i], amounts[i]);
        }
    }

    /// @notice Converts already-accrued registry rewards into non-transferable RARE.
    function claimCredits(uint256 tokenId, uint128 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (collection.ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        registry.debitRewards(tokenId, amount);
        creditToken.mintFromVault(msg.sender, amount);
        emit CreditsClaimed(msg.sender, tokenId, amount);
    }

    /// @notice Burns RARE for an allowlisted asset already held by this vault.
    /// @dev A configured rate is administrative, not an oracle price. Production should use delayed/oracle-governed rates.
    function redeem(address asset, uint256 creditAmount, uint256 minAssetOut) external whenNotPaused nonReentrant returns (uint256 assetOut) {
        if (creditAmount == 0) revert InvalidAmount();
        AssetConfig storage config = assetConfig[asset];
        if (!config.enabled) revert AssetDisabled();
        if (eligibilityModule != address(0) && !IClaimEligibility(eligibilityModule).canClaim(msg.sender, asset)) revert ClaimantIneligible();

        assetOut = (creditAmount * uint256(config.unitsPerCreditWad)) / WAD;
        if (assetOut == 0 || assetOut < minAssetOut) revert SlippageExceeded();
        if (IERC20RewardAsset(asset).balanceOf(address(this)) < assetOut) revert InsufficientInventory();

        uint256 newLifetimePaid = uint256(config.lifetimePaid) + assetOut;
        if (newLifetimePaid > type(uint128).max) revert LifetimePaidOverflow();
        config.lifetimePaid = uint128(newLifetimePaid);
        creditToken.burnFromVault(msg.sender, creditAmount);
        _safeTransfer(asset, msg.sender, assetOut);
        emit RewardRedeemed(msg.sender, asset, creditAmount, assetOut);
    }

    function fund(address asset, uint256 amount) external nonReentrant {
        if (asset == address(0) || amount == 0) revert InvalidAmount();
        _safeTransferFrom(asset, msg.sender, address(this), amount);
        emit VaultFunded(msg.sender, asset, amount);
    }

    function previewRedeem(address asset, uint256 creditAmount) external view returns (uint256 assetOut, uint256 inventory, bool enabled) {
        AssetConfig memory config = assetConfig[asset];
        assetOut = (creditAmount * uint256(config.unitsPerCreditWad)) / WAD;
        inventory = IERC20RewardAsset(asset).balanceOf(address(this));
        enabled = config.enabled;
    }

    function configureAsset(address asset, bool enabled, uint96 unitsPerCreditWad) external onlyOwner {
        if (asset == address(0)) revert ZeroAddress();
        if (enabled && unitsPerCreditWad == 0) revert InvalidRate();
        AssetConfig storage config = assetConfig[asset];
        config.enabled = enabled;
        config.unitsPerCreditWad = unitsPerCreditWad;
        emit AssetConfigured(asset, enabled, unitsPerCreditWad);
    }

    function setEligibilityModule(address module) external onlyOwner {
        address previous = eligibilityModule;
        eligibilityModule = module;
        emit EligibilityModuleUpdated(previous, module);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PauseUpdated(paused_);
    }

    /// @notice Only disabled assets may be recovered. Enabled reward inventory cannot be withdrawn administratively.
    function recoverUnsupportedAsset(address asset, address recipient, uint256 amount) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        if (assetConfig[asset].enabled) revert AssetDisabled();
        _safeTransfer(asset, recipient, amount);
        emit UnsupportedAssetRecovered(asset, recipient, amount);
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

    function _safeTransfer(address asset, address to, uint256 amount) private {
        (bool ok, bytes memory data) = asset.call(abi.encodeCall(IERC20RewardAsset.transfer, (to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address asset, address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = asset.call(abi.encodeCall(IERC20RewardAsset.transferFrom, (from, to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
