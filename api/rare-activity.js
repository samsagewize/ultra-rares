const RARE_TOKEN = '0x1d522a4c3e1f3d97b585903474b2544cf9feeffb';
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const LEMON_VAULT = `https://lemon.fun/api/public/launchpad/vault/${RARE_TOKEN}`;
const RARE_POOL = '0x8ec9c76ed191fb03397637acee1ce928426beb80';
const RARE_AUCTION_HOUSE = '0x3d160ff78b4e4366b46cc7aa5be073f8d6d626a8';
const RARE_BURN_ADDRESS = '0x000000000000000000000000000000000000dead';
const LIQUIDITY_ENTRY_METHODS = new Set(['0xac9650d8', '0x88316456', '0x219f5d17']);
const LIVE_HEADERS = { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; RaresRares/1.0; +https://www.raresrares.fun/)' };

const shortAddress = (value = '') => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : 'Unknown';

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
  try {
    const [transferResult, lemonResult] = await Promise.all([
      fetch(`${EXPLORER}/api/v2/tokens/${RARE_TOKEN}/transfers`, {
        headers: LIVE_HEADERS,
        signal: AbortSignal.timeout(12000),
      }),
      fetch(LEMON_VAULT, {
        headers: LIVE_HEADERS,
        signal: AbortSignal.timeout(12000),
      }).catch(() => null),
    ]);
    if (!transferResult.ok) throw new Error(`Chain activity source returned ${transferResult.status}`);
    const payload = await transferResult.json();
    const lemon = lemonResult?.ok ? await lemonResult.json() : {};
    const items = payload.items || [];
    const liquidityHashes = new Set(items
      .filter((item) => item.to?.hash?.toLowerCase() === RARE_POOL && LIQUIDITY_ENTRY_METHODS.has(item.method?.toLowerCase()))
      .map((item) => item.transaction_hash));
    const buyHashes = new Set(items
      .filter((item) => item.from?.hash?.toLowerCase() === RARE_POOL)
      .map((item) => item.transaction_hash));
    const sellHashes = new Set(items
      .filter((item) => item.to?.hash?.toLowerCase() === RARE_POOL)
      .map((item) => item.transaction_hash));
    const auctionHashes = new Set(items
      .filter((item) => [item.from?.hash, item.to?.hash].some((address) => address?.toLowerCase() === RARE_AUCTION_HOUSE))
      .map((item) => item.transaction_hash));
    const transfers = items.slice(0, 30).map((item) => ({
      hash: item.transaction_hash,
      logIndex: item.log_index,
      from: item.from?.hash || '',
      fromLabel: item.from?.name || shortAddress(item.from?.hash),
      to: item.to?.hash || '',
      toLabel: item.to?.name || shortAddress(item.to?.hash),
      value: item.total?.value || '0',
      decimals: Number(item.total?.decimals || item.token?.decimals || 18),
      timestamp: item.timestamp,
      side: item.to?.hash?.toLowerCase() === RARE_BURN_ADDRESS ? 'burn' : auctionHashes.has(item.transaction_hash) ? 'auction' : liquidityHashes.has(item.transaction_hash) ? 'liquidity' : buyHashes.has(item.transaction_hash) ? 'buy' : sellHashes.has(item.transaction_hash) ? 'sell' : 'transfer',
      url: `${EXPLORER}/tx/${item.transaction_hash}`,
    }));
    response.setHeader('Cache-Control', 's-maxage=1, stale-while-revalidate=2');
    return response.status(200).json({
      transfers,
      latestBuyHash: items.find((item) => buyHashes.has(item.transaction_hash))?.transaction_hash || null,
      gme: {
        symbol: lemon.stockSymbol || 'GME',
        paidToHolders: lemon.stats?.totalPublished || lemon.stats?.totalDistributed || '0',
        nextRound: lemon.stats?.pendingStock || '0',
        roundsPaid: Number(lemon.stats?.epochCount || lemon.epochs?.length || 0),
        holderCount: Math.max(0, ...(lemon.epochs || []).map((epoch) => Number(epoch.holder_count || 0))),
        creatorEarned: lemon.creatorEarned || '0',
        minBalance: lemon.stats?.minShareBalance || lemon.minShareBalance || '0',
        feeSplit: {
          holders: Number(lemon.splits?.holdersBps || 0) / 100,
          creator: Number(lemon.splits?.creatorBps || 0) / 100,
          platform: Number(lemon.splits?.platformBps || 0) / 100,
        },
        vault: lemon.vault || '',
        source: `https://lemon.fun/terminal/${RARE_TOKEN}`,
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('RARE activity feed failed', error);
    return response.status(502).json({ error: 'Live $RARE activity is temporarily unavailable' });
  }
};
