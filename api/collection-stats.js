const COLLECTION_SLUG = 'ultra-rares-robinhood';
const COLLECTION_PAGE = `https://opensea.io/collection/${COLLECTION_SLUG}/activity`;

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function fromApi(payload) {
  const total = payload?.total || payload?.stats?.total;
  if (!total) return null;
  return {
    volumeNative: asNumber(total.volume),
    volumeUsd: asNumber(total.volume_usd ?? total.volumeUsd),
    floorNative: asNumber(total.floor_price ?? total.floorPrice),
    floorUsd: asNumber(total.floor_price_usd ?? total.floorPriceUsd),
    owners: asNumber(total.num_owners ?? total.numOwners ?? total.owners),
    totalSupply: asNumber(total.total_supply ?? total.totalSupply) || 420,
  };
}

function matchNumber(text, pattern) {
  const match = text.match(pattern);
  return match ? asNumber(match[1]) : null;
}

function fromPublicPage(html) {
  const statsMarker = html.match(/"totalSupply":420,"oneDay":.*?"volume":\{"native":\{"unit":([\d.]+).*?"usd":([\d.]+).*?"listedItemCount":\d+,"ownerCount":(\d+)/);
  const floorMarker = html.match(/"floorPrice":\{"pricePerItem":\{"token":\{"unit":([\d.]+),"symbol":"ETH".*?"usd":([\d.]+)/);
  if (!statsMarker || !floorMarker) return null;
  return {
    volumeNative: asNumber(statsMarker[1]),
    volumeUsd: asNumber(statsMarker[2]),
    floorNative: asNumber(floorMarker[1]),
    floorUsd: asNumber(floorMarker[2]),
    owners: asNumber(statsMarker[3]),
    totalSupply: matchNumber(html, /"totalSupply":(\d+)/) || 420,
  };
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });

  try {
    let stats = null;
    let source = 'OpenSea public collection page';

    if (process.env.OPENSEA_API_KEY) {
      const apiResponse = await fetch(`https://api.opensea.io/api/v2/collections/${COLLECTION_SLUG}/stats`, {
        headers: { 'x-api-key': process.env.OPENSEA_API_KEY },
      });
      if (apiResponse.ok) {
        stats = fromApi(await apiResponse.json());
        source = 'OpenSea API';
      }
    }

    if (!stats || stats.volumeNative === null || stats.floorNative === null) {
      const pageResponse = await fetch(COLLECTION_PAGE, {
        headers: { 'user-agent': 'UltraRaresStats/1.0 (+https://ultra-rares.vercel.app)' },
      });
      if (!pageResponse.ok) throw new Error(`OpenSea returned ${pageResponse.status}`);
      stats = fromPublicPage(await pageResponse.text());
    }

    if (!stats) throw new Error('Collection statistics were not found');
    response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return response.status(200).json({ ...stats, source, updatedAt: new Date().toISOString() });
  } catch (error) {
    return response.status(502).json({ error: 'Live collection statistics are temporarily unavailable' });
  }
};
