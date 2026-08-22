import fs from 'node:fs';

for (const file of ['RareFeeVault.sol', 'RareAuctionHouse.sol']) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const input = {
    language: 'Solidity',
    sources: { [file]: { content: source } },
    settings: {
      evmVersion: 'shanghai',
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'metadata'] } },
    },
  };
  const output = file.replace('.sol', '.standard-input.json');
  fs.writeFileSync(new URL(output, import.meta.url), JSON.stringify(input, null, 2));
  console.log(`Wrote ${output}`);
}
