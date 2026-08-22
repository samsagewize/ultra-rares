// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20RenameToken {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IERC721RenameCollection {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title Ultra Rares Rename Registry
/// @notice Burns RARE and records administrator-authorized rename requests for manual metadata updates.
contract RareRenameRegistry {
    uint256 public constant RENAME_VERSION = 2;
    uint256 public constant RENAME_COST = 30_000 ether;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    struct RenameRequest {
        address requester;
        string requestedName;
        bool pending;
    }

    IERC721RenameCollection public immutable collection;
    IERC20RenameToken public immutable rareToken;
    address public immutable admin;
    mapping(uint256 tokenId => RenameRequest) public requests;

    error InvalidName();
    error RequestPending();
    error TransferFailed();
    error NotAdmin();
    error RequestUnavailable();

    event RenameRequested(uint256 indexed tokenId, address indexed requester, string requestedName, uint256 burnedAmount);
    event RenameCompleted(uint256 indexed tokenId, address indexed requester, string completedName);
    event StaleRenameCleared(uint256 indexed tokenId, address indexed previousRequester);

    constructor(address collection_, address rareToken_, address admin_) {
        if (collection_ == address(0) || rareToken_ == address(0) || admin_ == address(0)) revert InvalidName();
        collection = IERC721RenameCollection(collection_);
        rareToken = IERC20RenameToken(rareToken_);
        admin = admin_;
    }

    function requestRename(uint256 tokenId, string calldata requestedName) external {
        if (msg.sender != admin) revert NotAdmin();
        collection.ownerOf(tokenId);
        RenameRequest storage existingRequest = requests[tokenId];
        if (existingRequest.pending) revert RequestPending();
        _validateName(requestedName);

        requests[tokenId] = RenameRequest({ requester: msg.sender, requestedName: requestedName, pending: true });
        if (!rareToken.transferFrom(msg.sender, BURN_ADDRESS, RENAME_COST)) revert TransferFailed();
        emit RenameRequested(tokenId, msg.sender, requestedName, RENAME_COST);
    }

    function completeRename(uint256 tokenId) external {
        if (msg.sender != admin) revert NotAdmin();
        RenameRequest storage request = requests[tokenId];
        if (!request.pending) revert RequestUnavailable();
        request.pending = false;
        emit RenameCompleted(tokenId, request.requester, request.requestedName);
    }

    /// @notice Allows only the administrator to cancel a pending request before metadata is changed.
    function clearStaleRequest(uint256 tokenId) external {
        if (msg.sender != admin) revert NotAdmin();
        RenameRequest storage request = requests[tokenId];
        if (!request.pending) revert RequestUnavailable();
        address previousRequester = request.requester;
        delete requests[tokenId];
        emit StaleRenameCleared(tokenId, previousRequester);
    }

    function _validateName(string calldata requestedName) private pure {
        bytes calldata value = bytes(requestedName);
        if (value.length == 0 || value.length > 24) revert InvalidName();
        for (uint256 index; index < value.length; ++index) {
            if (value[index] < 0x20 || value[index] > 0x7E) revert InvalidName();
        }
    }
}
