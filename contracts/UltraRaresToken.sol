// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Rare Token
/// @notice ERC-20 utility credits issued from verified NFT reward accrual.
/// @dev This token is not equity, a Stock Token, or a representation of any security.
contract RareToken {
    string public constant name = "Rare Token";
    string public constant symbol = "RARE";
    uint8 public constant decimals = 18;

    uint256 public immutable cap;
    uint256 public totalSupply;
    address public owner;
    address public pendingOwner;
    address public vault;
    bool public transfersEnabled;

    mapping(address account => uint256) public balanceOf;
    mapping(address account => mapping(address spender => uint256)) public allowance;

    error NotOwner();
    error NotVault();
    error ZeroAddress();
    error CapExceeded();
    error TransfersDisabled();
    error InsufficientBalance();
    error InsufficientAllowance();

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event VaultUpdated(address indexed previousVault, address indexed newVault);
    event TransfersEnabled();
    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_, uint256 cap_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        cap = cap_;
        emit OwnershipTransferred(address(0), owner_);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (!transfersEnabled) revert TransfersDisabled();
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (!transfersEnabled) revert TransfersDisabled();
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - amount;
            emit Approval(from, msg.sender, allowed - amount);
        }
        _transfer(from, to, amount);
        return true;
    }

    function mintFromVault(address to, uint256 amount) external {
        if (msg.sender != vault) revert NotVault();
        if (to == address(0)) revert ZeroAddress();
        uint256 newSupply = totalSupply + amount;
        if (newSupply > cap) revert CapExceeded();
        totalSupply = newSupply;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function burnFromVault(address from, uint256 amount) external {
        if (msg.sender != vault) revert NotVault();
        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = balance - amount;
            totalSupply -= amount;
        }
        emit Transfer(from, address(0), amount);
    }

    function setVault(address newVault) external onlyOwner {
        if (newVault == address(0)) revert ZeroAddress();
        address previous = vault;
        vault = newVault;
        emit VaultUpdated(previous, newVault);
    }

    /// @notice Irreversible. Keep disabled through the testnet and legal-review phases.
    function enableTransfersForever() external onlyOwner {
        transfersEnabled = true;
        emit TransfersEnabled();
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

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = balance - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }
}
