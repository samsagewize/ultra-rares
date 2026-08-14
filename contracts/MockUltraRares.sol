// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockUltraRares {
    mapping(uint256 tokenId => address) private owners;

    function mint(address to, uint256 tokenId) external {
        owners[tokenId] = to;
    }

    function transfer(uint256 tokenId, address to) external {
        require(owners[tokenId] == msg.sender, "not owner");
        owners[tokenId] = to;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address tokenOwner = owners[tokenId];
        require(tokenOwner != address(0), "not minted");
        return tokenOwner;
    }
}
