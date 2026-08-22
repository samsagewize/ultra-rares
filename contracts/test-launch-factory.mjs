import fs from 'node:fs';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import solc from 'solc';
import { BrowserProvider, Contract, ContractFactory, parseEther, parseUnits } from 'ethers';

const files = ['RareLaunchFactory.sol', 'MockRewardAsset.sol'];
const sources = Object.fromEntries(files.map((file) => [file, { content: fs.readFileSync(new URL(file, import.meta.url), 'utf8') }]));
const input = { language: 'Solidity', sources, settings: { evmVersion: 'shanghai', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } };
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter((entry) => entry.severity === 'error');
assert.equal(errors.length, 0, errors.map((entry) => entry.formattedMessage).join('\n'));

const provider = new BrowserProvider(ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 10 } }));
const [admin, creator, buyer, treasury, stranger] = await Promise.all([0, 1, 2, 3, 4].map((index) => provider.getSigner(index)));
const deploy = async (file, name, signer, args = []) => {
  const artifact = output.contracts[file][name];
  const contract = await new ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`, signer).deploy(...args);
  return contract.waitForDeployment();
};
const expectRevert = async (promise, label) => {
  let reverted = false;
  try { const transaction = await promise; if (transaction?.wait) await transaction.wait(); } catch { reverted = true; }
  assert.equal(reverted, true, label);
};
const rareUnits = (value) => parseUnits(value, 18);
const launchFee = rareUnits('250000');
const virtualEth = parseEther('1');
const rare = await deploy('MockRewardAsset.sol', 'MockRewardAsset', admin, ['RARE', 'RARE', 18]);
const vaultAddress = await stranger.getAddress();
const factory = await deploy('RareLaunchFactory.sol', 'RareLaunchFactory', admin, [await rare.getAddress(), vaultAddress, await admin.getAddress(), await treasury.getAddress(), virtualEth]);
const factoryAddress = await factory.getAddress();
const creatorAddress = await creator.getAddress();

assert.equal(await factory.GRADUATION_ENABLED(), false, 'pilot graduation is disabled');
assert.equal(await factory.FACTORY_VERSION(), 2n, 'zero-ETH creation factory is explicitly versioned');
assert.equal(await factory.FIXED_TOKEN_SUPPLY(), rareUnits('1000000000'), 'all launches use one billion tokens');
await expectRevert(factory.connect(stranger).createToken('Blocked', 'NO', launchFee), 'public creation starts disabled');
await expectRevert(factory.createToken('Bad', 'bad!', launchFee), 'symbols are restricted to uppercase letters and numbers');
await expectRevert(factory.createToken('First Rare', 'FIRST', launchFee - 1n), 'launch fee maximum protects the payer');

await (await rare.mint(await admin.getAddress(), launchFee * 3n)).wait();
await (await rare.approve(factoryAddress, launchFee * 3n)).wait();
const openingBuy = parseEther('0.001');
await expectRevert(factory.createToken('First Rare', 'FIRST', launchFee, { value: openingBuy }), 'token creation rejects attached ETH');
await (await factory.createToken('First Rare', 'FIRST', launchFee, { gasLimit: 7_000_000 })).wait();
const tokenAddress = await factory.allTokens(0);
const tokenArtifact = output.contracts['RareLaunchFactory.sol'].RareLaunchToken;
const token = new Contract(tokenAddress, tokenArtifact.abi, provider);
const deadline = BigInt((await provider.getBlock('latest')).timestamp + 600);
assert.equal(await provider.getBalance(factoryAddress), 0n, 'creation carries no ETH');
const openingQuote = await factory.quoteBuy(tokenAddress, openingBuy);
await (await factory.buy(tokenAddress, openingQuote[0], deadline, { value: openingBuy })).wait();
let launch = await factory.launches(tokenAddress);
const openingFee = openingBuy * 100n / 10_000n;
const openingTreasury = openingFee * 300n / 10_000n;

assert.equal(await factory.tokenCount(), 1n, 'new token is discoverable');
assert.equal(await rare.balanceOf(vaultAddress), launchFee, 'fixed RARE launch payment reaches the Vault');
assert.equal(await token.totalSupply(), rareUnits('1000000000'), 'deployed token supply is exactly one billion');
assert.equal(await token.balanceOf(await admin.getAddress()) > 0n, true, 'opening buyer receives tokens');
assert.equal(launch.realEth, openingBuy - openingFee, 'only net ETH backs redemptions');
assert.equal(launch.creator, await admin.getAddress(), 'the transaction sender is the immutable token creator');
assert.equal(launch.creatorFees, openingFee - openingTreasury, 'creator accrues 97% of the trading fee');
assert.equal(launch.treasuryFees, openingTreasury, 'treasury accrues 3% of the trading fee');
assert.equal(await provider.getBalance(factoryAddress), openingBuy, 'all ETH is accounted inside the factory');

const quote = await factory.quoteBuy(tokenAddress, parseEther('0.01'));
assert.equal(quote[0] > 0n, true, 'buy quote returns tokens');
assert.equal(quote[1], parseEther('0.0001'), 'buy quote shows exact 1% fee');
await expectRevert(factory.connect(buyer).buy(tokenAddress, quote[0], 1, { value: parseEther('0.01') }), 'expired buys are rejected');
await expectRevert(factory.connect(buyer).buy(tokenAddress, quote[0] + 1n, deadline, { value: parseEther('0.01') }), 'buy minimum output is enforced');
await (await factory.connect(buyer).buy(tokenAddress, quote[0], deadline, { value: parseEther('0.01') })).wait();
const buyerTokens = await token.balanceOf(await buyer.getAddress());
assert.equal(buyerTokens, quote[0], 'public buyer receives the quoted amount');

await (await token.connect(buyer).approve(factoryAddress, buyerTokens)).wait();
const sellQuote = await factory.quoteSell(tokenAddress, buyerTokens);
assert.equal(sellQuote[2], true, 'quoted sale is reserve-backed');
await expectRevert(factory.connect(buyer).sell(tokenAddress, buyerTokens, sellQuote[0], 1), 'expired sells are rejected');
await expectRevert(factory.connect(buyer).sell(tokenAddress, buyerTokens, sellQuote[0] + 1n, deadline), 'sell minimum ETH output is enforced');
const buyerEthBefore = await provider.getBalance(await buyer.getAddress());
const sellTransaction = await factory.connect(buyer).sell(tokenAddress, buyerTokens, sellQuote[0], deadline);
const sellReceipt = await sellTransaction.wait();
const buyerEthAfter = await provider.getBalance(await buyer.getAddress());
assert.equal(buyerEthAfter + sellReceipt.gasUsed * sellReceipt.gasPrice > buyerEthBefore, true, 'seller receives reserve-backed ETH');

launch = await factory.launches(tokenAddress);
assert.equal(await provider.getBalance(factoryAddress), launch.realEth + launch.creatorFees + launch.treasuryFees, 'contract ETH equals backing plus both fee liabilities');
await expectRevert(factory.connect(stranger).claimCreatorFees(tokenAddress), 'only the configured creator can claim creator fees');
const creatorBefore = await provider.getBalance(await admin.getAddress());
const creatorClaim = await factory.claimCreatorFees(tokenAddress);
const creatorReceipt = await creatorClaim.wait();
assert.equal((await provider.getBalance(await admin.getAddress())) + creatorReceipt.gasUsed * creatorReceipt.gasPrice - creatorBefore > 0n, true, 'creator can claim accrued ETH');

const treasuryBefore = await provider.getBalance(await treasury.getAddress());
const treasuryClaim = await factory.connect(stranger).claimTreasuryFees(tokenAddress);
const treasuryReceipt = await treasuryClaim.wait();
assert.equal((await provider.getBalance(await treasury.getAddress(), treasuryReceipt.blockNumber)) > treasuryBefore, true, 'anyone may trigger payment only to immutable treasury');
assert.equal((await factory.launches(tokenAddress)).treasuryFees, 0n, 'treasury liability clears after payment');
await expectRevert(factory.connect(stranger).claimTreasuryFees(tokenAddress), 'treasury fees cannot be claimed twice');
await expectRevert(admin.sendTransaction({ to: factoryAddress, value: 1n }), 'unsolicited ETH is rejected');

await (await factory.enablePublicCreation()).wait();
assert.equal(await factory.publicCreationEnabled(), true, 'admin can irreversibly open public creation');
await expectRevert(factory.enablePublicCreation(), 'public creation cannot be toggled or enabled twice');
await (await rare.mint(await stranger.getAddress(), launchFee)).wait();
await (await rare.connect(stranger).approve(factoryAddress, launchFee)).wait();
await (await factory.connect(stranger).createToken('Public Rare', 'PUBLIC', launchFee, { gasLimit: 7_000_000 })).wait();
assert.equal(await factory.tokenCount(), 2n, 'public creation works only after irreversible enablement');
await (await factory.connect(stranger).buy(await factory.allTokens(1), 1, deadline, { value: 1n })).wait();
assert.equal(await provider.getBalance(factoryAddress) > 0n, true, 'one-wei public buy is accepted when it produces tokens');
const tinyToken = new Contract(await factory.allTokens(1), tokenArtifact.abi, provider);
const tinyBalance = await tinyToken.balanceOf(await stranger.getAddress());
const tinySell = await factory.quoteSell(await factory.allTokens(1), tinyBalance);
assert.equal(tinySell[0], 0n, 'rounding never turns a one-wei buy into a profitable sell');

console.log('Native ETH launch factory safety tests passed: 36 assertions');
