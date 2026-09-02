const CONTRACT = '0x28d1b29291daeb847a3c540c2b241e153d1d7385';
const PROJECT_WALLET = '0x562f6ac10723ef6af9f077a83cf25135fb369612';
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const RPC = 'https://rpc.mainnet.chain.robinhood.com/';
const OPENSEA = `https://opensea.io/item/robinhood/${CONTRACT}`;
const DEPLOY_BLOCK = '0x2eafc0c';
const TRANSFER_SINGLE = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
const TRANSFER_BATCH = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';
const ZERO_TOPIC = `0x${'0'.repeat(64)}`;

const publicImageUrl = (value = '') => value.startsWith('ipfs://')
  ? `https://dweb.link/ipfs/${value.slice(7)}`
  : value;

const indexedImageFor = async (tokenId) => {
  try {
    const result = await fetch(`${EXPLORER}/api/v2/tokens/${CONTRACT}/instances/${tokenId}`, { signal: AbortSignal.timeout(8000) });
    if (!result.ok) return '';
    const instance = await result.json();
    return publicImageUrl(instance.image_url || instance.media_url || instance.metadata?.image || instance.metadata?.image_url || '');
  } catch { return ''; }
};

const rpc = async (method, params, id = 1) => {
  const result = await fetch(RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(12000),
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  if (!result.ok) throw new Error(`RPC returned ${result.status}`);
  const payload = await result.json();
  if (payload.error) throw new Error(payload.error.message || 'RPC error');
  return payload.result;
};

const transactionsFor = async (hashes, idOffset = 10) => {
  if (!hashes.length) return [];
  const result = await fetch(RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(12000),
    body: JSON.stringify(hashes.map((hash, index) => ({ jsonrpc: '2.0', id: idOffset + index, method: 'eth_getTransactionByHash', params: [hash] }))),
  });
  if (!result.ok) throw new Error(`RPC returned ${result.status}`);
  const payload = await result.json();
  if (!Array.isArray(payload)) throw new Error('RPC batch failed');
  return payload.sort((a, b) => a.id - b.id).map((entry) => entry.result);
};

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
  try {
    const allTransfers = await rpc('eth_getLogs', [{ address: CONTRACT, fromBlock: DEPLOY_BLOCK, toBlock: 'latest', topics: [[TRANSFER_SINGLE, TRANSFER_BATCH]] }]);
    const mints = allTransfers.filter((transfer) => transfer.topics?.[2]?.toLowerCase() === ZERO_TOPIC);
    const transactionHashes = [...new Set(mints.map((mint) => mint.transactionHash).filter(Boolean))];
    const transactions = await transactionsFor(transactionHashes, 10);
    const grossWei = transactions.reduce((sum, transaction) => sum + BigInt(transaction?.value || '0x0'), 0n);
    const grossEth = Number(grossWei) / 1e18;
    const mintData = mints.flatMap((mint) => {
      const words = (mint.data || '0x').slice(2).match(/.{64}/g) || [];
      if (mint.topics?.[0]?.toLowerCase() === TRANSFER_SINGLE) {
        return [{ tokenId: Number(BigInt(`0x${words[0] || '0'}`)), units: Number(BigInt(`0x${words[1] || '0'}`)) }];
      }
      const idsAt = Number(BigInt(`0x${words[0] || '0'}`) / 32n);
      const valuesAt = Number(BigInt(`0x${words[1] || '0'}`) / 32n);
      const length = Number(BigInt(`0x${words[idsAt] || '0'}`));
      return Array.from({ length }, (_, index) => ({
        tokenId: Number(BigInt(`0x${words[idsAt + 1 + index] || '0'}`)),
        units: Number(BigInt(`0x${words[valuesAt + 1 + index] || '0'}`)),
      }));
    });
    const mintedUnits = mintData.reduce((sum, mint) => sum + mint.units, 0);
    const tokenIds = [...new Set(mintData.map((mint) => mint.tokenId).filter(Number.isFinite))].sort((a, b) => a - b);
    const featuredTokenId = Math.max(3, tokenIds.length ? tokenIds[tokenIds.length - 1] : 3);
    const featuredImages = {
      1: 'https://i2c.seadn.io/robinhood/0x28d1b29291daeb847a3c540c2b241e153d1d7385/df79c676e70fcb0487e8d96b08438d/ebdf79c676e70fcb0487e8d96b08438d.png?w=1000',
      2: 'https://i2c.seadn.io/robinhood/0x28d1b29291daeb847a3c540c2b241e153d1d7385/16e0eed965304728564b640d8b791b/7c16e0eed965304728564b640d8b791b.png?w=1000',
      3: 'https://i2c.seadn.io/robinhood/0x28d1b29291daeb847a3c540c2b241e153d1d7385/427b42691d2a215d2f5d04d8318ad8/94427b42691d2a215d2f5d04d8318ad8.png?w=1000',
    };
    const knownListingPricesEth = { 2: 0.0019, 3: 0.0019 };
    const featuredImageUrl = featuredImages[featuredTokenId] || await indexedImageFor(featuredTokenId);
    const featuredListingPriceEth = knownListingPricesEth[featuredTokenId] || null;
    const transferLogs = allTransfers.filter((transfer) => transfer.topics?.[2]?.toLowerCase() !== ZERO_TOPIC);
    const saleHashes = [...new Set(transferLogs.map((transfer) => transfer.transactionHash).filter(Boolean))];
    const saleTransactions = await transactionsFor(saleHashes, 1000);
    const transactionByHash = new Map(saleTransactions.map((transaction) => [transaction?.hash?.toLowerCase(), transaction]));
    const sales = transferLogs.flatMap((transfer) => {
      const transaction = transactionByHash.get(transfer.transactionHash?.toLowerCase());
      const valueWei = BigInt(transaction?.value || '0x0');
      if (valueWei <= 0n) return [];
      const words = (transfer.data || '0x').slice(2).match(/.{64}/g) || [];
      let transferred = [];
      if (transfer.topics?.[0]?.toLowerCase() === TRANSFER_SINGLE) {
        transferred = [{ tokenId: Number(BigInt(`0x${words[0] || '0'}`)), units: Number(BigInt(`0x${words[1] || '0'}`)) }];
      } else {
        const idsAt = Number(BigInt(`0x${words[0] || '0'}`) / 32n);
        const valuesAt = Number(BigInt(`0x${words[1] || '0'}`) / 32n);
        const length = Number(BigInt(`0x${words[idsAt] || '0'}`));
        transferred = Array.from({ length }, (_, index) => ({
          tokenId: Number(BigInt(`0x${words[idsAt + 1 + index] || '0'}`)),
          units: Number(BigInt(`0x${words[valuesAt + 1 + index] || '0'}`)),
        }));
      }
      const addressFromTopic = (topic = '') => `0x${topic.slice(-40)}`;
      return transferred.map(({ tokenId, units }) => ({
        tokenId, units, transactionHash: transfer.transactionHash, blockNumber: Number(BigInt(transfer.blockNumber || '0x0')),
        seller: addressFromTopic(transfer.topics?.[2]), buyer: addressFromTopic(transfer.topics?.[3]),
        priceEth: Number(valueWei) / 1e18,
        itemUrl: `${OPENSEA}/${tokenId}`,
        transactionUrl: `${EXPLORER}/tx/${transfer.transactionHash}`,
      }));
    }).sort((a, b) => b.blockNumber - a.blockNumber);
    const saleTransactionValues = new Map();
    sales.forEach((sale) => saleTransactionValues.set(sale.transactionHash, sale.priceEth));
    const salesVolumeEth = [...saleTransactionValues.values()].reduce((sum, value) => sum + value, 0);
    const projectSaleTransactionValues = new Map();
    sales.filter((sale) => sale.seller.toLowerCase() === PROJECT_WALLET).forEach((sale) => projectSaleTransactionValues.set(sale.transactionHash, sale.priceEth));
    const projectSalesRevenueEth = [...projectSaleTransactionValues.values()].reduce((sum, value) => sum + value, 0);
    const grossRevenueEth = grossEth + projectSalesRevenueEth;
    const featuredSoldCount = sales.filter((sale) => sale.tokenId === featuredTokenId).reduce((sum, sale) => sum + sale.units, 0);

    response.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=45');
    return response.status(200).json({
      displayName: 'Super Rare', onchainName: 'Ultra Rares', symbol: 'UR', standard: 'ERC-1155', contract: CONTRACT,
      mintedUnits, artworkCount: Math.max(tokenIds.length, 3), mintTransactions: transactionHashes.length,
      grossMintRevenueEth: grossEth, projectSalesRevenueEth, grossRevenueEth,
      vaultBuybackEth: grossRevenueEth * 0.9, remainderEth: grossRevenueEth * 0.1,
      soldCount: sales.reduce((sum, sale) => sum + sale.units, 0), featuredSoldCount, salesVolumeEth, latestSales: sales.slice(0, 10),
      featuredTokenId, featuredUrl: `${OPENSEA}/${featuredTokenId}`, featuredImageUrl, featuredListingPriceEth,
      explorerUrl: `${EXPLORER}/token/${CONTRACT}`,
      methodology: 'Gross project revenue combines confirmed paid mints and native-ETH sales transferred from the project wallet. Collection sales volume includes all non-mint ERC-1155 transfers whose transaction carried native ETH. Ordinary zero-value wallet transfers are excluded. The 90/10 values are allocation targets, not proof that funds were routed.',
      updatedAt: new Date().toISOString(),
    });
  } catch {
    return response.status(502).json({ error: 'Super Rare mint data is temporarily unavailable' });
  }
};
