// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMockWorkERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract MockWorkWETH {
    string public constant name = "Wrapped Ether";
    string public constant symbol = "WETH";
    uint8 public constant decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    receive() external payable { deposit(); }
    function deposit() public payable { balanceOf[msg.sender] += msg.value; }
    function withdraw(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        (bool sent,) = payable(msg.sender).call{value: amount}("");
        require(sent, "eth");
    }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
    function transfer(address to, uint256 amount) external returns (bool) { _transfer(msg.sender, to, amount); return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 permitted = allowance[from][msg.sender];
        require(permitted >= amount, "allowance");
        if (permitted != type(uint256).max) allowance[from][msg.sender] = permitted - amount;
        _transfer(from, to, amount);
        return true;
    }
    function _transfer(address from, address to, uint256 amount) internal { require(balanceOf[from] >= amount, "balance"); balanceOf[from] -= amount; balanceOf[to] += amount; }
}

contract MockWorkPriceGuard {
    struct Rate { uint256 numerator; uint256 denominator; }
    mapping(bytes32 => Rate) public rates;
    function setRate(address tokenIn, address tokenOut, uint256 numerator, uint256 denominator) external {
        require(numerator != 0 && denominator != 0, "rate");
        rates[keccak256(abi.encode(tokenIn, tokenOut))] = Rate(numerator, denominator);
    }
    function minimumOut(address tokenIn, address tokenOut, uint256 amountIn, uint16 slippageBps) external view returns (uint256) {
        Rate memory rate = rates[keccak256(abi.encode(tokenIn, tokenOut))];
        require(rate.denominator != 0, "missing rate");
        return amountIn * rate.numerator / rate.denominator * (10_000 - slippageBps) / 10_000;
    }
}

contract MockWorkSwapAdapter {
    struct Rate { uint256 numerator; uint256 denominator; }
    mapping(bytes32 => Rate) public rates;
    function setRate(address tokenIn, address tokenOut, uint256 numerator, uint256 denominator) external {
        require(numerator != 0 && denominator != 0, "rate");
        rates[keccak256(abi.encode(tokenIn, tokenOut))] = Rate(numerator, denominator);
    }
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minimumOut, address recipient) external returns (uint256 amountOut) {
        Rate memory rate = rates[keccak256(abi.encode(tokenIn, tokenOut))];
        require(rate.denominator != 0, "missing rate");
        amountOut = amountIn * rate.numerator / rate.denominator;
        require(amountOut >= minimumOut, "slippage");
        require(IMockWorkERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), "input");
        require(IMockWorkERC20(tokenOut).transfer(recipient, amountOut), "output");
    }
}
