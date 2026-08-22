import fs from 'node:fs';
const names=['RareLaunchFactory.sol']; const sources=Object.fromEntries(names.map((name)=>[name,{content:fs.readFileSync(new URL(name,import.meta.url),'utf8')}])) ;
const input={language:'Solidity',sources,settings:{evmVersion:'shanghai',optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object','metadata']}}}};
fs.writeFileSync(new URL('RareLaunchFactory.standard-input.json',import.meta.url),JSON.stringify(input,null,2)); console.log('Wrote RareLaunchFactory.standard-input.json');
