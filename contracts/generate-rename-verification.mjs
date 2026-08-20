import fs from 'node:fs';
import solc from 'solc';

const source = fs.readFileSync(new URL('RareRenameRegistry.sol', import.meta.url), 'utf8');
const input = {
  language: 'Solidity',
  sources: { 'RareRenameRegistry.sol': { content: source } },
  settings: {
    evmVersion: 'shanghai',
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.methodIdentifiers'] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter(({ severity }) => severity === 'error');
if (errors.length) throw new Error(errors.map(({ formattedMessage }) => formattedMessage).join('\n'));

const generatedBytecode = `0x${output.contracts['RareRenameRegistry.sol'].RareRenameRegistry.evm.bytecode.object}`;
const artifact = JSON.parse(fs.readFileSync(new URL('../assets/RareRenameRegistry.json', import.meta.url), 'utf8'));
if (generatedBytecode !== artifact.bytecode) throw new Error('Verification input does not reproduce the deployed creation bytecode.');

fs.writeFileSync(new URL('RareRenameRegistry.standard-input.json', import.meta.url), `${JSON.stringify(input, null, 2)}\n`);
console.log(`Created verified Standard JSON input with compiler ${solc.version()}.`);
