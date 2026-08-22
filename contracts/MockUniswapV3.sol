// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMockV3ERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IMockV3Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data) external returns (bytes4);
}

contract MockV3Pool {
    uint160 public sqrtPriceX96;
    constructor(uint160 price) { sqrtPriceX96 = price; }
    function setPrice(uint160 price) external { sqrtPriceX96 = price; }
    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (sqrtPriceX96, 0, 0, 0, 0, 0, true);
    }
}

contract MockV3Factory {
    mapping(bytes32 key => address pool) private pools;
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address) {
        return pools[keccak256(abi.encode(tokenA, tokenB, fee))];
    }
    function createPool(address token0, address token1, uint24 fee, uint160 price) external returns (address pool) {
        bytes32 key = keccak256(abi.encode(token0, token1, fee));
        require(pools[key] == address(0), "exists");
        pool = address(new MockV3Pool(price));
        pools[key] = pool;
    }
}

contract MockPositionManager {
    struct MintParams { address token0; address token1; uint24 fee; int24 tickLower; int24 tickUpper; uint256 amount0Desired; uint256 amount1Desired; uint256 amount0Min; uint256 amount1Min; address recipient; uint256 deadline; }
    struct CollectParams { uint256 tokenId; address recipient; uint128 amount0Max; uint128 amount1Max; }
    address public immutable factory;
    address public immutable WETH9;
    uint256 public nextTokenId = 1;
    mapping(uint256 tokenId => address owner) public ownerOf;

    constructor(address factory_, address weth_) { factory = factory_; WETH9 = weth_; }

    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 price) external returns (address pool) {
        pool = MockV3Factory(factory).getPool(token0, token1, fee);
        if (pool == address(0)) pool = MockV3Factory(factory).createPool(token0, token1, fee, price);
    }

    function mint(MintParams calldata params) external returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1) {
        require(block.timestamp <= params.deadline, "expired");
        amount0 = params.amount0Desired;
        amount1 = params.amount1Desired;
        require(amount0 >= params.amount0Min && amount1 >= params.amount1Min, "minimum");
        require(IMockV3ERC20(params.token0).transferFrom(msg.sender, address(this), amount0), "token0");
        require(IMockV3ERC20(params.token1).transferFrom(msg.sender, address(this), amount1), "token1");
        tokenId = nextTokenId++;
        liquidity = uint128(amount0 < amount1 ? amount0 : amount1);
        ownerOf[tokenId] = params.recipient;
        require(IMockV3Receiver(params.recipient).onERC721Received(msg.sender, address(0), tokenId, "") == IMockV3Receiver.onERC721Received.selector, "receiver");
    }

    function collect(CollectParams calldata) external pure returns (uint256 amount0, uint256 amount1) { return (0, 0); }
}
