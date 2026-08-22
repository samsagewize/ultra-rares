import fs from 'node:fs';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import solc from 'solc';
import { BrowserProvider, Contract, ContractFactory, parseEther } from 'ethers';

const files = ['UltraRareDepositPilot.sol', 'MockUltraRares.sol'];
const sources = Object.fromEntries(files.map((file) => [file, { content: fs.readFileSync(new URL(file, import.meta.url), 'utf8') }]));
const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: { evmVersion: 'shanghai', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
const errors = (output.errors || []).filter(({ severity }) => severity === 'error');
assert.equal(errors.length, 0, errors.map(({ formattedMessage }) => formattedMessage).join('\n'));

const provider = new BrowserProvider(ganache.provider({ logging: { quiet: true } }));
const [admin, stranger, recipient] = await Promise.all([0, 1, 2].map((index) => provider.getSigner(index)));
const deploy = async (file, name, signer, args = []) => {
  const artifact = output.contracts[file][name];
  return new ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`, signer).deploy(...args).then((contract) => contract.waitForDeployment());
};
const expectRevert = async (promise, label) => {
  let reverted = false;
  try { const tx = await promise; if (tx?.wait) await tx.wait(); } catch { reverted = true; }
  assert.equal(reverted, true, label);
};

const nft = await deploy('MockUltraRares.sol', 'MockUltraRares', admin);
await (await nft.mint(await admin.getAddress(), 420)).wait();
const factory = await deploy('UltraRareDepositPilot.sol', 'UltraRareDepositPilotFactory', admin, [await nft.getAddress()]);
await expectRevert(factory.connect(stranger).activate(420), 'only NFT owner activates');
await (await factory.activate(420)).wait();
await expectRevert(factory.activate(420), 'cannot activate twice');
const pilotAddress = await factory.pilotOf(420);
const artifact = output.contracts['UltraRareDepositPilot.sol'].UltraRareDepositPilot;
const pilot = new Contract(pilotAddress, artifact.abi, admin);
await expectRevert(pilot.connect(stranger).deposit({ value: parseEther('0.001') }), 'only current NFT owner deposits');
await (await pilot.deposit({ value: parseEther('0.001') })).wait();
assert.equal(await provider.getBalance(pilotAddress), parseEther('0.001'), 'exact pilot deposit held');
await expectRevert(pilot.connect(stranger).withdrawAll(await stranger.getAddress()), 'stranger cannot withdraw');
await (await nft.transferFrom(await admin.getAddress(), await stranger.getAddress(), 420)).wait();
await expectRevert(pilot.withdrawAll(await admin.getAddress()), 'old owner loses control immediately');
await (await pilot.connect(stranger).withdrawAll(await recipient.getAddress(), { gasLimit: 200000 })).wait();
assert.equal(BigInt(await provider.send('eth_getBalance', [pilotAddress, 'latest'])), 0n, 'current NFT owner withdraws every wei');
await expectRevert(pilot.connect(stranger).withdrawAll(await recipient.getAddress()), 'empty pilot cannot withdraw');
console.log('Deposit pilot safety tests passed: 9 assertions');
