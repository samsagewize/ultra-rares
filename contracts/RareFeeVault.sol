// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20FeeToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title Ultra Rares marketplace fee vault
/// @notice Accounts marketplace fees 50/50 between holder rewards and liquidity/buybacks.
contract RareFeeVault {
    IERC20FeeToken public immutable rareToken;
    address public owner;
    address public pendingOwner;
    address public claimDestination;
    address public liquidityDestination;
    bool public configurationLocked;
    uint256 public claimReserve;
    uint256 public liquidityReserve;
    uint256 public totalAccounted;
    uint256 private locked = 1;

    mapping(address source => bool authorized) public feeSources;

    error NotOwner();
    error NotFeeSource();
    error ZeroAddress();
    error InvalidAmount();
    error ConfigurationAlreadyLocked();
    error ConfigurationNotLocked();
    error InsufficientReserve();
    error FeeNotReceived();
    error TransferFailed();
    error Reentrancy();

    event FeeSourceUpdated(address indexed source, bool authorized);
    event DestinationsUpdated(address indexed claimDestination, address indexed liquidityDestination);
    event ConfigurationLocked();
    event FeeRecorded(address indexed source, uint256 totalFee, uint256 claimShare, uint256 liquidityShare);
    event ClaimReserveReleased(address indexed destination, uint256 amount);
    event LiquidityReserveReleased(address indexed destination, uint256 amount);
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

    constructor(address rareToken_, address owner_) {
        if (rareToken_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        rareToken = IERC20FeeToken(rareToken_);
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    function setFeeSource(address source, bool authorized) external onlyOwner {
        if (configurationLocked) revert ConfigurationAlreadyLocked();
        if (source == address(0)) revert ZeroAddress();
        feeSources[source] = authorized;
        emit FeeSourceUpdated(source, authorized);
    }

    function setDestinations(address claimDestination_, address liquidityDestination_) external onlyOwner {
        if (configurationLocked) revert ConfigurationAlreadyLocked();
        if (claimDestination_ == address(0) || liquidityDestination_ == address(0)) revert ZeroAddress();
        claimDestination = claimDestination_;
        liquidityDestination = liquidityDestination_;
        emit DestinationsUpdated(claimDestination_, liquidityDestination_);
    }

    function lockConfiguration() external onlyOwner {
        if (configurationLocked) revert ConfigurationAlreadyLocked();
        if (claimDestination == address(0) || liquidityDestination == address(0)) revert ZeroAddress();
        configurationLocked = true;
        emit ConfigurationLocked();
    }

    /// @notice Called after an authorized market transfers the fee into this vault.
    function recordFee(uint256 amount) external {
        if (!feeSources[msg.sender]) revert NotFeeSource();
        if (!configurationLocked) revert ConfigurationNotLocked();
        if (amount == 0) revert InvalidAmount();
        if (rareToken.balanceOf(address(this)) < totalAccounted + amount) revert FeeNotReceived();
        uint256 claimShare = amount / 2;
        uint256 liquidityShare = amount - claimShare;
        claimReserve += claimShare;
        liquidityReserve += liquidityShare;
        totalAccounted += amount;
        emit FeeRecorded(msg.sender, amount, claimShare, liquidityShare);
    }

    function releaseClaims(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0 || amount > claimReserve) revert InsufficientReserve();
        claimReserve -= amount;
        totalAccounted -= amount;
        _safeTransfer(claimDestination, amount);
        emit ClaimReserveReleased(claimDestination, amount);
    }

    function releaseLiquidity(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0 || amount > liquidityReserve) revert InsufficientReserve();
        liquidityReserve -= amount;
        totalAccounted -= amount;
        _safeTransfer(liquidityDestination, amount);
        emit LiquidityReserveReleased(liquidityDestination, amount);
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
        (bool ok, bytes memory data) = address(rareToken).call(abi.encodeCall(IERC20FeeToken.transfer, (to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
