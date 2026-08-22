import fs from 'node:fs';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import solc from 'solc';
import { BrowserProvider, Contract, ContractFactory, parseEther } from 'ethers';

const files = ['UltraRareWorkAgent.sol', 'MockUltraRares.sol', 'MockRewardAsset.sol', 'MockWorkInfrastructure.sol'];
const sources = Object.fromEntries(files.map((file) => [file, { content: fs.readFileSync(new URL(file, import.meta.url), 'utf8') }]));
const output = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources,
  settings: { evmVersion: 'shanghai', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
})));
const errors = (output.errors || []).filter(({ severity }) => severity === 'error');
assert.equal(errors.length, 0, errors.map(({ formattedMessage }) => formattedMessage).join('\n'));

const provider = new BrowserProvider(ganache.provider({ logging: { quiet: true } }));
const [admin, holder, keeper, stranger] = await Promise.all([0, 1, 2, 3].map((index) => provider.getSigner(index)));
const deploy = async (file, name, signer, args = []) => {
  const artifact = output.contracts[file][name];
  const contract = await new ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`, signer).deploy(...args);
  return contract.waitForDeployment();
};
const expectRevert = async (promise, label) => {
  let reverted = false;
  try {
    const result = await promise;
    if (result && typeof result.wait === 'function') await result.wait();
  } catch { reverted = true; }
  assert.equal(reverted, true, label);
};

const nft = await deploy('MockUltraRares.sol', 'MockUltraRares', admin);
const rare = await deploy('MockRewardAsset.sol', 'MockRewardAsset', admin, ['RARE', 'RARE', 18]);
const lemon = await deploy('MockRewardAsset.sol', 'MockRewardAsset', admin, ['LEMON', 'LEMON', 18]);
const weth = await deploy('MockWorkInfrastructure.sol', 'MockWorkWETH', admin);
const adapter = await deploy('MockWorkInfrastructure.sol', 'MockWorkSwapAdapter', admin);
const guard = await deploy('MockWorkInfrastructure.sol', 'MockWorkPriceGuard', admin);
const factory = await deploy('UltraRareWorkAgent.sol', 'UltraRareWorkAgentFactory', admin, [
  await nft.getAddress(), await weth.getAddress(), await rare.getAddress(), await lemon.getAddress(),
  await adapter.getAddress(), await adapter.getAddress(), await guard.getAddress(),
]);

await (await nft.mint(await holder.getAddress(), 78)).wait();
await expectRevert(factory.connect(stranger).activate(78), 'Only the NFT owner may activate an agent');
await (await factory.connect(holder).activate(78)).wait();
await expectRevert(factory.connect(holder).activate(78), 'An NFT cannot activate twice');

const agentAddress = await factory.agentOf(78);
const agentArtifact = output.contracts['UltraRareWorkAgent.sol'].UltraRareWorkAgent;
const escrowArtifact = output.contracts['UltraRareWorkAgent.sol'].UltraRareProfitEscrow;
const agent = new Contract(agentAddress, agentArtifact.abi, holder);
const escrow = new Contract(await agent.profitEscrow(), escrowArtifact.abi, holder);

await expectRevert(
  agent.connect(stranger).configure(await keeper.getAddress(), parseEther('0.05'), 7000, 500, 0),
  'A non-owner cannot configure the agent',
);
await (await agent.configure(await keeper.getAddress(), parseEther('0.05'), 7000, 500, 0)).wait();
await (await agent.depositEth({ value: parseEther('0.1') })).wait();
assert.equal(await weth.balanceOf(agentAddress), parseEther('0.1'), 'Deposited ETH must become isolated WETH capital');

const wethAddress = await weth.getAddress();
const rareAddress = await rare.getAddress();
const lemonAddress = await lemon.getAddress();
for (const contract of [adapter, guard]) {
  await (await contract.setRate(wethAddress, rareAddress, 1000, 1)).wait();
  await (await contract.setRate(rareAddress, wethAddress, 12, 10000)).wait();
  await (await contract.setRate(wethAddress, lemonAddress, 500, 1)).wait();
  await (await contract.setRate(lemonAddress, wethAddress, 2, 1000)).wait();
}
await (await rare.mint(await adapter.getAddress(), parseEther('10000'))).wait();
await (await lemon.mint(await adapter.getAddress(), parseEther('10000'))).wait();
await (await weth.deposit({ value: parseEther('2') })).wait();
await (await weth.transfer(await adapter.getAddress(), parseEther('2'))).wait();

await expectRevert(
  agent.connect(keeper).openPosition(await stranger.getAddress(), parseEther('0.01'), 1),
  'The agent must reject every non-allowlisted token',
);
await expectRevert(
  agent.connect(keeper).openPosition(rareAddress, parseEther('0.051'), parseEther('48.45')),
  'The keeper cannot exceed the owner-defined cycle cap',
);
await expectRevert(
  agent.connect(keeper).openPosition(rareAddress, parseEther('0.05'), parseEther('1')),
  'The keeper cannot weaken the guarded minimum output',
);

await (await agent.connect(keeper).openPosition(rareAddress, parseEther('0.05'), parseEther('47.5'))).wait();
assert.equal(await agent.positionToken(), rareAddress, 'A RARE position must be recorded');
assert.equal(await agent.positionTokenAmount(), parseEther('50'), 'The exact acquired amount must be tracked');
await expectRevert(
  agent.connect(keeper).openPosition(lemonAddress, parseEther('0.01'), parseEther('4.75')),
  'Only one position may be open at a time',
);

try {
  await agent.connect(keeper).closePosition.staticCall(parseEther('0.057'));
} catch (error) {
  console.error('close static call failed', error.shortMessage, error.data);
  throw error;
}
await (await agent.connect(keeper).closePosition(parseEther('0.057'), { gasLimit: 1_000_000 })).wait();
assert.equal(await agent.positionToken(), '0x0000000000000000000000000000000000000000', 'Closing must clear position state');
assert.equal(await escrow.claimable(await holder.getAddress()), parseEther('0.007'), '70% of the 0.01 WETH profit must be claimable');
assert.equal(await weth.balanceOf(await escrow.getAddress()), parseEther('0.007'), 'Claimable profit must leave trading custody');
assert.equal(await weth.balanceOf(agentAddress), parseEther('0.103'), 'Principal and compounded profit must remain in the agent');

await expectRevert(escrow.connect(stranger).claimWeth(), 'Another wallet cannot claim a holder profit');
await (await escrow.claimWeth()).wait();
assert.equal(await weth.balanceOf(await holder.getAddress()), parseEther('0.007'), 'The credited holder can claim WETH at any time');
assert.equal(await escrow.claimable(await holder.getAddress()), 0n, 'Claim accounting must clear before transfer');

await (await nft.connect(holder).transferFrom(await holder.getAddress(), await stranger.getAddress(), 78)).wait();
await expectRevert(
  agent.connect(keeper).openPosition(rareAddress, parseEther('0.01'), parseEther('9.5')),
  'An NFT transfer must immediately invalidate the previous keeper',
);
await (await agent.connect(stranger).adoptAfterTransfer(await stranger.getAddress(), parseEther('0.02'), 5000, 300, 0)).wait();
assert.equal(await agent.tradingPaused(), true, 'A transferred agent must remain paused until the new owner opts in');
await (await agent.connect(stranger).withdrawAll(await stranger.getAddress())).wait();
assert.equal(await weth.balanceOf(agentAddress), 0n, 'The new NFT owner can withdraw remaining isolated capital');

console.log('Work-agent safety tests passed: 20 assertions');
