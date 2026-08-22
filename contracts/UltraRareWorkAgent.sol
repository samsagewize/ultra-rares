// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IWorkERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IWorkWETH is IWorkERC20 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

interface IWorkNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IWorkSwapAdapter {
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minimumOut, address recipient)
        external returns (uint256 amountOut);
}

interface IWorkPriceGuard {
    function minimumOut(address tokenIn, address tokenOut, uint256 amountIn, uint16 maximumSlippageBps)
        external view returns (uint256);
}

contract UltraRareProfitEscrow {
    error Unauthorized();
    error TransferFailed();
    error NothingToClaim();
    error Reentrancy();

    IWorkWETH public immutable weth;
    address public immutable agent;
    uint256 public totalLiability;
    mapping(address => uint256) public claimable;
    uint256 private locked = 1;

    event ProfitCredited(address indexed beneficiary, uint256 amount);
    event ProfitClaimed(address indexed beneficiary, uint256 amount, bool asEth);

    constructor(address weth_, address agent_) {
        if (weth_ == address(0) || agent_ == address(0)) revert Unauthorized();
        weth = IWorkWETH(weth_);
        agent = agent_;
    }

    receive() external payable {
        if (msg.sender != address(weth)) revert Unauthorized();
    }

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    function credit(address beneficiary, uint256 amount) external {
        if (msg.sender != agent || beneficiary == address(0) || amount == 0) revert Unauthorized();
        uint256 newLiability = totalLiability + amount;
        if (weth.balanceOf(address(this)) < newLiability) revert TransferFailed();
        totalLiability = newLiability;
        claimable[beneficiary] += amount;
        emit ProfitCredited(beneficiary, amount);
    }

    function claimWeth() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        totalLiability -= amount;
        if (!weth.transfer(msg.sender, amount)) revert TransferFailed();
        emit ProfitClaimed(msg.sender, amount, false);
    }

    function claimEth() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        totalLiability -= amount;
        weth.withdraw(amount);
        (bool sent,) = payable(msg.sender).call{value: amount}("");
        if (!sent) revert TransferFailed();
        emit ProfitClaimed(msg.sender, amount, true);
    }
}

contract UltraRareWorkAgent {
    error Unauthorized();
    error InvalidConfiguration();
    error InvalidAsset();
    error PositionOpen();
    error NoPosition();
    error Paused();
    error Cooldown();
    error LimitExceeded();
    error UnsafeQuote();
    error TransferFailed();
    error Reentrancy();

    uint16 public constant BPS = 10_000;
    uint16 public constant MAX_SLIPPAGE_BPS = 1_000;

    IWorkNFT public immutable collection;
    uint256 public immutable tokenId;
    IWorkWETH public immutable weth;
    IWorkERC20 public immutable rare;
    IWorkERC20 public immutable lemon;
    IWorkSwapAdapter public immutable rareAdapter;
    IWorkSwapAdapter public immutable lemonAdapter;
    IWorkPriceGuard public immutable priceGuard;
    UltraRareProfitEscrow public immutable profitEscrow;

    address public strategyOwner;
    address public keeper;
    uint256 public maximumCycleWeth;
    uint16 public claimBps;
    uint16 public maximumSlippageBps;
    uint32 public cooldownSeconds;
    uint64 public lastTradeAt;
    bool public tradingPaused = true;
    uint256 public maximumDailyLossWeth;
    uint256 public dailyRealizedLossWeth;
    uint64 public lossWindowStartedAt;
    uint8 public maximumConsecutiveLosses;
    uint8 public consecutiveLosses;

    address public positionToken;
    uint256 public positionPrincipalWeth;
    uint256 public positionTokenAmount;
    uint256 private locked = 1;

    event StrategyConfigured(address indexed owner, address indexed keeper, uint256 maximumCycleWeth, uint16 claimBps, uint16 maximumSlippageBps, uint32 cooldownSeconds);
    event TradingPaused(address indexed owner, bool paused);
    event CapitalDeposited(address indexed owner, uint256 amount);
    event PositionOpened(address indexed token, uint256 wethSpent, uint256 tokensReceived);
    event PositionClosed(address indexed token, uint256 tokensSold, uint256 wethReceived, uint256 realizedProfit, uint256 claimableProfit);
    event RiskLimitsConfigured(address indexed owner, uint256 maximumDailyLossWeth, uint8 maximumConsecutiveLosses);
    event LossRecorded(uint256 loss, uint256 dailyLoss, uint8 consecutiveLosses, bool circuitBreakerTriggered);
    event CapitalWithdrawn(address indexed owner, address indexed recipient, uint256 wethAmount, uint256 rareAmount, uint256 lemonAmount);

    constructor(
        address collection_, uint256 tokenId_, address weth_, address rare_, address lemon_,
        address rareAdapter_, address lemonAdapter_, address priceGuard_
    ) {
        if (
            collection_ == address(0) || weth_ == address(0) || rare_ == address(0) || lemon_ == address(0)
                || rareAdapter_ == address(0) || lemonAdapter_ == address(0) || priceGuard_ == address(0)
                || rare_ == lemon_ || rare_ == weth_ || lemon_ == weth_
        ) revert InvalidConfiguration();
        collection = IWorkNFT(collection_);
        tokenId = tokenId_;
        weth = IWorkWETH(weth_);
        rare = IWorkERC20(rare_);
        lemon = IWorkERC20(lemon_);
        rareAdapter = IWorkSwapAdapter(rareAdapter_);
        lemonAdapter = IWorkSwapAdapter(lemonAdapter_);
        priceGuard = IWorkPriceGuard(priceGuard_);
        profitEscrow = new UltraRareProfitEscrow(weth_, address(this));
    }

    receive() external payable {
        if (msg.sender != address(weth)) revert Unauthorized();
    }

    modifier onlyNftOwner() {
        if (msg.sender != collection.ownerOf(tokenId)) revert Unauthorized();
        _;
    }

    modifier onlyActiveKeeper() {
        if (msg.sender != keeper || strategyOwner == address(0) || collection.ownerOf(tokenId) != strategyOwner) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    function configure(address keeper_, uint256 maximumCycleWeth_, uint16 claimBps_, uint16 slippageBps_, uint32 cooldownSeconds_)
        external onlyNftOwner
    {
        if (positionToken != address(0)) revert PositionOpen();
        if (keeper_ == address(0) || maximumCycleWeth_ == 0 || claimBps_ > BPS || slippageBps_ > MAX_SLIPPAGE_BPS) {
            revert InvalidConfiguration();
        }
        strategyOwner = msg.sender;
        keeper = keeper_;
        maximumCycleWeth = maximumCycleWeth_;
        claimBps = claimBps_;
        maximumSlippageBps = slippageBps_;
        cooldownSeconds = cooldownSeconds_;
        tradingPaused = false;
        emit StrategyConfigured(msg.sender, keeper_, maximumCycleWeth_, claimBps_, slippageBps_, cooldownSeconds_);
    }

    function adoptAfterTransfer(address keeper_, uint256 maximumCycleWeth_, uint16 claimBps_, uint16 slippageBps_, uint32 cooldownSeconds_)
        external onlyNftOwner
    {
        if (strategyOwner == msg.sender) revert InvalidConfiguration();
        if (keeper_ == address(0) || maximumCycleWeth_ == 0 || claimBps_ > BPS || slippageBps_ > MAX_SLIPPAGE_BPS) {
            revert InvalidConfiguration();
        }
        strategyOwner = msg.sender;
        keeper = keeper_;
        maximumCycleWeth = maximumCycleWeth_;
        claimBps = claimBps_;
        maximumSlippageBps = slippageBps_;
        cooldownSeconds = cooldownSeconds_;
        tradingPaused = true;
        emit StrategyConfigured(msg.sender, keeper_, maximumCycleWeth_, claimBps_, slippageBps_, cooldownSeconds_);
    }

    function setPaused(bool paused_) external onlyNftOwner {
        if (!paused_ && (maximumDailyLossWeth == 0 || maximumConsecutiveLosses == 0)) revert InvalidConfiguration();
        tradingPaused = paused_;
        emit TradingPaused(msg.sender, paused_);
    }

    function configureRiskLimits(uint256 maximumDailyLossWeth_, uint8 maximumConsecutiveLosses_) external onlyNftOwner {
        if (positionToken != address(0)) revert PositionOpen();
        if (maximumDailyLossWeth_ == 0 || maximumConsecutiveLosses_ == 0 || maximumConsecutiveLosses_ > 10) {
            revert InvalidConfiguration();
        }
        maximumDailyLossWeth = maximumDailyLossWeth_;
        maximumConsecutiveLosses = maximumConsecutiveLosses_;
        dailyRealizedLossWeth = 0;
        consecutiveLosses = 0;
        lossWindowStartedAt = uint64(block.timestamp);
        emit RiskLimitsConfigured(msg.sender, maximumDailyLossWeth_, maximumConsecutiveLosses_);
    }

    function depositEth() external payable onlyNftOwner nonReentrant {
        if (msg.value == 0) revert InvalidConfiguration();
        weth.deposit{value: msg.value}();
        emit CapitalDeposited(msg.sender, msg.value);
    }

    function openPosition(address token, uint256 wethAmount, uint256 minimumOut) external onlyActiveKeeper nonReentrant {
        if (tradingPaused) revert Paused();
        if (maximumDailyLossWeth == 0 || maximumConsecutiveLosses == 0) revert InvalidConfiguration();
        if (positionToken != address(0)) revert PositionOpen();
        if (token != address(rare) && token != address(lemon)) revert InvalidAsset();
        if (wethAmount == 0 || wethAmount > maximumCycleWeth || wethAmount > weth.balanceOf(address(this))) revert LimitExceeded();
        _checkCooldown();
        uint256 guardedMinimum = priceGuard.minimumOut(address(weth), token, wethAmount, maximumSlippageBps);
        if (minimumOut < guardedMinimum) revert UnsafeQuote();
        IWorkSwapAdapter adapter = token == address(rare) ? rareAdapter : lemonAdapter;
        uint256 beforeBalance = IWorkERC20(token).balanceOf(address(this));
        _approveExact(weth, address(adapter), wethAmount);
        adapter.swap(address(weth), token, wethAmount, minimumOut, address(this));
        _approveExact(weth, address(adapter), 0);
        uint256 received = IWorkERC20(token).balanceOf(address(this)) - beforeBalance;
        if (received < minimumOut) revert UnsafeQuote();
        positionToken = token;
        positionPrincipalWeth = wethAmount;
        positionTokenAmount = received;
        lastTradeAt = uint64(block.timestamp);
        emit PositionOpened(token, wethAmount, received);
    }

    function closePosition(uint256 minimumOut) external onlyActiveKeeper nonReentrant {
        if (tradingPaused) revert Paused();
        _closePosition(minimumOut);
    }

    function ownerClosePosition(uint256 minimumOut) external onlyNftOwner nonReentrant {
        _closePosition(minimumOut);
    }

    function withdrawAll(address recipient) external onlyNftOwner nonReentrant {
        if (recipient == address(0)) revert InvalidConfiguration();
        if (positionToken != address(0)) revert PositionOpen();
        uint256 wethAmount = weth.balanceOf(address(this));
        uint256 rareAmount = rare.balanceOf(address(this));
        uint256 lemonAmount = lemon.balanceOf(address(this));
        if (wethAmount != 0 && !weth.transfer(recipient, wethAmount)) revert TransferFailed();
        if (rareAmount != 0 && !rare.transfer(recipient, rareAmount)) revert TransferFailed();
        if (lemonAmount != 0 && !lemon.transfer(recipient, lemonAmount)) revert TransferFailed();
        emit CapitalWithdrawn(msg.sender, recipient, wethAmount, rareAmount, lemonAmount);
    }

    function _closePosition(uint256 minimumOut) internal {
        address token = positionToken;
        if (token == address(0)) revert NoPosition();
        _checkCooldown();
        uint256 amount = positionTokenAmount;
        uint256 guardedMinimum = priceGuard.minimumOut(token, address(weth), amount, maximumSlippageBps);
        if (minimumOut < guardedMinimum) revert UnsafeQuote();
        IWorkSwapAdapter adapter = token == address(rare) ? rareAdapter : lemonAdapter;
        uint256 beforeWeth = weth.balanceOf(address(this));
        _approveExact(IWorkERC20(token), address(adapter), amount);
        adapter.swap(token, address(weth), amount, minimumOut, address(this));
        _approveExact(IWorkERC20(token), address(adapter), 0);
        uint256 received = weth.balanceOf(address(this)) - beforeWeth;
        if (received < minimumOut) revert UnsafeQuote();
        uint256 principal = positionPrincipalWeth;
        uint256 profit = received > principal ? received - principal : 0;
        uint256 loss = principal > received ? principal - received : 0;
        uint256 claimAmount = profit * claimBps / BPS;
        address beneficiary = strategyOwner;
        positionToken = address(0);
        positionPrincipalWeth = 0;
        positionTokenAmount = 0;
        lastTradeAt = uint64(block.timestamp);
        if (claimAmount != 0) {
            if (!weth.transfer(address(profitEscrow), claimAmount)) revert TransferFailed();
            profitEscrow.credit(beneficiary, claimAmount);
        }
        if (loss != 0) {
            if (lossWindowStartedAt == 0 || block.timestamp >= uint256(lossWindowStartedAt) + 1 days) {
                lossWindowStartedAt = uint64(block.timestamp);
                dailyRealizedLossWeth = 0;
            }
            dailyRealizedLossWeth += loss;
            if (consecutiveLosses < type(uint8).max) consecutiveLosses += 1;
            bool stop = dailyRealizedLossWeth >= maximumDailyLossWeth || consecutiveLosses >= maximumConsecutiveLosses;
            if (stop) tradingPaused = true;
            emit LossRecorded(loss, dailyRealizedLossWeth, consecutiveLosses, stop);
        } else if (profit != 0) {
            consecutiveLosses = 0;
        }
        emit PositionClosed(token, amount, received, profit, claimAmount);
    }

    function _checkCooldown() internal view {
        if (lastTradeAt != 0 && block.timestamp < uint256(lastTradeAt) + cooldownSeconds) revert Cooldown();
    }

    function _approveExact(IWorkERC20 token, address spender, uint256 amount) internal {
        if (!token.approve(spender, 0)) revert TransferFailed();
        if (amount != 0 && !token.approve(spender, amount)) revert TransferFailed();
    }
}

contract UltraRareWorkAgentFactory {
    error Unauthorized();
    error AlreadyActivated();

    IWorkNFT public immutable collection;
    address public immutable weth;
    address public immutable rare;
    address public immutable lemon;
    address public immutable rareAdapter;
    address public immutable lemonAdapter;
    address public immutable priceGuard;
    mapping(uint256 => address) public agentOf;

    event AgentActivated(uint256 indexed tokenId, address indexed owner, address agent, address profitEscrow);

    constructor(address collection_, address weth_, address rare_, address lemon_, address rareAdapter_, address lemonAdapter_, address priceGuard_) {
        collection = IWorkNFT(collection_);
        weth = weth_;
        rare = rare_;
        lemon = lemon_;
        rareAdapter = rareAdapter_;
        lemonAdapter = lemonAdapter_;
        priceGuard = priceGuard_;
    }

    function activate(uint256 tokenId) external returns (address agent) {
        if (collection.ownerOf(tokenId) != msg.sender) revert Unauthorized();
        if (agentOf[tokenId] != address(0)) revert AlreadyActivated();
        UltraRareWorkAgent deployed = new UltraRareWorkAgent{salt: bytes32(tokenId)}(
            address(collection), tokenId, weth, rare, lemon, rareAdapter, lemonAdapter, priceGuard
        );
        agent = address(deployed);
        agentOf[tokenId] = agent;
        emit AgentActivated(tokenId, msg.sender, agent, address(deployed.profitEscrow()));
    }
}
