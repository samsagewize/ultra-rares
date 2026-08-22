// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20LaunchVault {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title Rares Launch Fee Vault
/// @notice Custodies the exact 3% vault share of launch-token trading fees in $RARE.
contract RareLaunchFeeVault {
    uint256 public constant BPS = 10_000;
    uint256 public constant VAULT_SHARE_BPS = 300;

    IERC20LaunchVault public immutable rareToken;
    address public immutable withdrawalDestination;
    address public owner;
    address public pendingOwner;
    bool public sourcesLocked;
    uint256 public totalAccounted;
    uint256 public totalReleased;
    uint256 public totalDonations;
    uint256 public authorizedSourceCount;
    uint256 private locked = 1;

    mapping(address source => bool authorized) public feeSources;
    mapping(address source => uint256 amount) public accountedBySource;
    mapping(address launchToken => uint256 amount) public accountedByLaunchToken;

    error NotOwner(); error NotFeeSource(); error ZeroAddress(); error InvalidAmount();
    error SourcesAlreadyLocked(); error SourcesNotLocked(); error FeeNotReceived();
    error InsufficientReserve(); error TransferFailed(); error Reentrancy();

    event FeeSourceUpdated(address indexed source, bool authorized);
    event SourcesLocked();
    event VaultFeeRecorded(address indexed source, address indexed launchToken, address indexed creator, uint256 grossTradeFee, uint256 vaultShare);
    event DonationAccounted(address indexed donor, uint256 amount);
    event Released(address indexed destination, uint256 amount);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    modifier nonReentrant() { if (locked != 1) revert Reentrancy(); locked = 2; _; locked = 1; }

    constructor(address rareToken_, address owner_, address withdrawalDestination_) {
        if (rareToken_ == address(0) || owner_ == address(0) || withdrawalDestination_ == address(0)) revert ZeroAddress();
        rareToken = IERC20LaunchVault(rareToken_);
        owner = owner_;
        withdrawalDestination = withdrawalDestination_;
        emit OwnershipTransferred(address(0), owner_);
    }

    function availableReserve() public view returns (uint256) {
        return totalAccounted - totalReleased;
    }

    function setFeeSource(address source, bool authorized) external onlyOwner {
        if (sourcesLocked) revert SourcesAlreadyLocked();
        if (source == address(0)) revert ZeroAddress();
        if (feeSources[source] != authorized) {
            if (authorized) authorizedSourceCount += 1;
            else authorizedSourceCount -= 1;
        }
        feeSources[source] = authorized;
        emit FeeSourceUpdated(source, authorized);
    }

    /// @notice Irreversibly freezes the launch factories allowed to record deposits.
    function lockFeeSources() external onlyOwner {
        if (sourcesLocked) revert SourcesAlreadyLocked();
        if (authorizedSourceCount == 0) revert NotFeeSource();
        sourcesLocked = true;
        emit SourcesLocked();
    }

    /// @notice Called only after an authorized factory transfers the vault share here.
    function recordFee(address launchToken, address creator, uint256 grossTradeFee, uint256 vaultShare) external {
        if (!feeSources[msg.sender]) revert NotFeeSource();
        if (!sourcesLocked) revert SourcesNotLocked();
        if (launchToken == address(0) || creator == address(0)) revert ZeroAddress();
        uint256 expected = grossTradeFee * VAULT_SHARE_BPS / BPS;
        if (grossTradeFee == 0 || expected == 0 || vaultShare != expected) revert InvalidAmount();
        if (rareToken.balanceOf(address(this)) < availableReserve() + vaultShare) revert FeeNotReceived();
        totalAccounted += vaultShare;
        accountedBySource[msg.sender] += vaultShare;
        accountedByLaunchToken[launchToken] += vaultShare;
        emit VaultFeeRecorded(msg.sender, launchToken, creator, grossTradeFee, vaultShare);
    }

    /// @notice Accounts $RARE sent directly to the vault so it remains withdrawable and auditable.
    function accountDonation(uint256 amount) external onlyOwner {
        if (amount == 0 || rareToken.balanceOf(address(this)) < availableReserve() + amount) revert FeeNotReceived();
        totalDonations += amount;
        totalAccounted += amount;
        emit DonationAccounted(msg.sender, amount);
    }

    /// @notice Releases accounted $RARE only to the immutable treasury destination.
    function release(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0 || amount > availableReserve()) revert InsufficientReserve();
        totalReleased += amount;
        _safeTransfer(withdrawalDestination, amount);
        emit Released(withdrawalDestination, amount);
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
        uint256 beforeBalance = rareToken.balanceOf(to);
        (bool ok, bytes memory data) = address(rareToken).call(abi.encodeCall(IERC20LaunchVault.transfer, (to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool))) || rareToken.balanceOf(to) - beforeBalance != amount) revert TransferFailed();
    }
}
