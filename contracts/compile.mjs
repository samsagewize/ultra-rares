import fs from 'node:fs';
import solc from 'solc';

const files = ['UtilityRegistry.sol', 'UltraRaresToken.sol', 'RewardVault.sol', 'RareNftClaimVault.sol', 'MockUltraRares.sol', 'MockRewardAsset.sol'];
const sources = Object.fromEntries(files.map((file) => [file, { content: fs.readFileSync(new URL(file, import.meta.url), 'utf8') }]));
const input = {
  language: 'Solidity',
  sources,
  settings: {
    evmVersion: 'shanghai',
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } }
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
