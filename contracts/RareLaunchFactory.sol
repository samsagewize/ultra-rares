// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20LaunchPayment {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IWethLaunch is IERC20LaunchPayment {
    function deposit() external payable;
}

interface IUniswapV3FactoryLaunch {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3PoolLaunch {
    function slot0() external view returns (uint160 sqrtPriceX96, int24, uint16, uint16, uint16, uint8, bool);
}

interface INonfungiblePositionManagerLaunch {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }
    struct CollectParams { uint256 tokenId; address recipient; uint128 amount0Max; uint128 amount1Max; }
    function factory() external view returns (address);
    function WETH9() external view returns (address);
    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool);
    function mint(MintParams calldata params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1);
}

contract RareV3LiquidityLocker {
    uint256 private constant BPS = 10_000;
    uint256 private constant CREATOR_SHARE = 9_700;
    address public immutable migrator;
    address public immutable positionManager;
    address public immutable vault;
    mapping(uint256 tokenId => address creator) public creatorOf;
    mapping(uint256 tokenId => address token0) public token0Of;
    mapping(uint256 tokenId => address token1) public token1Of;

    error NotMigrator();
    error InvalidPosition();
    error TransferFailed();

    event PositionLocked(uint256 indexed tokenId, address indexed creator, address token0, address token1);
    event FeesDistributed(uint256 indexed tokenId, uint256 creatorAmount0, uint256 creatorAmount1, uint256 vaultAmount0, uint256 vaultAmount1);

    constructor(address positionManager_, address vault_) {
        if (positionManager_ == address(0) || vault_ == address(0)) revert InvalidPosition();
        migrator = msg.sender;
        positionManager = positionManager_;
        vault = vault_;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        if (msg.sender != positionManager) revert InvalidPosition();
        return this.onERC721Received.selector;
    }

    function register(uint256 tokenId, address creator, address token0, address token1) external {
        if (msg.sender != migrator) revert NotMigrator();
        if (creator == address(0) || creatorOf[tokenId] != address(0)) revert InvalidPosition();
        creatorOf[tokenId] = creator;
        token0Of[tokenId] = token0;
        token1Of[tokenId] = token1;
        emit PositionLocked(tokenId, creator, token0, token1);
    }

    function distributeFees(uint256 tokenId) external {
        address creator = creatorOf[tokenId];
        if (creator == address(0)) revert InvalidPosition();
        (uint256 amount0, uint256 amount1) = INonfungiblePositionManagerLaunch(positionManager).collect(
            INonfungiblePositionManagerLaunch.CollectParams(tokenId, address(this), type(uint128).max, type(uint128).max)
        );
        uint256 creator0 = amount0 * CREATOR_SHARE / BPS;
        uint256 creator1 = amount1 * CREATOR_SHARE / BPS;
        _send(token0Of[tokenId], creator, creator0);
        _send(token1Of[tokenId], creator, creator1);
        _send(token0Of[tokenId], vault, amount0 - creator0);
        _send(token1Of[tokenId], vault, amount1 - creator1);
        emit FeesDistributed(tokenId, creator0, creator1, amount0 - creator0, amount1 - creator1);
    }

    function _send(address token, address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, bytes memory output) = token.call(abi.encodeCall(IERC20LaunchPayment.transfer, (to, amount)));
        if (!ok || (output.length != 0 && !abi.decode(output, (bool)))) revert TransferFailed();
    }
}

contract RareV3Migrator {
    struct LiquidityData { address token0; address token1; uint256 amount0; uint256 amount1; }
    struct MigrationRequest { address token; address creator; uint256 tokenAmount; uint256 deadline; uint256 ethAmount; }
    uint24 public constant POOL_FEE = 3_000;
    int24 public constant TICK_LOWER = -887220;
    int24 public constant TICK_UPPER = 887220;
    uint256 private constant Q96 = 2 ** 96;
    uint256 private constant PRICE_SCALE = 1 ether;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address public immutable factory;
    address public immutable positionManager;
    address public immutable weth;
    address public immutable vault;
    RareV3LiquidityLocker public immutable locker;

    error NotFactory();
    error InvalidMigration();
    error UnsafePoolPrice();
    error TransferFailed();

    event Migrated(address indexed token, address indexed pool, uint256 indexed tokenId, uint256 tokenLiquidity, uint256 ethLiquidity, uint256 tokenBurned, uint256 wethToVault);

    constructor(address positionManager_, address weth_, address vault_) {
        if (positionManager_ == address(0) || weth_ == address(0) || vault_ == address(0)) revert InvalidMigration();
        if (INonfungiblePositionManagerLaunch(positionManager_).WETH9() != weth_) revert InvalidMigration();
        factory = msg.sender;
        positionManager = positionManager_;
        weth = weth_;
        vault = vault_;
        locker = new RareV3LiquidityLocker(positionManager_, vault_);
    }

    function migrate(address token, address creator, uint256 tokenAmount, uint256 deadline) external payable returns (uint256 tokenId, address pool) {
        if (msg.sender != factory) revert NotFactory();
        return _migrate(MigrationRequest(token, creator, tokenAmount, deadline, msg.value));
    }

    function _migrate(MigrationRequest memory request) private returns (uint256 tokenId, address pool) {
        if (request.token == address(0) || request.creator == address(0) || request.tokenAmount == 0 || request.ethAmount == 0 || block.timestamp > request.deadline) revert InvalidMigration();
        LiquidityData memory data;
        data.token0 = request.token < weth ? request.token : weth;
        data.token1 = request.token < weth ? weth : request.token;
        data.amount0 = data.token0 == request.token ? request.tokenAmount : request.ethAmount;
        data.amount1 = data.token1 == request.token ? request.tokenAmount : request.ethAmount;
        uint160 desiredPrice = _sqrtPriceX96(data.amount0, data.amount1);
        address uniFactory = INonfungiblePositionManagerLaunch(positionManager).factory();
        address existing = IUniswapV3FactoryLaunch(uniFactory).getPool(data.token0, data.token1, POOL_FEE);
        pool = INonfungiblePositionManagerLaunch(positionManager).createAndInitializePoolIfNecessary(data.token0, data.token1, POOL_FEE, desiredPrice);
        if (existing != address(0)) {
            (uint160 currentPrice,,,,,,) = IUniswapV3PoolLaunch(pool).slot0();
            uint256 difference = currentPrice > desiredPrice ? currentPrice - desiredPrice : desiredPrice - currentPrice;
            if (difference * 10_000 > uint256(desiredPrice) * 100) revert UnsafePoolPrice();
        }
        IWethLaunch(weth).deposit{value: request.ethAmount}();
        _approve(request.token, positionManager, request.tokenAmount);
        _approve(weth, positionManager, request.ethAmount);
        uint256 used0;
        uint256 used1;
        (tokenId, used0, used1) = _mintPosition(data, request.deadline);
        _approve(request.token, positionManager, 0);
        _approve(weth, positionManager, 0);
        locker.register(tokenId, request.creator, data.token0, data.token1);
        uint256 usedToken = data.token0 == request.token ? used0 : used1;
        uint256 usedWeth = data.token0 == weth ? used0 : used1;
        _finishMigration(request.token, pool, request.tokenAmount, tokenId, usedToken, usedWeth);
    }

    function _finishMigration(address token, address pool, uint256 tokenAmount, uint256 tokenId, uint256 usedToken, uint256 usedWeth) private {
        uint256 tokenDust = tokenAmount - usedToken;
        uint256 wethDust = IWethLaunch(weth).balanceOf(address(this));
        _send(token, DEAD, tokenDust);
        _send(weth, vault, wethDust);
        emit Migrated(token, pool, tokenId, usedToken, usedWeth, tokenDust, wethDust);
    }

    function _mintPosition(LiquidityData memory data, uint256 deadline) private returns (uint256 tokenId, uint256 used0, uint256 used1) {
        INonfungiblePositionManagerLaunch.MintParams memory params = INonfungiblePositionManagerLaunch.MintParams(
            data.token0, data.token1, POOL_FEE, TICK_LOWER, TICK_UPPER, data.amount0, data.amount1, data.amount0 * 95 / 100, data.amount1 * 95 / 100, address(locker), deadline
        );
        uint128 liquidity;
        (tokenId, liquidity, used0, used1) = INonfungiblePositionManagerLaunch(positionManager).mint(params);
    }

    function _sqrtPriceX96(uint256 amount0, uint256 amount1) private pure returns (uint160) {
        uint256 scaledRatio = amount1 * PRICE_SCALE / amount0;
        uint256 root = _sqrt(scaledRatio);
        uint256 price = root * Q96 / 1e9;
        if (price == 0 || price > type(uint160).max) revert InvalidMigration();
        return uint160(price);
    }

    function _sqrt(uint256 value) private pure returns (uint256 result) {
        if (value == 0) return 0;
        result = value;
        uint256 x = value / 2 + 1;
        while (x < result) { result = x; x = (value / x + x) / 2; }
    }

    function _approve(address token, address spender, uint256 amount) private {
        (bool ok, bytes memory output) = token.call(abi.encodeCall(IERC20LaunchPayment.approve, (spender, amount)));
        if (!ok || (output.length != 0 && !abi.decode(output, (bool)))) revert TransferFailed();
    }

    function _send(address token, address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, bytes memory output) = token.call(abi.encodeCall(IERC20LaunchPayment.transfer, (to, amount)));
        if (!ok || (output.length != 0 && !abi.decode(output, (bool)))) revert TransferFailed();
    }
}

contract RareLaunchToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public constant totalSupply = 1_000_000_000 ether;
    address public immutable launchFactory;
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    error InvalidAddress();
    error InsufficientBalance();
    error InsufficientAllowance();

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    constructor(string memory name_, string memory symbol_, address factory_) {
        if (factory_ == address(0)) revert InvalidAddress();
        name = name_;
        symbol = symbol_;
        launchFactory = factory_;
        balanceOf[factory_] = totalSupply;
        emit Transfer(address(0), factory_, totalSupply);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - amount;
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert InvalidAddress();
        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = balance - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }
}

/// @title Rares native-ETH launch factory
/// @notice Creates fixed-supply tokens paid for in RARE and trades them against a reserve-backed ETH curve.
/// @dev Mainnet pilot: Uniswap graduation is deliberately not implemented or enabled in this version.
contract RareLaunchFactory {
    uint256 public constant FACTORY_VERSION = 4;
    uint256 public constant BPS = 10_000;
    uint256 public constant TRADE_FEE_BPS = 100;
    uint256 public constant CREATOR_FEE_SHARE_BPS = 9_700;
    uint256 public constant TREASURY_FEE_SHARE_BPS = 300;
    uint256 public constant LAUNCH_FEE_RARE = 250_000 ether;
    uint256 public constant FIXED_TOKEN_SUPPLY = 1_000_000_000 ether;
    bool public constant GRADUATION_ENABLED = true;
    bool public constant PUBLIC_CREATION_ENABLED = false;

    struct Launch {
        address creator;
        uint128 virtualEth;
        uint128 virtualToken;
        uint128 realEth;
        uint128 creatorFees;
        uint128 treasuryFees;
        bool graduated;
    }

    IERC20LaunchPayment public immutable rareToken;
    address public immutable raresVault;
    address public immutable launchAdmin;
    address public immutable ethTreasury;
    uint256 public immutable initialVirtualEth;
    uint256 public immutable graduationMarketCapEth;
    RareV3Migrator public immutable graduationMigrator;
    mapping(address token => Launch launch) public launches;
    mapping(bytes32 symbolHash => address token) public tokenBySymbolHash;
    address[] public allTokens;
    uint256 private locked = 1;

    error InvalidConfiguration();
    error InvalidToken();
    error InvalidAmount();
    error Slippage();
    error InsufficientReserve();
    error TransferFailed();
    error Reentrancy();
    error NotAdmin();
    error NotCreator();
    error NothingToClaim();
    error SymbolAlreadyUsed();
    error DirectEthDisabled();
    error Expired();
    error AlreadyGraduated();
    error GraduationNotReached();

    event TokenCreated(address indexed token, address indexed creator, string name, string symbol, uint256 supply, uint256 launchFeeRare);
    event Trade(address indexed token, address indexed trader, bool indexed isBuy, uint256 ethAmount, uint256 tokenAmount, uint256 fee);
    event CreatorFeesClaimed(address indexed token, address indexed creator, uint256 amount);
    event TreasuryFeesClaimed(address indexed token, address indexed treasury, uint256 amount);
    event TokenGraduated(address indexed token, address indexed pool, uint256 indexed positionTokenId, uint256 ethLiquidity, uint256 tokenLiquidity);

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(address rareToken_, address raresVault_, address launchAdmin_, address ethTreasury_, uint256 initialVirtualEth_, uint256 graduationMarketCapEth_, address positionManager_, address weth_) {
        if (rareToken_ == address(0) || raresVault_ == address(0) || launchAdmin_ == address(0) || ethTreasury_ == address(0) || initialVirtualEth_ == 0 || initialVirtualEth_ > type(uint128).max || graduationMarketCapEth_ <= initialVirtualEth_) revert InvalidConfiguration();
        rareToken = IERC20LaunchPayment(rareToken_);
        raresVault = raresVault_;
        launchAdmin = launchAdmin_;
        ethTreasury = ethTreasury_;
        initialVirtualEth = initialVirtualEth_;
        graduationMarketCapEth = graduationMarketCapEth_;
        graduationMigrator = new RareV3Migrator(positionManager_, weth_, raresVault_);
    }

    receive() external payable { revert DirectEthDisabled(); }

    function tokenCount() external view returns (uint256) { return allTokens.length; }

    function createToken(string calldata name, string calldata symbol, uint256 maxLaunchFeeRare) external nonReentrant returns (address token) {
        if (msg.sender != launchAdmin) revert NotAdmin();
        _validateMetadata(name, symbol);
        bytes32 symbolHash = keccak256(bytes(symbol));
        if (tokenBySymbolHash[symbolHash] != address(0)) revert SymbolAlreadyUsed();
        if (LAUNCH_FEE_RARE > maxLaunchFeeRare) revert Slippage();
        _pullRareExact(msg.sender, LAUNCH_FEE_RARE);
        _pushRareExact(raresVault, LAUNCH_FEE_RARE);

        token = address(new RareLaunchToken(name, symbol, address(this)));
        launches[token] = Launch(msg.sender, uint128(initialVirtualEth), uint128(FIXED_TOKEN_SUPPLY), 0, 0, 0, false);
        tokenBySymbolHash[symbolHash] = token;
        allTokens.push(token);
        emit TokenCreated(token, msg.sender, name, symbol, FIXED_TOKEN_SUPPLY, LAUNCH_FEE_RARE);
    }

    function buy(address token, uint256 minTokensOut, uint256 deadline) external payable nonReentrant returns (uint256 tokensOut) {
        if (block.timestamp > deadline) revert Expired();
        tokensOut = _buy(token, msg.sender, msg.value, minTokensOut);
    }

    function sell(address token, uint256 tokensIn, uint256 minEthOut, uint256 deadline) external nonReentrant returns (uint256 ethOut) {
        if (block.timestamp > deadline) revert Expired();
        Launch storage launch = launches[token];
        if (launch.creator == address(0)) revert InvalidToken();
        if (launch.graduated) revert AlreadyGraduated();
        if (tokensIn == 0) revert InvalidAmount();
        _pullTokenExact(token, msg.sender, tokensIn);

        uint256 virtualEthBefore = uint256(launch.virtualEth);
        uint256 virtualTokenBefore = uint256(launch.virtualToken);
        uint256 grossEth = tokensIn * virtualEthBefore / (virtualTokenBefore + tokensIn);
        if (grossEth == 0 || grossEth > launch.realEth) revert InsufficientReserve();
        uint256 fee = grossEth * TRADE_FEE_BPS / BPS;
        ethOut = grossEth - fee;
        if (ethOut < minEthOut || ethOut == 0) revert Slippage();

        launch.virtualToken = _toUint128(virtualTokenBefore + tokensIn);
        launch.virtualEth = _toUint128(virtualEthBefore - grossEth);
        launch.realEth = _toUint128(uint256(launch.realEth) - grossEth);
        _accrueEthFee(launch, fee);
        _sendEth(msg.sender, ethOut);
        emit Trade(token, msg.sender, false, ethOut, tokensIn, fee);
    }

    function claimCreatorFees(address token) external nonReentrant {
        Launch storage launch = launches[token];
        if (launch.creator == address(0)) revert InvalidToken();
        if (msg.sender != launch.creator) revert NotCreator();
        uint256 amount = launch.creatorFees;
        if (amount == 0) revert NothingToClaim();
        launch.creatorFees = 0;
        _sendEth(msg.sender, amount);
        emit CreatorFeesClaimed(token, msg.sender, amount);
    }

    /// @notice Anyone may trigger this payment, but ETH can only reach the immutable treasury.
    function claimTreasuryFees(address token) external nonReentrant {
        Launch storage launch = launches[token];
        if (launch.creator == address(0)) revert InvalidToken();
        uint256 amount = launch.treasuryFees;
        if (amount == 0) revert NothingToClaim();
        launch.treasuryFees = 0;
        _sendEth(ethTreasury, amount);
        emit TreasuryFeesClaimed(token, ethTreasury, amount);
    }

    function quoteBuy(address token, uint256 ethIn) external view returns (uint256 tokensOut, uint256 fee) {
        Launch storage launch = launches[token];
        if (launch.creator == address(0)) revert InvalidToken();
        if (launch.graduated) revert AlreadyGraduated();
        if (ethIn == 0) return (0, 0);
        fee = ethIn * TRADE_FEE_BPS / BPS;
        uint256 netEth = ethIn - fee;
        tokensOut = netEth * uint256(launch.virtualToken) / (uint256(launch.virtualEth) + netEth);
    }

    function quoteSell(address token, uint256 tokensIn) external view returns (uint256 ethOut, uint256 fee, bool reserveSufficient) {
        Launch storage launch = launches[token];
        if (launch.creator == address(0)) revert InvalidToken();
        if (launch.graduated) revert AlreadyGraduated();
        if (tokensIn == 0) return (0, 0, true);
        uint256 grossEth = tokensIn * uint256(launch.virtualEth) / (uint256(launch.virtualToken) + tokensIn);
        fee = grossEth * TRADE_FEE_BPS / BPS;
        ethOut = grossEth - fee;
        reserveSufficient = grossEth <= launch.realEth;
    }

    function marketCapEth(address token) external view returns (uint256) {
        Launch storage launch = launches[token];
        if (launch.creator == address(0)) revert InvalidToken();
        return uint256(launch.virtualEth) * FIXED_TOKEN_SUPPLY / uint256(launch.virtualToken);
    }

    function graduate(address token, uint256 deadline) external nonReentrant returns (uint256 positionTokenId, address pool) {
        if (block.timestamp > deadline) revert Expired();
        Launch storage launch = launches[token];
        if (launch.creator == address(0)) revert InvalidToken();
        if (launch.graduated) revert AlreadyGraduated();
        uint256 currentMarketCap = uint256(launch.virtualEth) * FIXED_TOKEN_SUPPLY / uint256(launch.virtualToken);
        if (currentMarketCap < graduationMarketCapEth) revert GraduationNotReached();
        uint256 ethLiquidity = launch.realEth;
        uint256 tokenLiquidity = ethLiquidity * uint256(launch.virtualToken) / uint256(launch.virtualEth);
        if (ethLiquidity == 0 || tokenLiquidity == 0) revert InsufficientReserve();
        uint256 availableTokens = IERC20LaunchPayment(token).balanceOf(address(this));
        if (tokenLiquidity > availableTokens) revert InsufficientReserve();
        launch.graduated = true;
        launch.realEth = 0;
        _pushTokenExact(token, address(graduationMigrator), tokenLiquidity);
        uint256 excessTokens = availableTokens - tokenLiquidity;
        if (excessTokens != 0) _pushTokenExact(token, graduationMigrator.DEAD(), excessTokens);
        (positionTokenId, pool) = graduationMigrator.migrate{value: ethLiquidity}(token, launch.creator, tokenLiquidity, deadline);
        emit TokenGraduated(token, pool, positionTokenId, ethLiquidity, tokenLiquidity);
    }

    function _buy(address token, address buyer, uint256 ethIn, uint256 minTokensOut) private returns (uint256 tokensOut) {
        Launch storage launch = launches[token];
        if (launch.creator == address(0)) revert InvalidToken();
        if (launch.graduated) revert AlreadyGraduated();
        if (ethIn == 0) revert InvalidAmount();
        uint256 fee = ethIn * TRADE_FEE_BPS / BPS;
        uint256 netEth = ethIn - fee;
        uint256 virtualEthBefore = uint256(launch.virtualEth);
        uint256 virtualTokenBefore = uint256(launch.virtualToken);
        tokensOut = netEth * virtualTokenBefore / (virtualEthBefore + netEth);
        if (tokensOut == 0 || tokensOut < minTokensOut || tokensOut > IERC20LaunchPayment(token).balanceOf(address(this))) revert Slippage();
        launch.virtualEth = _toUint128(virtualEthBefore + netEth);
        launch.virtualToken = _toUint128(virtualTokenBefore - tokensOut);
        launch.realEth = _toUint128(uint256(launch.realEth) + netEth);
        _accrueEthFee(launch, fee);
        _pushTokenExact(token, buyer, tokensOut);
        emit Trade(token, buyer, true, ethIn, tokensOut, fee);
    }

    function _accrueEthFee(Launch storage launch, uint256 fee) private {
        if (fee == 0) return;
        uint256 treasuryFee = fee * TREASURY_FEE_SHARE_BPS / BPS;
        uint256 creatorFee = fee - treasuryFee;
        launch.creatorFees = _toUint128(uint256(launch.creatorFees) + creatorFee);
        launch.treasuryFees = _toUint128(uint256(launch.treasuryFees) + treasuryFee);
    }

    function _validateMetadata(string calldata name, string calldata symbol) private pure {
        bytes calldata nameBytes = bytes(name);
        bytes calldata symbolBytes = bytes(symbol);
        if (nameBytes.length == 0 || nameBytes.length > 32 || symbolBytes.length == 0 || symbolBytes.length > 10) revert InvalidConfiguration();
        for (uint256 index; index < nameBytes.length; ++index) if (nameBytes[index] < 0x20 || nameBytes[index] > 0x7E) revert InvalidConfiguration();
        for (uint256 index; index < symbolBytes.length; ++index) {
            bytes1 value = symbolBytes[index];
            if (!((value >= 0x41 && value <= 0x5A) || (value >= 0x30 && value <= 0x39))) revert InvalidConfiguration();
        }
    }

    function _toUint128(uint256 value) private pure returns (uint128 result) {
        if (value > type(uint128).max) revert InvalidAmount();
        result = uint128(value);
    }

    function _pullRareExact(address from, uint256 amount) private {
        uint256 beforeBalance = rareToken.balanceOf(address(this));
        _call(address(rareToken), abi.encodeCall(IERC20LaunchPayment.transferFrom, (from, address(this), amount)));
        if (rareToken.balanceOf(address(this)) - beforeBalance != amount) revert TransferFailed();
    }

    function _pushRareExact(address to, uint256 amount) private {
        uint256 beforeBalance = rareToken.balanceOf(to);
        _call(address(rareToken), abi.encodeCall(IERC20LaunchPayment.transfer, (to, amount)));
        if (rareToken.balanceOf(to) - beforeBalance != amount) revert TransferFailed();
    }

    function _pullTokenExact(address token, address from, uint256 amount) private {
        uint256 beforeBalance = IERC20LaunchPayment(token).balanceOf(address(this));
        _call(token, abi.encodeCall(IERC20LaunchPayment.transferFrom, (from, address(this), amount)));
        if (IERC20LaunchPayment(token).balanceOf(address(this)) - beforeBalance != amount) revert TransferFailed();
    }

    function _pushTokenExact(address token, address to, uint256 amount) private {
        uint256 beforeBalance = IERC20LaunchPayment(token).balanceOf(to);
        _call(token, abi.encodeCall(IERC20LaunchPayment.transfer, (to, amount)));
        if (IERC20LaunchPayment(token).balanceOf(to) - beforeBalance != amount) revert TransferFailed();
    }

    function _sendEth(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _call(address target, bytes memory data) private {
        (bool ok, bytes memory output) = target.call(data);
        if (!ok || (output.length != 0 && !abi.decode(output, (bool)))) revert TransferFailed();
    }
}
