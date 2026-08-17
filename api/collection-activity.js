const COLLECTION_SLUG = 'ultra-rares-robinhood';
const COLLECTION_PAGE = `https://opensea.io/collection/${COLLECTION_SLUG}/activity`;

function extractJsonArray(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) return null;

  const start = source.indexOf('[', markerIndex + marker.length);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') inString = true;
    else if (character === '[') depth += 1;
    else if (character === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  return null;
}

function shortAddress(address) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Collector';
}

function normalizeSale(event) {
  const tokenId = event?.item?.tokenId;
  if (!tokenId || event?.__typename !== 'Sale') return null;

  const buyerAddress = event?.to?.address || null;
  return {
    id: event.id,
    tokenId,
    name: event.item.name || `#${tokenId}`,
    imageUrl: event.item.imageUrl,
    priceNative: event.price?.token?.unit ?? null,
    priceSymbol: event.price?.token?.symbol || 'ETH',
    priceUsd: event.price?.usd ?? null,
    buyer: event.to?.displayName || shortAddress(buyerAddress),
    buyerAddress,
    seller: event.from?.displayName || shortAddress(event.from?.address),
    eventTime: event.eventTime,
    transactionHash: event.transactionHash,
    itemUrl: `https://opensea.io/item/robinhood/${event.item.contractAddress}/${tokenId}`,
  };
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });

  try {
    const pageResponse = await fetch(COLLECTION_PAGE, {
      headers: { 'user-agent': 'UltraRaresActivity/1.0 (+https://ultra-rares.vercel.app)' },
    });
    if (!pageResponse.ok) throw new Error(`OpenSea returned ${pageResponse.status}`);

    const html = await pageResponse.text();
    const activityJson = extractJsonArray(html, '"collectionActivity":{"items":');
    if (!activityJson) throw new Error('OpenSea activity was not found');

    const activity = JSON.parse(activityJson)
      .map(normalizeSale)
      .filter(Boolean)
      .slice(0, 6);

    if (!activity.length) throw new Error('No recent sales were found');

    response.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=120');
    return response.status(200).json({
      activity,
      source: 'OpenSea collection activity',
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return response.status(502).json({ error: 'Live collection activity is temporarily unavailable' });
  }
};
