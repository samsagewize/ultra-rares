const RARE_TOKEN = '0x1d522a4c3e1f3d97b585903474b2544cf9feeffb';
const DEXSCREENER_URL = `https://api.dexscreener.com/token-pairs/v1/robinhood/${RARE_TOKEN}`;
const geckoTerminalVolumeUrl = (pairAddress) => `https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${pairAddress}/ohlcv/day?aggregate=1&limit=1000`;

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });

  try {
    const dexResponse = await fetch(DEXSCREENER_URL, {
      headers: { accept: 'application/json', 'user-agent': 'UltraRaresMarket/1.0 (+https://ultra-rares.vercel.app)' },
    });
    if (!dexResponse.ok) throw new Error(`DexScreener returned ${dexResponse.status}`);

    const pairs = await dexResponse.json();
    const rarePairs = pairs.filter((candidate) => candidate.baseToken?.address?.toLowerCase() === RARE_TOKEN);
    const pair = rarePairs
      .sort((left, right) => (numberOrNull(right.liquidity?.usd) || 0) - (numberOrNull(left.liquidity?.usd) || 0))[0];
    if (!pair) throw new Error('RARE market was not found');

    const marketCap = numberOrNull(pair.marketCap ?? pair.fdv);
    if (marketCap === null) throw new Error('RARE market cap was not found');
    const poolVolumeTotals = await Promise.all(rarePairs.map(async (rarePair) => {
      try {
        const volumeResponse = await fetch(geckoTerminalVolumeUrl(rarePair.pairAddress), {
          headers: { accept: 'application/json', 'user-agent': 'UltraRaresMarket/1.0 (+https://ultra-rares.vercel.app)' },
        });
        if (!volumeResponse.ok) return 0;
        const volumePayload = await volumeResponse.json();
        const dailyCandles = volumePayload.data?.attributes?.ohlcv_list || [];
        return dailyCandles.reduce((sum, candle) => sum + (numberOrNull(candle?.[5]) || 0), 0);
      } catch {
        return 0;
      }
    }));
    const totalVolumeUsd = poolVolumeTotals.reduce((sum, volume) => sum + volume, 0);
    const volume24hUsd = rarePairs.reduce((sum, rarePair) => sum + (numberOrNull(rarePair.volume?.h24) || 0), 0);
    const buys24h = rarePairs.reduce((sum, rarePair) => sum + Number(rarePair.txns?.h24?.buys || 0), 0);
    const sells24h = rarePairs.reduce((sum, rarePair) => sum + Number(rarePair.txns?.h24?.sells || 0), 0);

    response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return response.status(200).json({
      marketCap,
      priceUsd: numberOrNull(pair.priceUsd),
      liquidityUsd: numberOrNull(pair.liquidity?.usd),
      volume24hUsd,
      totalVolumeUsd,
      buys24h,
      sells24h,
      poolCount: rarePairs.length,
      pairAddress: pair.pairAddress,
      pairUrl: pair.url,
      source: 'DexScreener + GeckoTerminal',
      updatedAt: new Date().toISOString(),
    });
  } catch {
    return response.status(502).json({ error: 'Live RARE market data is temporarily unavailable' });
  }
};
