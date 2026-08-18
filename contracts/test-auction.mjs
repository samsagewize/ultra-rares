import fs from 'node:fs';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import solc from 'solc';
import { BrowserProvider, ContractFactory, parseUnits } from 'ethers';

const files = ['RareAuctionHouse.sol', 'RareFeeVault.sol', 'MockUltraRares.sol', 'MockRewardAsset.sol'];
const sources = Object.fromEntries(files.map((file) => [file, { content: fs.readFileSync(new URL(file, import.meta.url), 'utf8') }]));
const output = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources,
  settings: { evmVersion: 'shanghai', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
})));
const errors = (output.errors || []).filter(({ severity }) => severity === 'error');
assert.equal(errors.length, 0, errors.map(({ formattedMessage }) => formattedMessage).join('\n'));

const artifact = (file, name) => output.contracts[file][name];
const provider = new BrowserProvider(ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 8 } }));
const [owner, seller, bidderOne, bidderTwo, claims, liquidity] = await Promise.all([0, 1, 2, 3, 4, 5].map((index) => provider.getSigner(index)));
const deploy = async (file, name, signer, args = []) => {
  const contractArtifact = artifact(file, name);
  const contract = await new ContractFactory(contractArtifact.abi, `0x${contractArtifact.evm.bytecode.object}`, signer).deploy(...args);
  return contract.waitForDeployment();
};
const expectRevert = async (promise, label) => {
  let reverted = false;
  try { await promise; } catch { reverted = true; }
  assert.equal(reverted, true, label);
};

const rare = await deploy('MockRewardAsset.sol', 'MockRewardAsset', owner, ['RARE', 'RARE', 18]);
const nft = await deploy('MockUltraRares.sol', 'MockUltraRares', owner);
const vault = await deploy('RareFeeVault.sol', 'RareFeeVault', owner, [await rare.getAddress(), await owner.getAddress()]);
const auction = await deploy('RareAuctionHouse.sol', 'RareAuctionHouse', owner, [await nft.getAddress(), await rare.getAddress(), await vault.getAddress()]);

await (await vault.setFeeSource(await auction.getAddress(), true)).wait();
await (await vault.setDestinations(await claims.getAddress(), await liquidity.getAddress())).wait();
await (await vault.lockConfiguration()).wait();

const reserve = parseUnits('100000', 18);
const higherBid = parseUnits('120000', 18);
await (await nft.mint(await seller.getAddress(), 420)).wait();
await (await rare.mint(await bidderOne.getAddress(), reserve)).wait();
await (await rare.mint(await bidderTwo.getAddress(), higherBid)).wait();
await (await rare.connect(bidderOne).approve(await auction.getAddress(), reserve)).wait();
await (await rare.connect(bidderTwo).approve(await auction.getAddress(), higherBid)).wait();

await expectRevert(auction.connect(seller).createAuction(420, reserve, 7200), 'Only 1-hour or 1-day durations must be accepted');
await (await nft.connect(seller).approve(await auction.getAddress(), 420)).wait();
await (await auction.connect(seller).createAuction(420, reserve, 3600)).wait();
assert.equal(await nft.ownerOf(420), await auction.getAddress(), 'Auction must escrow the NFT');
await expectRevert(auction.connect(bidderOne).bid(420, reserve - 1n), 'A bid below the seller minimum must revert');
await (await auction.connect(bidderOne).bid(420, reserve)).wait();
await (await auction.connect(bidderTwo).bid(420, higherBid)).wait();
assert.equal(await auction.pendingReturns(await bidderOne.getAddress()), reserve, 'Outbid funds must become withdrawable');
await expectRevert(auction.connect(seller).cancelAuction(420), 'Seller must not cancel after a bid');

await provider.send('evm_increaseTime', [3601]);
await provider.send('evm_mine', []);
const sellerBefore = await rare.balanceOf(await seller.getAddress());
await (await auction.settle(420)).wait();
const fee = higherBid * 200n / 10000n;
assert.equal(await nft.ownerOf(420), await bidderTwo.getAddress(), 'Winner must receive the NFT');
assert.equal((await rare.balanceOf(await seller.getAddress())) - sellerBefore, higherBid - fee, 'Seller must receive 98%');
assert.equal(await vault.claimReserve(), fee / 2n, 'Half the fee must accrue to claims');
assert.equal(await vault.liquidityReserve(), fee - fee / 2n, 'Half the fee must accrue to liquidity/buybacks');

const bidderOneBefore = await rare.balanceOf(await bidderOne.getAddress());
await (await auction.connect(bidderOne).withdrawRefund()).wait();
assert.equal((await rare.balanceOf(await bidderOne.getAddress())) - bidderOneBefore, reserve, 'Outbid bidder must recover the full bid');
await expectRevert(vault.connect(bidderOne).releaseClaims(1), 'Only the vault owner may release reserves');

await (await nft.mint(await seller.getAddress(), 419)).wait();
await (await nft.connect(seller).approve(await auction.getAddress(), 419)).wait();
await (await auction.connect(seller).createAuction(419, reserve, 86400)).wait();
await (await auction.connect(seller).cancelAuction(419)).wait();
assert.equal(await nft.ownerOf(419), await seller.getAddress(), 'A no-bid auction must be cancellable');

console.log('Auction safety tests passed: 15 assertions');
