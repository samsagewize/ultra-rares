import fs from 'node:fs';
const source = fs.readFileSync(new URL('RareLaunchFeeVault.sol', import.meta.url), 'utf8');
const input = { language:'Solidity', sources:{'RareLaunchFeeVault.sol':{content:source}}, settings:{evmVersion:'shanghai',optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object','metadata']}}} };
fs.writeFileSync(new URL('RareLaunchFeeVault.standard-input.json', import.meta.url), JSON.stringify(input,null,2));
console.log('Wrote RareLaunchFeeVault.standard-input.json');
