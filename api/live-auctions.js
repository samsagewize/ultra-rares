const BLOCKSCOUT_LOGS = 'https://robinhoodchain.blockscout.com/api';
const AUCTION = '0x3d160ff78b4e4366b46cc7aa5be073f8d6d626a8';
const RENAME_REGISTRY = '0x8d14dec25cd17081270b7052685fa0418c376cee';
const COLLECTION = '0x923aaaa62c12505b1bbb57ed52b730d6462c01c5';
const DEPLOY_BLOCK = '0x2588127';
const RENAME_DEPLOY_BLOCK = '0x27342f8';
const AUCTIONS_SELECTOR = '0x571a26a0';
const EVENTS = {
  '0xc9050d42180a61cb0d9ebb8ad118b62fe6eab12cf12ff752c4a0cc7da9ddf627': 'created',
  '0x0e54eff26401bf69b81b26f60bd85ef47f5d85275c1d268d84f68d6897431c47': 'bid',
  '0x10ac9f0bb365b5d22d7bec500408692f23fdf83eadfec71615ef88b4c1134f0e': 'cancelled',
  '0x3e25c3675d003af5184b628dd8bd4775b9b3abc7351c3574c90870ca25b55f11': 'settled',
  '0x0ae9b8f6b15032bb3f85c4325962e5ed0b0415320a9ea8090f8679f2f0d2e163': 'expired',
};
const RENAME_EVENTS = {
  '0x4edeb5b84fa5ef6bae73ac5c87e578f4152cd0a22f4b84d65757da1e28c1953a': 'rename_requested',
  '0x1f36ca7383faef1e159e1114784d38dd9a4d3bb71794bdc93991d1f08185c9dc': 'rename_completed',
  '0x33c82d0e4d36d15c5f9737c7514c4723f31f58658634ca85d2e38d3b4824d25e': 'rename_stale',
};

async function fetchLogs(address, fromBlock) {
  const url = new URL(BLOCKSCOUT_LOGS);
  url.search = new URLSearchParams({ module: 'logs', action: 'getLogs', address, fromBlock: BigInt(fromBlock).toString(), toBlock: 'latest' });
  const payload = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; UltraRaresAuctions/1.0; +https://www.raresrares.fun)' },
    signal: AbortSignal.timeout(12000),
  }).then(async (result) => {
    if (!result.ok) throw new Error(`Blockscout log feed returned ${result.status}`);
    return result.json();
  });
  if (payload.status !== '1' && payload.message !== 'No logs found') throw new Error(payload.message || 'Log feed unavailable');
  return Array.isArray(payload.result) ? payload.result : [];
}

const word = (value) => BigInt(value).toString(16).padStart(64, '0');
const addressFromWord = (value) => `0x${value.slice(-40)}`.toLowerCase();
const words = (value) => value.slice(2).match(/.{64}/g) || [];
const stringFromData = (value) => {
  const data = value.slice(2);
  const offset = Number(BigInt(`0x${data.slice(0, 64)}`)) * 2;
  const length = Number(BigInt(`0x${data.slice(offset, offset + 64)}`));
  return Buffer.from(data.slice(offset + 64, offset + 64 + length * 2), 'hex').toString('utf8');
};

async function artworkForToken(tokenId) {
  try {
    const page = await fetch(`https://opensea.io/item/robinhood/${COLLECTION}/${tokenId}`, {
      headers: { 'user-agent': 'UltraRaresAuctions/1.0 (+https://ultra-rares.vercel.app)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!page.ok) return '';
    const html = await page.text();
    const images = [...html.matchAll(/"imageUrl":"([^"]+)"/g)].map((match) => match[1].replaceAll('\\u0026', '&'));
    return images.find((image) => image.includes(`/robinhood/${COLLECTION}/`)) || '';
  } catch {
    return '';
  }
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
  try {
    const [logs, renameLogs] = await Promise.all([
      fetchLogs(AUCTION, DEPLOY_BLOCK),
      fetchLogs(RENAME_REGISTRY, RENAME_DEPLOY_BLOCK).catch(() => []),
    ]);
    const auctionState = new Map();
    logs.forEach((log) => {
      const type = EVENTS[log.topics[0]];
      if (!type || !log.topics[1]) return;
      const tokenId = Number(BigInt(log.topics[1]));
      if (type === 'created') {
        const fields = words(log.data);
        auctionState.set(tokenId, {
          tokenId,
          seller: addressFromWord(log.topics[2].slice(2)),
          reserve: BigInt(`0x${fields[0]}`).toString(),
          endTime: Number(BigInt(`0x${fields[1]}`)),
          highestBidder: '0x0000000000000000000000000000000000000000',
          highestBid: '0',
        });
      } else if (type === 'bid' && auctionState.has(tokenId)) {
        const auction = auctionState.get(tokenId);
        auction.highestBidder = addressFromWord(log.topics[2].slice(2));
        auction.highestBid = BigInt(log.data).toString();
      } else if (['cancelled', 'settled', 'expired'].includes(type)) auctionState.delete(tokenId);
    });
    const activeAuctions = [...auctionState.values()];
    const artwork = await Promise.all(activeAuctions.map(({ tokenId }) => artworkForToken(tokenId)));
    activeAuctions.forEach((auction, index) => { auction.image = artwork[index]; });

    const relevantLogs = [...logs.filter((log) => EVENTS[log.topics[0]]), ...renameLogs.filter((log) => RENAME_EVENTS[log.topics[0]])];
    const activity = relevantLogs.map((log) => {
      const type = EVENTS[log.topics[0]] || RENAME_EVENTS[log.topics[0]];
      const dataWords = words(log.data);
      return {
        type,
        tokenId: Number(BigInt(log.topics[1])),
        account: type === 'settled' && log.topics[3] ? addressFromWord(log.topics[3].slice(2)) : (log.topics[2] ? addressFromWord(log.topics[2].slice(2)) : ''),
        amount: type === 'bid' ? BigInt(`0x${dataWords[0]}`).toString() : (type === 'settled' ? BigInt(`0x${dataWords[0]}`).toString() : null),
        requestedName: type === 'rename_requested' || type === 'rename_completed' ? stringFromData(log.data) : null,
        timestamp: Number(BigInt(log.timeStamp || 0)),
        transactionHash: log.transactionHash,
        order: Number(BigInt(log.blockNumber)) * 100000 + Number(BigInt(log.logIndex)),
      };
    }).sort((a, b) => b.order - a.order).slice(0, 100).map(({ order, ...item }) => item);

    const settledVolume = logs.filter((log) => EVENTS[log.topics[0]] === 'settled')
      .reduce((total, log) => total + BigInt(log.data), 0n);
    const protocolFees = settledVolume * 200n / 10_000n;
    response.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=10');
    return response.status(200).json({
      activeAuctions,
      activity,
      stats: { settledVolume: settledVolume.toString(), protocolFees: protocolFees.toString(), verifiedBurned: '0', burnActive: false },
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Live auction feed failed', error);
    return response.status(502).json({ error: 'Live auction data is temporarily unavailable' });
  }
};
