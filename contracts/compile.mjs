import fs from 'node:fs';
import solc from 'solc';

const files = ['UtilityRegistry.sol', 'UltraRaresToken.sol', 'RewardVault.sol', 'RareNftClaimVault.sol', 'RareMarketplace.sol', 'RareAuctionHouse.sol', 'RareFeeVault.sol', 'RareLaunchFeeVault.sol', 'RareLaunchFactory.sol', 'RareRenameRegistry.sol', 'SuperRareBurnMint.sol', 'UltraRareWorkAgent.sol', 'UltraRareDepositPilot.sol', 'MockUltraRares.sol', 'MockRewardAsset.sol', 'MockWorkInfrastructure.sol', 'MockLaunchInfrastructure.sol', 'MockLaunchAdversary.sol', 'MockUniswapV3.sol'];
const sources = Object.fromEntries(files.map((file) => [file, { content: fs.readFileSync(new URL(file, import.meta.url), 'utf8') }]));
const input = {
  language: 'Solidity',
  sources,
  settings: {
    evmVersion: 'shanghai',
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.methodIdentifiers'] } }
  }
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter((entry) => entry.severity === 'error');
for (const entry of output.errors || []) console.log(`${entry.severity}: ${entry.formattedMessage}`);
if (errors.length) process.exit(1);

for (const [file, contracts] of Object.entries(output.contracts)) {
  for (const [name, artifact] of Object.entries(contracts)) {
    console.log(`${file}:${name} — ABI ${artifact.abi.length} entries, bytecode ${artifact.evm.bytecode.object.length / 2} bytes`);
  }
}

const vault = output.contracts['RareNftClaimVault.sol'].RareNftClaimVault;
fs.mkdirSync(new URL('../assets/', import.meta.url), { recursive: true });
fs.writeFileSync(
  new URL('../assets/RareNftClaimVault.json', import.meta.url),
  JSON.stringify({
    contractName: 'RareNftClaimVault',
    abi: vault.abi,
    bytecode: `0x${vault.evm.bytecode.object}`,
    methodIdentifiers: vault.evm.methodIdentifiers,
  }, null, 2),
);

const marketplace = output.contracts['RareMarketplace.sol'].RareMarketplace;
fs.writeFileSync(
  new URL('../assets/RareMarketplace.json', import.meta.url),
  JSON.stringify({
    contractName: 'RareMarketplace',
    abi: marketplace.abi,
    bytecode: `0x${marketplace.evm.bytecode.object}`,
    methodIdentifiers: marketplace.evm.methodIdentifiers,
  }, null, 2),
);

const auctionHouse = output.contracts['RareAuctionHouse.sol'].RareAuctionHouse;
fs.writeFileSync(
  new URL('../assets/RareAuctionHouse.json', import.meta.url),
  JSON.stringify({
    contractName: 'RareAuctionHouse',
    abi: auctionHouse.abi,
    bytecode: `0x${auctionHouse.evm.bytecode.object}`,
    methodIdentifiers: auctionHouse.evm.methodIdentifiers,
  }, null, 2),
);

const feeVault = output.contracts['RareFeeVault.sol'].RareFeeVault;
fs.writeFileSync(
  new URL('../assets/RareFeeVault.json', import.meta.url),
  JSON.stringify({
    contractName: 'RareFeeVault',
    abi: feeVault.abi,
    bytecode: `0x${feeVault.evm.bytecode.object}`,
    methodIdentifiers: feeVault.evm.methodIdentifiers,
  }, null, 2),
);

const launchFeeVault = output.contracts['RareLaunchFeeVault.sol'].RareLaunchFeeVault;
fs.writeFileSync(
  new URL('../assets/RareLaunchFeeVault.json', import.meta.url),
  JSON.stringify({ contractName: 'RareLaunchFeeVault', abi: launchFeeVault.abi, bytecode: `0x${launchFeeVault.evm.bytecode.object}`, methodIdentifiers: launchFeeVault.evm.methodIdentifiers }, null, 2),
);

for (const contractName of ['RareLaunchFactory', 'RareLaunchToken', 'RareV3Migrator', 'RareV3LiquidityLocker']) {
  const artifact = output.contracts['RareLaunchFactory.sol'][contractName];
  fs.writeFileSync(new URL(`../assets/${contractName}.json`, import.meta.url), JSON.stringify({ contractName, abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, methodIdentifiers: artifact.evm.methodIdentifiers }, null, 2));
}

const renameRegistry = output.contracts['RareRenameRegistry.sol'].RareRenameRegistry;
fs.writeFileSync(
  new URL('../assets/RareRenameRegistry.json', import.meta.url),
  JSON.stringify({
    contractName: 'RareRenameRegistry',
    abi: renameRegistry.abi,
    bytecode: `0x${renameRegistry.evm.bytecode.object}`,
    methodIdentifiers: renameRegistry.evm.methodIdentifiers,
  }, null, 2),
);

const superRareBurnMint = output.contracts['SuperRareBurnMint.sol'].SuperRareBurnMint;
fs.writeFileSync(
  new URL('../assets/SuperRareBurnMint.json', import.meta.url),
  JSON.stringify({ contractName: 'SuperRareBurnMint', abi: superRareBurnMint.abi, bytecode: `0x${superRareBurnMint.evm.bytecode.object}`, methodIdentifiers: superRareBurnMint.evm.methodIdentifiers }, null, 2),
);

for (const contractName of ['UltraRareWorkAgentFactory', 'UltraRareWorkAgent', 'UltraRareProfitEscrow']) {
  const artifact = output.contracts['UltraRareWorkAgent.sol'][contractName];
  fs.writeFileSync(
    new URL(`../assets/${contractName}.json`, import.meta.url),
    JSON.stringify({
      contractName,
      abi: artifact.abi,
      bytecode: `0x${artifact.evm.bytecode.object}`,
      methodIdentifiers: artifact.evm.methodIdentifiers,
    }, null, 2),
  );
}

for (const contractName of ['UltraRareDepositPilotFactory', 'UltraRareDepositPilot']) {
  const artifact = output.contracts['UltraRareDepositPilot.sol'][contractName];
  fs.writeFileSync(
    new URL(`../assets/${contractName}.json`, import.meta.url),
    JSON.stringify({ contractName, abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, methodIdentifiers: artifact.evm.methodIdentifiers }, null, 2),
  );
}
