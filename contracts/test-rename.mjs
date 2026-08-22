import fs from 'node:fs';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import solc from 'solc';
import { BrowserProvider, ContractFactory, parseUnits } from 'ethers';

const files = ['RareRenameRegistry.sol', 'MockUltraRares.sol', 'MockRewardAsset.sol'];
const sources = Object.fromEntries(files.map((file) => [file, { content: fs.readFileSync(new URL(file, import.meta.url), 'utf8') }]));
const output = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources,
  settings: { evmVersion: 'shanghai', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
})));
const errors = (output.errors || []).filter(({ severity }) => severity === 'error');
assert.equal(errors.length, 0, errors.map(({ formattedMessage }) => formattedMessage).join('\n'));

const provider = new BrowserProvider(ganache.provider({ logging: { quiet: true } }));
const [admin, holder, stranger] = await Promise.all([0, 1, 2].map((index) => provider.getSigner(index)));
const deploy = async (file, name, signer, args = []) => {
  const artifact = output.contracts[file][name];
  const contract = await new ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`, signer).deploy(...args);
  return contract.waitForDeployment();
};
const expectRevert = async (promise, label) => {
  let reverted = false;
  try { await promise; } catch { reverted = true; }
  assert.equal(reverted, true, label);
};

const rare = await deploy('MockRewardAsset.sol', 'MockRewardAsset', admin, ['RARE', 'RARE', 18]);
const nft = await deploy('MockUltraRares.sol', 'MockUltraRares', admin);
const registry = await deploy('RareRenameRegistry.sol', 'RareRenameRegistry', admin, [await nft.getAddress(), await rare.getAddress(), await admin.getAddress()]);
const cost = parseUnits('30000', 18);
const dead = '0x000000000000000000000000000000000000dEaD';

await (await nft.mint(await holder.getAddress(), 420)).wait();
await (await rare.mint(await admin.getAddress(), cost * 3n)).wait();
await (await rare.approve(await registry.getAddress(), cost * 3n)).wait();
assert.equal(await registry.RENAME_VERSION(), 2n, 'admin-only rename registry is explicitly versioned');
await expectRevert(registry.connect(stranger).requestRename(420, 'Not Yours'), 'A non-admin must not rename the NFT');
await expectRevert(registry.connect(holder).requestRename(420, 'Holder Blocked'), 'Even the NFT holder is blocked during admin-only mode');
await expectRevert(registry.requestRename(420, ''), 'An empty name must be rejected');
await (await registry.requestRename(420, 'The Last Rare')).wait();
assert.equal(await rare.balanceOf(dead), cost, 'Exactly 30,000 RARE must be burned');
assert.equal((await registry.requests(420)).pending, true, 'The rename must remain pending for manual metadata work');
await expectRevert(registry.connect(holder).requestRename(420, 'Again'), 'A second request must not replace a pending request');
await expectRevert(registry.connect(stranger).completeRename(420), 'Only the admin may complete a rename');
await (await registry.completeRename(420)).wait();
assert.equal((await registry.requests(420)).pending, false, 'Admin completion must close the request');

await (await nft.mint(await holder.getAddress(), 78)).wait();
await (await registry.requestRename(78, 'Admin Pending')).wait();
await expectRevert(registry.connect(stranger).clearStaleRequest(78), 'Only admin can cancel a pending request');
await (await registry.clearStaleRequest(78)).wait();
assert.equal((await registry.requests(78)).pending, false, 'Admin can cancel a pending rename safely');

console.log('Rename registry safety tests passed: 11 assertions');
