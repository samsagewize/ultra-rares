// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDepositPilotNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
}

contract UltraRareDepositPilot {
    error Unauthorized();
    error InvalidAmount();
    error TransferFailed();
    error Reentrancy();

    IDepositPilotNFT public immutable collection;
    uint256 public immutable tokenId;
    uint256 private locked = 1;

    event Deposited(address indexed owner, uint256 amount, uint256 balance);
    event Withdrawn(address indexed owner, address indexed recipient, uint256 amount);

    constructor(address collection_, uint256 tokenId_) {
        if (collection_ == address(0)) revert Unauthorized();
        collection = IDepositPilotNFT(collection_);
        tokenId = tokenId_;
        collection.ownerOf(tokenId_);
    }

    receive() external payable {
        _deposit();
    }

    modifier onlyNftOwner() {
        if (msg.sender != collection.ownerOf(tokenId)) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    function deposit() external payable {
        _deposit();
    }

    function withdrawAll(address payable recipient) external onlyNftOwner nonReentrant {
        if (recipient == address(0)) revert Unauthorized();
        uint256 amount = address(this).balance;
        if (amount == 0) revert InvalidAmount();
        (bool sent,) = recipient.call{value: amount}("");
        if (!sent) revert TransferFailed();
        emit Withdrawn(msg.sender, recipient, amount);
    }

    function _deposit() private onlyNftOwner {
        if (msg.value == 0) revert InvalidAmount();
        emit Deposited(msg.sender, msg.value, address(this).balance);
    }
}

contract UltraRareDepositPilotFactory {
    error Unauthorized();
    error AlreadyActivated();

    IDepositPilotNFT public immutable collection;
    mapping(uint256 => address) public pilotOf;

    event PilotActivated(uint256 indexed tokenId, address indexed owner, address pilot);

    constructor(address collection_) {
        if (collection_ == address(0)) revert Unauthorized();
        collection = IDepositPilotNFT(collection_);
    }

    function activate(uint256 tokenId) external returns (address pilot) {
        if (collection.ownerOf(tokenId) != msg.sender) revert Unauthorized();
        if (pilotOf[tokenId] != address(0)) revert AlreadyActivated();
        pilot = address(new UltraRareDepositPilot{salt: bytes32(tokenId)}(address(collection), tokenId));
        pilotOf[tokenId] = pilot;
        emit PilotActivated(tokenId, msg.sender, pilot);
    }
}
