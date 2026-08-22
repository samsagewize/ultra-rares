import fs from 'node:fs';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import solc from 'solc';
import { BrowserProvider, Contract, ContractFactory, keccak256, parseEther, parseUnits, toUtf8Bytes } from 'ethers';

const files = ['RareLaunchFactory.sol', 'MockRewardAsset.sol', 'MockLaunchAdversary.sol', 'MockWorkInfrastructure.sol', 'MockUniswapV3.sol'];
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
const graduationTarget = parseEther('1.1');
const rare = await deploy('MockRewardAsset.sol', 'MockRewardAsset', admin, ['RARE', 'RARE', 18]);
const weth = await deploy('MockWorkInfrastructure.sol', 'MockWorkWETH', admin);
const uniFactory = await deploy('MockUniswapV3.sol', 'MockV3Factory', admin);
const positionManager = await deploy('MockUniswapV3.sol', 'MockPositionManager', admin, [await uniFactory.getAddress(), await weth.getAddress()]);
const vaultAddress = await stranger.getAddress();
const factory = await deploy('RareLaunchFactory.sol', 'RareLaunchFactory', admin, [await rare.getAddress(), vaultAddress, await admin.getAddress(), await treasury.getAddress(), virtualEth, graduationTarget, await positionManager.getAddress(), await weth.getAddress()]);
const factoryAddress = await factory.getAddress();
const creatorAddress = await creator.getAddress();

assert.equal(await factory.GRADUATION_ENABLED(), true, 'V4 graduation is enabled');
assert.equal(await factory.PUBLIC_CREATION_ENABLED(), false, 'pilot creation is permanently admin-only');
assert.equal(await factory.FACTORY_VERSION(), 4n, 'locked-liquidity factory is explicitly versioned');
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
assert.equal(await factory.tokenBySymbolHash(keccak256(toUtf8Bytes('FIRST'))), tokenAddress, 'symbol is reserved to exactly one launch');
await expectRevert(factory.createToken('Imposter', 'FIRST', launchFee), 'duplicate ticker symbols are rejected');
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

await (await rare.mint(await stranger.getAddress(), launchFee)).wait();
await (await rare.connect(stranger).approve(factoryAddress, launchFee)).wait();
await expectRevert(factory.connect(stranger).createToken('Public Rare', 'PUBLIC', launchFee), 'public creation cannot be enabled in the pilot');
await (await factory.createToken('Second Rare', 'SECOND', launchFee, { gasLimit: 7_000_000 })).wait();
assert.equal(await factory.tokenCount(), 2n, 'admin may safely create a second unique launch');
await (await factory.connect(stranger).buy(await factory.allTokens(1), 1, deadline, { value: 1n })).wait();
assert.equal(await provider.getBalance(factoryAddress) > 0n, true, 'one-wei public buy is accepted when it produces tokens');
const tinyToken = new Contract(await factory.allTokens(1), tokenArtifact.abi, provider);
const tinyBalance = await tinyToken.balanceOf(await stranger.getAddress());
const tinySell = await factory.quoteSell(await factory.allTokens(1), tinyBalance);
assert.equal(tinySell[0], 0n, 'rounding never turns a one-wei buy into a profitable sell');

const adversary = await deploy('MockLaunchAdversary.sol', 'MockLaunchAdversary', stranger, [factoryAddress, tokenAddress]);
const adversaryAddress = await adversary.getAddress();
await (await adversary.connect(stranger).buyForTest(deadline, { value: parseEther('0.001') })).wait();
const adversaryTokens = await token.balanceOf(adversaryAddress);
await (await adversary.connect(stranger).sellForTest(adversaryTokens, deadline)).wait();
assert.equal(await adversary.reentryAttempted(), true, 'hostile receiver attempted a callback trade');
assert.equal(await adversary.reentrySucceeded(), false, 'callback reentrancy is blocked while the outer sale completes');

for (const ethText of ['0.000001', '0.00001', '0.0001', '0.001', '0.01', '0.1']) {
  const ethIn = parseEther(ethText);
  const before = await factory.launches(tokenAddress);
  const buyResult = await factory.quoteBuy(tokenAddress, ethIn);
  const netEth = ethIn - buyResult[1];
  const postVirtualEth = before.virtualEth + netEth;
  const postVirtualToken = before.virtualToken - buyResult[0];
  const reverseGross = buyResult[0] * postVirtualEth / (postVirtualToken + buyResult[0]);
  const reverseFee = reverseGross * 100n / 10_000n;
  assert.equal(reverseGross - reverseFee < ethIn, true, `immediate ${ethText} ETH round trip cannot extract profit`);
}

const secondAddress = await factory.allTokens(1);
const firstLaunch = await factory.launches(tokenAddress);
const secondLaunch = await factory.launches(secondAddress);
assert.equal(
  await provider.getBalance(factoryAddress),
  firstLaunch.realEth + firstLaunch.creatorFees + firstLaunch.treasuryFees + secondLaunch.realEth + secondLaunch.creatorFees + secondLaunch.treasuryFees,
  'every wei is attributable across independent launch reserves and fee liabilities',
);
assert.equal(
  await token.balanceOf(factoryAddress) + await token.balanceOf(await admin.getAddress()) + await token.balanceOf(await buyer.getAddress()) + await token.balanceOf(adversaryAddress),
  await token.totalSupply(),
  'the first launch token supply is conserved across all participants',
);

await expectRevert(factory.graduate(tokenAddress, deadline), 'graduation before the immutable market-cap target is rejected');
const graduationBuy = parseEther('0.1');
const graduationQuote = await factory.quoteBuy(tokenAddress, graduationBuy);
await (await factory.buy(tokenAddress, graduationQuote[0], deadline, { value: graduationBuy })).wait();
assert.equal(await factory.marketCapEth(tokenAddress) >= graduationTarget, true, 'curve reaches the immutable graduation target');
await (await factory.connect(stranger).graduate(tokenAddress, deadline, { gasLimit: 8_000_000 })).wait();
const graduatedLaunch = await factory.launches(tokenAddress);
assert.equal(graduatedLaunch.graduated, true, 'graduation state is permanent');
assert.equal(graduatedLaunch.realEth, 0n, 'all real curve backing leaves for Uniswap liquidity');
const migratorAddress = await factory.graduationMigrator();
const migratorArtifact = output.contracts['RareLaunchFactory.sol'].RareV3Migrator;
const migrator = new Contract(migratorAddress, migratorArtifact.abi, provider);
const lockerAddress = await migrator.locker();
assert.equal(await positionManager.ownerOf(1), lockerAddress, 'the Uniswap LP NFT is minted directly to the permanent locker');
assert.equal(await token.balanceOf(await positionManager.getAddress()) > 0n, true, 'Uniswap position manager receives token liquidity');
assert.equal(await weth.balanceOf(await positionManager.getAddress()) > 0n, true, 'Uniswap position manager receives wrapped ETH liquidity');
await expectRevert(factory.graduate(tokenAddress, deadline), 'a token cannot graduate twice');
await expectRevert(factory.buy(tokenAddress, 0, deadline, { value: 1n }), 'curve buys stop permanently after graduation');
await expectRevert(migrator.connect(stranger).migrate(tokenAddress, await stranger.getAddress(), 1, deadline, { value: 1n }), 'only the immutable factory can invoke the migrator');
const lockerArtifact = output.contracts['RareLaunchFactory.sol'].RareV3LiquidityLocker;
assert.equal(lockerArtifact.abi.some((entry) => ['transferFrom', 'safeTransferFrom', 'decreaseLiquidity'].includes(entry.name)), false, 'LP locker exposes no NFT transfer or liquidity removal path');

await (await factory.createToken('Guarded Rare', 'GUARD', launchFee, { gasLimit: 7_000_000 })).wait();
const guardedAddress = await factory.allTokens(2);
const guardedBuy = parseEther('0.1');
const guardedQuote = await factory.quoteBuy(guardedAddress, guardedBuy);
await (await factory.buy(guardedAddress, guardedQuote[0], deadline, { value: guardedBuy })).wait();
const wethAddress = await weth.getAddress();
const guardedToken0 = BigInt(guardedAddress) < BigInt(wethAddress) ? guardedAddress : wethAddress;
const guardedToken1 = guardedToken0 === guardedAddress ? wethAddress : guardedAddress;
await (await uniFactory.createPool(guardedToken0, guardedToken1, 3000, 1)).wait();
await expectRevert(factory.graduate(guardedAddress, deadline), 'a pre-created Uniswap pool at a manipulated price blocks graduation');

console.log('Native ETH launch factory safety tests passed: 61 assertions');
