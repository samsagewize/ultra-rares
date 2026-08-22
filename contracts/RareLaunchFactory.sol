// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Launch {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

interface IRareLaunchMarketCapOracle {
    function marketCapUsd(address token) external view returns (uint256 marketCapUsdE18, uint256 updatedAt);
}

interface IRareLaunchMigrator {
    function graduate(address token, address rareToken, uint256 tokenAmount, uint256 rareAmount, address creator) external;
}

interface IRareLaunchVault {
    function recordFee(address launchToken, address creator, uint256 grossTradeFee, uint256 vaultShare) external;
}

contract RareLaunchToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public immutable totalSupply;
    address public immutable launchFactory;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    error Unauthorized();
    error InvalidAddress();
    error InsufficientBalance();
    error InsufficientAllowance();
    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    constructor(string memory name_, string memory symbol_, uint256 supply_, address factory_) {
        if (factory_ == address(0) || supply_ == 0) revert InvalidAddress();
        name = name_; symbol = symbol_; totalSupply = supply_; launchFactory = factory_;
        balanceOf[factory_] = supply_;
        emit Transfer(address(0), factory_, supply_);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) { _transfer(msg.sender, to, amount); return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }
    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert InvalidAddress();
        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance();
        unchecked { balanceOf[from] = balance - amount; balanceOf[to] += amount; }
        emit Transfer(from, to, amount);
    }
}

/// @notice Mainnet candidate. Do not deploy before independent review of curve parameters and immutable integrations.
contract RareLaunchFactory {
    uint256 public constant BPS = 10_000;
    uint256 public constant TRADE_FEE_BPS = 100;
    uint256 public constant CREATOR_FEE_SHARE_BPS = 9_700;
    uint256 public constant VAULT_FEE_SHARE_BPS = 300;
    uint256 public constant LAUNCH_FEE_RARE = 250_000 ether;
    uint256 public constant GRADUATION_MARKET_CAP_USD_E18 = 70_000 ether;
    uint256 public constant MAX_ORACLE_AGE = 15 minutes;
    uint256 public constant GRADUATION_CONFIG_DELAY = 7 days;
    uint256 public constant FIXED_TOKEN_SUPPLY = 1_000_000_000 ether;

    struct Launch {
        address creator;
        uint128 virtualRare;
        uint128 virtualToken;
        uint128 realRare;
        uint128 creatorFees;
        bool graduationReady;
        bool migrated;
    }

    IERC20Launch public immutable rareToken;
    address public immutable graduationAdmin;
    IRareLaunchMarketCapOracle public marketCapOracle;
    IRareLaunchMigrator public uniswapMigrator;
    address public proposedMarketCapOracle;
    address public proposedUniswapMigrator;
    uint64 public graduationConfigActivationTime;
    bool public graduationConfigLocked;
    IRareLaunchVault public immutable raresVault;
    uint256 public immutable initialVirtualRare;
    mapping(address token => Launch) public launches;
    address[] public allTokens;
    uint256 private locked = 1;

    error InvalidConfiguration(); error InvalidToken(); error InvalidAmount(); error Slippage();
    error OracleStale(); error TransferFailed(); error Reentrancy(); error Graduated(); error NotGraduated(); error NothingToClaim();
    error NotAdmin(); error ConfigurationPending(); error ConfigurationLocked();
    event TokenCreated(address indexed token, address indexed creator, string name, string symbol, uint256 supply, uint256 launchFee);
    event Trade(address indexed token, address indexed trader, bool indexed isBuy, uint256 rareAmount, uint256 tokenAmount, uint256 fee);
    event CreatorFeesClaimed(address indexed token, address indexed creator, uint256 amount);
    event GraduationReady(address indexed token, uint256 marketCapUsdE18);
    event GraduatedToUniswap(address indexed token, uint256 tokenAmount, uint256 rareAmount);
    event GraduationConfigProposed(address indexed oracle, address indexed migrator, uint256 activationTime);
    event GraduationConfigActivated(address indexed oracle, address indexed migrator);

    modifier nonReentrant() { if (locked != 1) revert Reentrancy(); locked = 2; _; locked = 1; }

    constructor(address rare_, address vault_, address graduationAdmin_, uint256 initialVirtualRare_) {
        if (rare_ == address(0) || vault_ == address(0) || graduationAdmin_ == address(0) || initialVirtualRare_ == 0 || initialVirtualRare_ > type(uint128).max) revert InvalidConfiguration();
        rareToken = IERC20Launch(rare_); raresVault = IRareLaunchVault(vault_); graduationAdmin = graduationAdmin_; initialVirtualRare = initialVirtualRare_;
    }

    function tokenCount() external view returns (uint256) { return allTokens.length; }

    function createToken(string calldata name, string calldata symbol, uint256 maxLaunchFee, uint256 openingBuyRare, uint256 minOpeningTokens) external nonReentrant returns (address token) {
        if (bytes(name).length == 0 || bytes(name).length > 32 || bytes(symbol).length == 0 || bytes(symbol).length > 10) revert InvalidConfiguration();
        uint256 fee = LAUNCH_FEE_RARE;
        if (fee > maxLaunchFee) revert Slippage();
        _pullExact(msg.sender, fee + openingBuyRare);
        _pushExact(address(raresVault), fee);
        token = address(new RareLaunchToken(name, symbol, FIXED_TOKEN_SUPPLY, address(this)));
        launches[token] = Launch(msg.sender, uint128(initialVirtualRare), uint128(FIXED_TOKEN_SUPPLY), 0, 0, false, false);
        allTokens.push(token);
        emit TokenCreated(token, msg.sender, name, symbol, FIXED_TOKEN_SUPPLY, fee);
        if (openingBuyRare != 0) _buy(token, msg.sender, openingBuyRare, minOpeningTokens);
    }

    function buy(address token, uint256 rareIn, uint256 minTokensOut) external nonReentrant returns (uint256 tokensOut) {
        _pullExact(msg.sender, rareIn);
        tokensOut = _buy(token, msg.sender, rareIn, minTokensOut);
    }

    function sell(address token, uint256 tokensIn, uint256 minRareOut) external nonReentrant returns (uint256 rareOut) {
        Launch storage launch = launches[token];
        if (launch.creator == address(0)) revert InvalidToken(); if (launch.graduationReady) revert Graduated(); if (tokensIn == 0) revert InvalidAmount();
        _pullTokenExact(token, msg.sender, tokensIn);
        uint256 gross = uint256(launch.virtualRare) - (uint256(launch.virtualRare) * uint256(launch.virtualToken) / (uint256(launch.virtualToken) + tokensIn));
        uint256 fee = gross * TRADE_FEE_BPS / BPS; rareOut = gross - fee;
        if (rareOut < minRareOut || gross > launch.realRare) revert Slippage();
        launch.virtualToken = uint128(uint256(launch.virtualToken) + tokensIn); launch.virtualRare = uint128(uint256(launch.virtualRare) - gross); launch.realRare = uint128(uint256(launch.realRare) - gross);
        _accrueFee(token, launch, fee); _pushExact(msg.sender, rareOut);
        emit Trade(token, msg.sender, false, rareOut, tokensIn, fee);
    }

    function claimCreatorFees(address token) external nonReentrant {
        Launch storage launch = launches[token];
        if (msg.sender != launch.creator) revert InvalidToken();
        uint256 amount = launch.creatorFees; if (amount == 0) revert NothingToClaim(); launch.creatorFees = 0; _pushExact(msg.sender, amount);
        emit CreatorFeesClaimed(token, msg.sender, amount);
    }

    function markGraduationReady(address token) external nonReentrant {
        if (!graduationConfigLocked) revert ConfigurationPending();
        Launch storage launch = launches[token]; if (launch.creator == address(0)) revert InvalidToken(); if (launch.graduationReady) revert Graduated();
        (uint256 cap, uint256 updatedAt) = marketCapOracle.marketCapUsd(token);
        if (block.timestamp > updatedAt + MAX_ORACLE_AGE) revert OracleStale(); if (cap < GRADUATION_MARKET_CAP_USD_E18) revert NotGraduated();
        launch.graduationReady = true; emit GraduationReady(token, cap);
    }

    function proposeGraduationConfig(address oracle, address migrator) external {
        if (msg.sender != graduationAdmin) revert NotAdmin();
        if (graduationConfigLocked) revert ConfigurationLocked();
        if (oracle == address(0) || migrator == address(0)) revert InvalidConfiguration();
        proposedMarketCapOracle = oracle; proposedUniswapMigrator = migrator;
        graduationConfigActivationTime = uint64(block.timestamp + GRADUATION_CONFIG_DELAY);
        emit GraduationConfigProposed(oracle, migrator, graduationConfigActivationTime);
    }

    function activateGraduationConfig() external {
        if (graduationConfigLocked) revert ConfigurationLocked();
        if (graduationConfigActivationTime == 0 || block.timestamp < graduationConfigActivationTime) revert ConfigurationPending();
        marketCapOracle = IRareLaunchMarketCapOracle(proposedMarketCapOracle);
        uniswapMigrator = IRareLaunchMigrator(proposedUniswapMigrator);
        graduationConfigLocked = true;
        emit GraduationConfigActivated(proposedMarketCapOracle, proposedUniswapMigrator);
    }

    function graduate(address token) external nonReentrant {
        Launch storage launch = launches[token]; if (!launch.graduationReady) revert NotGraduated(); if (launch.migrated) revert Graduated(); launch.migrated = true;
        uint256 rareAmount = launch.realRare; launch.realRare = 0;
        uint256 tokenAmount = IERC20Launch(token).balanceOf(address(this));
        _approveExact(token, address(uniswapMigrator), tokenAmount); _approveExact(address(rareToken), address(uniswapMigrator), rareAmount);
        uniswapMigrator.graduate(token, address(rareToken), tokenAmount, rareAmount, launch.creator);
        _approveExact(token, address(uniswapMigrator), 0); _approveExact(address(rareToken), address(uniswapMigrator), 0);
        emit GraduatedToUniswap(token, tokenAmount, rareAmount);
    }

    function _buy(address token, address buyer, uint256 rareIn, uint256 minTokensOut) private returns (uint256 tokensOut) {
        Launch storage launch = launches[token];
        if (launch.creator == address(0)) revert InvalidToken(); if (launch.graduationReady) revert Graduated(); if (rareIn == 0) revert InvalidAmount();
        uint256 fee = rareIn * TRADE_FEE_BPS / BPS; uint256 net = rareIn - fee;
        tokensOut = uint256(launch.virtualToken) - (uint256(launch.virtualRare) * uint256(launch.virtualToken) / (uint256(launch.virtualRare) + net));
        if (tokensOut < minTokensOut || tokensOut == 0 || tokensOut > IERC20Launch(token).balanceOf(address(this))) revert Slippage();
        launch.virtualRare = uint128(uint256(launch.virtualRare) + net); launch.virtualToken = uint128(uint256(launch.virtualToken) - tokensOut); launch.realRare = uint128(uint256(launch.realRare) + net);
        _accrueFee(token, launch, fee); _pushTokenExact(token, buyer, tokensOut);
        emit Trade(token, buyer, true, rareIn, tokensOut, fee);
    }

    function _accrueFee(address token, Launch storage launch, uint256 fee) private {
        uint256 vaultFee = fee * VAULT_FEE_SHARE_BPS / BPS; uint256 creatorFee = fee - vaultFee;
        if (vaultFee == 0) revert InvalidAmount();
        launch.creatorFees = uint128(uint256(launch.creatorFees) + creatorFee);
        _pushExact(address(raresVault), vaultFee);
        raresVault.recordFee(token, launch.creator, fee, vaultFee);
    }
    function _pullExact(address from, uint256 amount) private { uint256 b = rareToken.balanceOf(address(this)); _call(address(rareToken), abi.encodeCall(IERC20Launch.transferFrom,(from,address(this),amount))); if (rareToken.balanceOf(address(this))-b != amount) revert TransferFailed(); }
    function _pushExact(address to, uint256 amount) private { if (amount == 0) return; uint256 b = rareToken.balanceOf(to); _call(address(rareToken), abi.encodeCall(IERC20Launch.transfer,(to,amount))); if (rareToken.balanceOf(to)-b != amount) revert TransferFailed(); }
    function _pullTokenExact(address token,address from,uint256 amount) private { uint256 b=IERC20Launch(token).balanceOf(address(this)); _call(token,abi.encodeCall(IERC20Launch.transferFrom,(from,address(this),amount))); if(IERC20Launch(token).balanceOf(address(this))-b!=amount)revert TransferFailed(); }
    function _pushTokenExact(address token,address to,uint256 amount) private { uint256 b=IERC20Launch(token).balanceOf(to); _call(token,abi.encodeCall(IERC20Launch.transfer,(to,amount))); if(IERC20Launch(token).balanceOf(to)-b!=amount)revert TransferFailed(); }
    function _approveExact(address token,address spender,uint256 amount) private { _call(token,abi.encodeWithSignature("approve(address,uint256)",spender,amount)); }
    function _call(address target, bytes memory data) private { (bool ok,bytes memory out)=target.call(data); if(!ok||(out.length!=0&&!abi.decode(out,(bool))))revert TransferFailed(); }
}
