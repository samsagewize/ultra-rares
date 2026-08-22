// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMockLaunchToken {
    function transferFrom(address from,address to,uint256 amount) external returns(bool);
}

contract MockLaunchFeeOracle {
    uint256 public quote; uint256 public updatedAt;
    function set(uint256 quote_,uint256 updatedAt_) external { quote=quote_; updatedAt=updatedAt_; }
    function rareForEth(uint256) external view returns(uint256,uint256){ return(quote,updatedAt); }
}

contract MockLaunchMarketCapOracle {
    mapping(address=>uint256) public cap; mapping(address=>uint256) public time;
    function set(address token,uint256 cap_,uint256 time_) external { cap[token]=cap_; time[token]=time_; }
    function marketCapUsd(address token) external view returns(uint256,uint256){ return(cap[token],time[token]); }
}

contract MockLaunchMigrator {
    address public lastToken; address public lastRare; address public lastCreator; uint256 public lastTokenAmount; uint256 public lastRareAmount;
    function graduate(address token,address rare,uint256 tokenAmount,uint256 rareAmount,address creator) external {
        IMockLaunchToken(token).transferFrom(msg.sender,address(this),tokenAmount);
        IMockLaunchToken(rare).transferFrom(msg.sender,address(this),rareAmount);
        lastToken=token; lastRare=rare; lastCreator=creator; lastTokenAmount=tokenAmount; lastRareAmount=rareAmount;
    }
}
