const RPC='https://rpc.mainnet.chain.robinhood.com/';
const TOKEN='0x5e0b95ece467f882c8394afd991b62f691189e8a';
const EXPLORER='https://robinhoodchain.blockscout.com';
const TOPIC='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const rpc=async(method,params,id=1)=>{const result=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:AbortSignal.timeout(12000)});if(!result.ok)throw new Error(`RPC ${result.status}`);const payload=await result.json();if(payload.error)throw new Error(payload.error.message||'RPC error');return payload.result;};
module.exports=async function handler(request,response){if(request.method!=='GET')return response.status(405).json({error:'Method not allowed'});try{
  const latestHex=await rpc('eth_blockNumber',[]);const latest=Number(BigInt(latestHex));const fromBlock=`0x${Math.max(0,latest-50000).toString(16)}`;
  const logs=await rpc('eth_getLogs',[{address:TOKEN,fromBlock,toBlock:'latest',topics:[TOPIC]}]);const recent=logs.slice(-30).reverse();const blocks=[...new Set(recent.map(log=>log.blockNumber))];let timestamps=new Map();
  if(blocks.length){const batch=blocks.map((block,index)=>({jsonrpc:'2.0',id:index+10,method:'eth_getBlockByNumber',params:[block,false]}));const result=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(batch),signal:AbortSignal.timeout(12000)});if(!result.ok)throw new Error(`Block RPC ${result.status}`);const payload=await result.json();timestamps=new Map(payload.filter(entry=>entry.result).map(entry=>[blocks[entry.id-10],Number(BigInt(entry.result.timestamp))*1000]));}
  const address=(topic='')=>`0x${topic.slice(-40)}`;const transfers=recent.map(log=>({hash:log.transactionHash,logIndex:Number(BigInt(log.logIndex)),from:address(log.topics[1]),to:address(log.topics[2]),value:BigInt(log.data).toString(),decimals:18,timestamp:new Date(timestamps.get(log.blockNumber)||Date.now()).toISOString(),url:`${EXPLORER}/tx/${log.transactionHash}`}));
  response.setHeader('Cache-Control','s-maxage=2, stale-while-revalidate=4');return response.status(200).json({transfers,updatedAt:new Date().toISOString()});
}catch(error){console.error('New RARE feed failed',error);return response.status(502).json({error:'Live RARE activity is temporarily unavailable'});}};
