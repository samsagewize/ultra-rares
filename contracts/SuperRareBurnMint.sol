// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20SuperRarePayment {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IERC721ReceiverSuperRare {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data) external returns (bytes4);
}

/// @title Super Rare — RARE Burn Mint
/// @notice A separate ERC-721 collection permanently linked to the original Super Rare ERC-1155.
contract SuperRareBurnMint {
    string public constant name = "Super Rare Burn Mint";
    string public constant symbol = "SUPER";
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    struct Drop { uint128 rareCost; bool published; string metadataUri; }

    address public immutable parentCollection;
    IERC20SuperRarePayment public immutable rareToken;
    uint256 public immutable maxSupply;
    address public admin;
    address public pendingAdmin;
    uint256 public totalSupply;
    uint256 public totalRareBurned;
    bool public paused;

    mapping(uint256 tokenId => Drop) private drops;
    mapping(uint256 tokenId => address) private owners;
    mapping(address owner => uint256) private balances;
    mapping(uint256 tokenId => address) private tokenApprovals;
    mapping(address owner => mapping(address operator => bool)) private operatorApprovals;
    uint256 private locked = 1;

    error NotAdmin(); error NotPendingAdmin(); error InvalidConfiguration(); error InvalidDrop();
    error DropUnavailable(); error MintPaused(); error AlreadyMinted(); error NonexistentToken();
    error NotAuthorized(); error InvalidRecipient(); error UnsafeRecipient(); error TransferFailed(); error Reentrancy();

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event DropPublished(uint256 indexed tokenId, uint256 rareCost, string metadataUri);
    event DropRemoved(uint256 indexed tokenId);
    event SuperRareMinted(uint256 indexed tokenId, address indexed collector, uint256 rareBurned, address indexed parentCollection);
    event PauseChanged(bool paused);
    event AdminTransferStarted(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    modifier onlyAdmin() { if (msg.sender != admin) revert NotAdmin(); _; }
    modifier nonReentrant() { if (locked != 1) revert Reentrancy(); locked = 2; _; locked = 1; }

    constructor(address parentCollection_, address rareToken_, address admin_, uint256 maxSupply_) {
        if (parentCollection_ == address(0) || rareToken_ == address(0) || admin_ == address(0) || maxSupply_ == 0) revert InvalidConfiguration();
        parentCollection = parentCollection_;
        rareToken = IERC20SuperRarePayment(rareToken_);
        admin = admin_;
        maxSupply = maxSupply_;
    }

    function publishDrop(uint256 tokenId, uint256 rareCost, string calldata metadataUri) external onlyAdmin {
        if (tokenId == 0 || tokenId > maxSupply || rareCost == 0 || rareCost > type(uint128).max || bytes(metadataUri).length == 0) revert InvalidDrop();
        if (owners[tokenId] != address(0)) revert AlreadyMinted();
        drops[tokenId] = Drop(uint128(rareCost), true, metadataUri);
        emit DropPublished(tokenId, rareCost, metadataUri);
    }

    function removeDrop(uint256 tokenId) external onlyAdmin {
        if (!drops[tokenId].published || owners[tokenId] != address(0)) revert DropUnavailable();
        delete drops[tokenId];
        emit DropRemoved(tokenId);
    }

    function setPaused(bool value) external onlyAdmin { paused = value; emit PauseChanged(value); }

    function mint(uint256 tokenId) external nonReentrant {
        if (paused) revert MintPaused();
        Drop storage drop = drops[tokenId];
        if (!drop.published) revert DropUnavailable();
        if (owners[tokenId] != address(0)) revert AlreadyMinted();
        uint256 cost = uint256(drop.rareCost);
        drop.published = false;
        owners[tokenId] = msg.sender;
        balances[msg.sender] += 1;
        totalSupply += 1;
        totalRareBurned += cost;
        uint256 burnBalanceBefore = rareToken.balanceOf(BURN_ADDRESS);
        _safeTransferFrom(msg.sender, BURN_ADDRESS, cost);
        if (rareToken.balanceOf(BURN_ADDRESS) - burnBalanceBefore != cost) revert TransferFailed();
        emit Transfer(address(0), msg.sender, tokenId);
        emit SuperRareMinted(tokenId, msg.sender, cost, parentCollection);
        _checkOnERC721Received(address(0), msg.sender, tokenId, "");
    }

    function dropInfo(uint256 tokenId) external view returns (uint256 rareCost, bool published, bool minted, string memory metadataUri) {
        Drop storage drop = drops[tokenId];
        return (uint256(drop.rareCost), drop.published, owners[tokenId] != address(0), drop.metadataUri);
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        if (owners[tokenId] == address(0)) revert NonexistentToken();
        return drops[tokenId].metadataUri;
    }

    function ownerOf(uint256 tokenId) public view returns (address owner) { owner = owners[tokenId]; if (owner == address(0)) revert NonexistentToken(); }
    function balanceOf(address owner) external view returns (uint256) { if (owner == address(0)) revert InvalidRecipient(); return balances[owner]; }

    function approve(address approved, uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        if (msg.sender != owner && !operatorApprovals[owner][msg.sender]) revert NotAuthorized();
        tokenApprovals[tokenId] = approved;
        emit Approval(owner, approved, tokenId);
    }

    function getApproved(uint256 tokenId) external view returns (address) { ownerOf(tokenId); return tokenApprovals[tokenId]; }
    function setApprovalForAll(address operator, bool approved) external { if (operator == msg.sender) revert NotAuthorized(); operatorApprovals[msg.sender][operator] = approved; emit ApprovalForAll(msg.sender, operator, approved); }
    function isApprovedForAll(address owner, address operator) external view returns (bool) { return operatorApprovals[owner][operator]; }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (to == address(0)) revert InvalidRecipient();
        address owner = ownerOf(tokenId);
        if (owner != from || !_isAuthorized(owner, msg.sender, tokenId)) revert NotAuthorized();
        delete tokenApprovals[tokenId];
        balances[from] -= 1;
        balances[to] += 1;
        owners[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external { safeTransferFrom(from, to, tokenId, ""); }
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public { transferFrom(from, to, tokenId); _checkOnERC721Received(from, to, tokenId, data); }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) { return interfaceId == 0x01ffc9a7 || interfaceId == 0x80ac58cd || interfaceId == 0x5b5e139f; }

    function beginAdminTransfer(address nextAdmin) external onlyAdmin { if (nextAdmin == address(0)) revert InvalidRecipient(); pendingAdmin = nextAdmin; emit AdminTransferStarted(admin, nextAdmin); }
    function acceptAdmin() external { if (msg.sender != pendingAdmin) revert NotPendingAdmin(); address previous = admin; admin = msg.sender; pendingAdmin = address(0); emit AdminTransferred(previous, msg.sender); }

    function _isAuthorized(address owner, address caller, uint256 tokenId) private view returns (bool) { return caller == owner || tokenApprovals[tokenId] == caller || operatorApprovals[owner][caller]; }
    function _safeTransferFrom(address from, address to, uint256 amount) private {
        (bool ok, bytes memory output) = address(rareToken).call(abi.encodeCall(IERC20SuperRarePayment.transferFrom, (from, to, amount)));
        if (!ok || (output.length != 0 && !abi.decode(output, (bool)))) revert TransferFailed();
    }
    function _checkOnERC721Received(address from, address to, uint256 tokenId, bytes memory data) private {
        if (to.code.length == 0) return;
        try IERC721ReceiverSuperRare(to).onERC721Received(msg.sender, from, tokenId, data) returns (bytes4 value) {
            if (value != IERC721ReceiverSuperRare.onERC721Received.selector) revert UnsafeRecipient();
        } catch { revert UnsafeRecipient(); }
    }
}
