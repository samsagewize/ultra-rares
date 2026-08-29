const CONTRACT = '0x28d1b29291daeb847a3c540c2b241e153d1d7385';
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const RPC = 'https://rpc.mainnet.chain.robinhood.com/';
const OPENSEA = `https://opensea.io/item/robinhood/${CONTRACT}`;
const FEATURE_START = Date.UTC(2026, 7, 29);
const DEPLOY_BLOCK = '0x2eafc0c';
const TRANSFER_SINGLE = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
const TRANSFER_BATCH = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';
const ZERO_TOPIC = `0x${'0'.repeat(64)}`;

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

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
  try {
    const mints = await rpc('eth_getLogs', [{ address: CONTRACT, fromBlock: DEPLOY_BLOCK, toBlock: 'latest', topics: [[TRANSFER_SINGLE, TRANSFER_BATCH], null, ZERO_TOPIC] }]);
    const transactionHashes = [...new Set(mints.map((mint) => mint.transactionHash).filter(Boolean))];
    const transactions = await Promise.all(transactionHashes.map((hash, index) => rpc('eth_getTransactionByHash', [hash], index + 2)));
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
    const days = Math.max(0, Math.floor((Date.now() - FEATURE_START) / 86400000));
    const featuredTokenId = tokenIds.length ? tokenIds[days % tokenIds.length] : 1;
    const featuredImageUrl = featuredTokenId === 1
      ? 'https://i2c.seadn.io/robinhood/0x28d1b29291daeb847a3c540c2b241e153d1d7385/df79c676e70fcb0487e8d96b08438d/ebdf79c676e70fcb0487e8d96b08438d.png?w=1000'
      : '';

    response.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=45');
    return response.status(200).json({
      displayName: 'Super Rare', onchainName: 'Ultra Rares', symbol: 'UR', standard: 'ERC-1155', contract: CONTRACT,
      mintedUnits, artworkCount: tokenIds.length, mintTransactions: transactionHashes.length,
      grossMintRevenueEth: grossEth, vaultBuybackEth: grossEth * 0.9, remainderEth: grossEth * 0.1,
      featuredTokenId, featuredUrl: `${OPENSEA}/${featuredTokenId}`, featuredImageUrl, explorerUrl: `${EXPLORER}/token/${CONTRACT}`,
      methodology: 'Gross revenue is the native ETH value of confirmed transactions that emitted ERC-1155 single or batch mint events from the zero address for this contract. Secondary sales are excluded. The 90/10 values are allocation targets, not proof that funds were routed.',
      updatedAt: new Date().toISOString(),
    });
  } catch {
    return response.status(502).json({ error: 'Super Rare mint data is temporarily unavailable' });
  }
};
