// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockUltraRares {
    mapping(uint256 tokenId => address) private owners;
    mapping(uint256 tokenId => address) private approvals;

    function mint(address to, uint256 tokenId) external {
        owners[tokenId] = to;
    }

    function transfer(uint256 tokenId, address to) external {
        require(owners[tokenId] == msg.sender, "not owner");
        owners[tokenId] = to;
    }

    function approve(address to, uint256 tokenId) external {
        require(owners[tokenId] == msg.sender, "not owner");
        approvals[tokenId] = to;
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(owners[tokenId] == from, "wrong owner");
        require(msg.sender == from || approvals[tokenId] == msg.sender, "not approved");
        owners[tokenId] = to;
        approvals[tokenId] = address(0);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        transferFrom(from, to, tokenId);
        if (to.code.length != 0) {
            (bool ok, bytes memory data) = to.call(abi.encodeWithSignature(
                "onERC721Received(address,address,uint256,bytes)", msg.sender, from, tokenId, ""
            ));
            require(ok && data.length >= 32 && abi.decode(data, (bytes4)) == 0x150b7a02, "unsafe receiver");
        }
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address tokenOwner = owners[tokenId];
        require(tokenOwner != address(0), "not minted");
        return tokenOwner;
    }
}
