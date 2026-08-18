const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
const AUCTION = '0x3d160ff78b4e4366b46cc7aa5be073f8d6d626a8';
const DEPLOY_BLOCK = '0x2588127';
const AUCTIONS_SELECTOR = '0x571a26a0';
const EVENTS = {
  '0xc9050d42180a61cb0d9ebb8ad118b62fe6eab12cf12ff752c4a0cc7da9ddf627': 'created',
  '0x0e54eff26401bf69b81b26f60bd85ef47f5d85275c1d268d84f68d6897431c47': 'bid',
  '0x10ac9f0bb365b5d22d7bec500408692f23fdf83eadfec71615ef88b4c1134f0e': 'cancelled',
  '0x3e25c3675d003af5184b628dd8bd4775b9b3abc7351c3574c90870ca25b55f11': 'settled',
  '0x0ae9b8f6b15032bb3f85c4325962e5ed0b0415320a9ea8090f8679f2f0d2e163': 'expired',
};

async function rpc(method, params) {
  const result = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(12000),
  }).then((response) => response.json());
  if (result.error) throw new Error(result.error.message);
  return result.result;
}

const word = (value) => BigInt(value).toString(16).padStart(64, '0');
const addressFromWord = (value) => `0x${value.slice(-40)}`.toLowerCase();
const words = (value) => value.slice(2).match(/.{64}/g) || [];

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
  try {
    const logs = await rpc('eth_getLogs', [{ address: AUCTION, fromBlock: DEPLOY_BLOCK, toBlock: 'latest' }]);
    const tokenIds = [...new Set(logs.filter((log) => EVENTS[log.topics[0]] === 'created').map((log) => Number(BigInt(log.topics[1]))))];
    const auctionResults = await Promise.all(tokenIds.map((tokenId) => rpc('eth_call', [{ to: AUCTION, data: `${AUCTIONS_SELECTOR}${word(tokenId)}` }, 'latest'])));
    const activeAuctions = tokenIds.flatMap((tokenId, index) => {
      const fields = words(auctionResults[index]);
      if (fields.length < 5 || BigInt(`0x${fields[0]}`) === 0n) return [];
      return [{
        tokenId,
        seller: addressFromWord(fields[0]),
        endTime: Number(BigInt(`0x${fields[1]}`)),
        reserve: BigInt(`0x${fields[2]}`).toString(),
        highestBidder: addressFromWord(fields[3]),
        highestBid: BigInt(`0x${fields[4]}`).toString(),
      }];
    });

    const relevantLogs = logs.filter((log) => EVENTS[log.topics[0]]);
    const blockNumbers = [...new Set(relevantLogs.map((log) => log.blockNumber))];
    const blocks = await Promise.all(blockNumbers.map((blockNumber) => rpc('eth_getBlockByNumber', [blockNumber, false])));
    const timestamps = new Map(blockNumbers.map((blockNumber, index) => [blockNumber, Number(BigInt(blocks[index].timestamp))]));
    const activity = relevantLogs.map((log) => {
      const type = EVENTS[log.topics[0]];
      const dataWords = words(log.data);
      return {
        type,
        tokenId: Number(BigInt(log.topics[1])),
        account: log.topics[2] ? addressFromWord(log.topics[2].slice(2)) : '',
        amount: type === 'bid' ? BigInt(`0x${dataWords[0]}`).toString() : (type === 'settled' ? BigInt(`0x${dataWords[0]}`).toString() : null),
        timestamp: timestamps.get(log.blockNumber),
        transactionHash: log.transactionHash,
        order: Number(BigInt(log.blockNumber)) * 100000 + Number(BigInt(log.logIndex)),
      };
    }).sort((a, b) => b.order - a.order).slice(0, 100).map(({ order, ...item }) => item);

    response.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20');
    return response.status(200).json({ activeAuctions, activity, updatedAt: new Date().toISOString() });
  } catch {
    return response.status(502).json({ error: 'Live auction data is temporarily unavailable' });
  }
};
