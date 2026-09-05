import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import solc from 'solc';
import { BrowserProvider, ContractFactory, parseEther } from 'ethers';

const source = fs.readFileSync(new URL('SuperRareBurnMint.sol', import.meta.url), 'utf8');
const mockSource = fs.readFileSync(new URL('MockRewardAsset.sol', import.meta.url), 'utf8');
const input = { language: 'Solidity', sources: { 'SuperRareBurnMint.sol': { content: source }, 'MockRewardAsset.sol': { content: mockSource } }, settings: { evmVersion: 'shanghai', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } };
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter((entry) => entry.severity === 'error');
if (errors.length) throw new Error(errors.map((entry) => entry.formattedMessage).join('\n'));

const provider = new BrowserProvider(ganache.provider({ logging: { quiet: true } }));
const admin = await provider.getSigner(0);
const collector = await provider.getSigner(1);
const stranger = await provider.getSigner(2);
const parentCollection = '0x28D1b29291dAeB847a3c540C2B241e153D1D7385';
const tokenArtifact = output.contracts['MockRewardAsset.sol'].MockRewardAsset;
const nftArtifact = output.contracts['SuperRareBurnMint.sol'].SuperRareBurnMint;
const rare = await new ContractFactory(tokenArtifact.abi, tokenArtifact.evm.bytecode.object, admin).deploy('Rare Token', 'RARE', 18);
await rare.waitForDeployment();
const collection = await new ContractFactory(nftArtifact.abi, nftArtifact.evm.bytecode.object, admin).deploy(parentCollection, await rare.getAddress(), await admin.getAddress(), 125);
await collection.waitForDeployment();

const cost = parseEther('50000');
await (await collection.publishDrop(1, cost, 'ipfs://super-rare/1.json')).wait();
await (await rare.mint(await collector.getAddress(), cost * 2n)).wait();
await (await rare.connect(collector).approve(await collection.getAddress(), cost)).wait();
await (await collection.connect(collector).mint(1)).wait();
assert.equal(await collection.parentCollection(), parentCollection);
assert.equal(await collection.ownerOf(1), await collector.getAddress());
assert.equal(await collection.tokenURI(1), 'ipfs://super-rare/1.json');
assert.equal(await collection.totalSupply(), 1n);
assert.equal(await collection.totalRareBurned(), cost);
assert.equal(await rare.balanceOf('0x000000000000000000000000000000000000dEaD'), cost);
await assert.rejects(collection.connect(stranger).publishDrop(2, cost, 'ipfs://bad'));
await assert.rejects(collection.connect(collector).mint(1));

await (await collection.publishDrop(2, cost, 'ipfs://super-rare/2.json')).wait();
await (await collection.setPaused(true)).wait();
await assert.rejects(collection.connect(collector).mint(2));
await (await collection.setPaused(false)).wait();
await (await collection.connect(collector).transferFrom(await collector.getAddress(), await stranger.getAddress(), 1)).wait();
assert.equal(await collection.ownerOf(1), await stranger.getAddress());

await (await collection.beginAdminTransfer(await stranger.getAddress())).wait();
await assert.rejects(collection.connect(collector).acceptAdmin());
await (await collection.connect(stranger).acceptAdmin()).wait();
assert.equal(await collection.admin(), await stranger.getAddress());
console.log('SuperRareBurnMint tests passed');
