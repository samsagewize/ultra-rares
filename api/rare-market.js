const RARE_TOKEN = '0x1d522a4c3e1f3d97b585903474b2544cf9feeffb';
const DEXSCREENER_URL = `https://api.dexscreener.com/token-pairs/v1/robinhood/${RARE_TOKEN}`;
const GECKOTERMINAL_VOLUME_URL = 'https://api.geckoterminal.com/api/v2/networks/robinhood/pools/0x8ec9c76ed191fb03397637acee1ce928426beb80/ohlcv/day?aggregate=1&limit=1000';

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });

  try {
    const [dexResponse, volumeResponse] = await Promise.all([
      fetch(DEXSCREENER_URL, {
        headers: { accept: 'application/json', 'user-agent': 'UltraRaresMarket/1.0 (+https://ultra-rares.vercel.app)' },
      }),
      fetch(GECKOTERMINAL_VOLUME_URL, {
        headers: { accept: 'application/json', 'user-agent': 'UltraRaresMarket/1.0 (+https://ultra-rares.vercel.app)' },
      }).catch(() => null),
    ]);
    if (!dexResponse.ok) throw new Error(`DexScreener returned ${dexResponse.status}`);

    const pairs = await dexResponse.json();
    const pair = pairs
      .filter((candidate) => candidate.baseToken?.address?.toLowerCase() === RARE_TOKEN)
      .sort((left, right) => (numberOrNull(right.liquidity?.usd) || 0) - (numberOrNull(left.liquidity?.usd) || 0))[0];
    if (!pair) throw new Error('RARE market was not found');

    const marketCap = numberOrNull(pair.marketCap ?? pair.fdv);
    if (marketCap === null) throw new Error('RARE market cap was not found');
    let totalVolumeUsd = null;
    if (volumeResponse?.ok) {
      const volumePayload = await volumeResponse.json();
      const dailyCandles = volumePayload.data?.attributes?.ohlcv_list || [];
      totalVolumeUsd = dailyCandles.reduce((sum, candle) => sum + (numberOrNull(candle?.[5]) || 0), 0);
    }

    response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return response.status(200).json({
      marketCap,
      priceUsd: numberOrNull(pair.priceUsd),
      liquidityUsd: numberOrNull(pair.liquidity?.usd),
      volume24hUsd: numberOrNull(pair.volume?.h24),
      totalVolumeUsd,
      buys24h: Number(pair.txns?.h24?.buys || 0),
      sells24h: Number(pair.txns?.h24?.sells || 0),
      pairAddress: pair.pairAddress,
      pairUrl: pair.url,
      source: 'DexScreener',
      updatedAt: new Date().toISOString(),
    });
  } catch {
    return response.status(502).json({ error: 'Live RARE market data is temporarily unavailable' });
  }
};
