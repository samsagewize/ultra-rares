// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILaunchFactoryTarget {
    function buy(address token, uint256 minTokensOut, uint256 deadline) external payable returns (uint256);
    function sell(address token, uint256 tokensIn, uint256 minEthOut, uint256 deadline) external returns (uint256);
}

interface ILaunchTokenTarget {
    function approve(address spender, uint256 amount) external returns (bool);
}

contract MockLaunchAdversary {
    ILaunchFactoryTarget public immutable factory;
    address public immutable token;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    constructor(address factory_, address token_) {
        factory = ILaunchFactoryTarget(factory_);
        token = token_;
    }

    receive() external payable {
        if (!reentryAttempted) {
            reentryAttempted = true;
            try factory.buy{value: 1}(token, 0, block.timestamp + 1) {
                reentrySucceeded = true;
            } catch {}
        }
    }

    function buyForTest(uint256 deadline) external payable {
        factory.buy{value: msg.value}(token, 0, deadline);
    }

    function sellForTest(uint256 amount, uint256 deadline) external {
        ILaunchTokenTarget(token).approve(address(factory), amount);
        factory.sell(token, amount, 0, deadline);
    }
}
