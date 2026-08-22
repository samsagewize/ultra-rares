// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20LaunchPayment {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
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
    uint256 public constant BPS = 10_000;
    uint256 public constant TRADE_FEE_BPS = 100;
    uint256 public constant CREATOR_FEE_SHARE_BPS = 9_700;
    uint256 public constant TREASURY_FEE_SHARE_BPS = 300;
    uint256 public constant LAUNCH_FEE_RARE = 250_000 ether;
    uint256 public constant FIXED_TOKEN_SUPPLY = 1_000_000_000 ether;
    bool public constant GRADUATION_ENABLED = false;

    struct Launch {
        address creator;
        uint128 virtualEth;
        uint128 virtualToken;
        uint128 realEth;
        uint128 creatorFees;
        uint128 treasuryFees;
    }

    IERC20LaunchPayment public immutable rareToken;
    address public immutable raresVault;
    address public immutable launchAdmin;
    address public immutable ethTreasury;
    uint256 public immutable initialVirtualEth;
    bool public publicCreationEnabled;
    mapping(address token => Launch launch) public launches;
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
    error PublicCreationAlreadyEnabled();
    error DirectEthDisabled();
    error Expired();

    event TokenCreated(address indexed token, address indexed creator, string name, string symbol, uint256 supply, uint256 launchFeeRare, uint256 openingBuyEth);
    event Trade(address indexed token, address indexed trader, bool indexed isBuy, uint256 ethAmount, uint256 tokenAmount, uint256 fee);
    event CreatorFeesClaimed(address indexed token, address indexed creator, uint256 amount);
    event TreasuryFeesClaimed(address indexed token, address indexed treasury, uint256 amount);
    event PublicCreationEnabled();

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(address rareToken_, address raresVault_, address launchAdmin_, address ethTreasury_, uint256 initialVirtualEth_) {
        if (rareToken_ == address(0) || raresVault_ == address(0) || launchAdmin_ == address(0) || ethTreasury_ == address(0) || initialVirtualEth_ == 0 || initialVirtualEth_ > type(uint128).max) revert InvalidConfiguration();
        rareToken = IERC20LaunchPayment(rareToken_);
        raresVault = raresVault_;
        launchAdmin = launchAdmin_;
        ethTreasury = ethTreasury_;
        initialVirtualEth = initialVirtualEth_;
    }

    receive() external payable { revert DirectEthDisabled(); }

    function tokenCount() external view returns (uint256) { return allTokens.length; }

    /// @notice Permanently opens token creation to every wallet after the pilot is reviewed.
    function enablePublicCreation() external {
        if (msg.sender != launchAdmin) revert NotAdmin();
        if (publicCreationEnabled) revert PublicCreationAlreadyEnabled();
        publicCreationEnabled = true;
        emit PublicCreationEnabled();
    }

    function createToken(string calldata name, string calldata symbol, uint256 maxLaunchFeeRare, uint256 minOpeningTokens) external payable nonReentrant returns (address token) {
        if (!publicCreationEnabled && msg.sender != launchAdmin) revert NotAdmin();
        _validateMetadata(name, symbol);
        if (LAUNCH_FEE_RARE > maxLaunchFeeRare) revert Slippage();
        _pullRareExact(msg.sender, LAUNCH_FEE_RARE);
        _pushRareExact(raresVault, LAUNCH_FEE_RARE);

        token = address(new RareLaunchToken(name, symbol, address(this)));
        launches[token] = Launch(msg.sender, uint128(initialVirtualEth), uint128(FIXED_TOKEN_SUPPLY), 0, 0, 0);
        allTokens.push(token);
        emit TokenCreated(token, msg.sender, name, symbol, FIXED_TOKEN_SUPPLY, LAUNCH_FEE_RARE, msg.value);
        if (msg.value != 0) _buy(token, msg.sender, msg.value, minOpeningTokens);
        else if (minOpeningTokens != 0) revert Slippage();
    }

    function buy(address token, uint256 minTokensOut, uint256 deadline) external payable nonReentrant returns (uint256 tokensOut) {
        if (block.timestamp > deadline) revert Expired();
        tokensOut = _buy(token, msg.sender, msg.value, minTokensOut);
    }

    function sell(address token, uint256 tokensIn, uint256 minEthOut, uint256 deadline) external nonReentrant returns (uint256 ethOut) {
        if (block.timestamp > deadline) revert Expired();
        Launch storage launch = launches[token];
        if (launch.creator == address(0)) revert InvalidToken();
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
        if (ethIn == 0) return (0, 0);
        fee = ethIn * TRADE_FEE_BPS / BPS;
        uint256 netEth = ethIn - fee;
        tokensOut = netEth * uint256(launch.virtualToken) / (uint256(launch.virtualEth) + netEth);
    }

    function quoteSell(address token, uint256 tokensIn) external view returns (uint256 ethOut, uint256 fee, bool reserveSufficient) {
        Launch storage launch = launches[token];
        if (launch.creator == address(0)) revert InvalidToken();
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

    function _buy(address token, address buyer, uint256 ethIn, uint256 minTokensOut) private returns (uint256 tokensOut) {
        Launch storage launch = launches[token];
        if (launch.creator == address(0)) revert InvalidToken();
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
