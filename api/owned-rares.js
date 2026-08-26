const NFT_ADDRESS = '0x923aaaa62c12505b1bbb57ed52b730d6462c01c5';
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
  const address = String(request.query?.address || '');
  if (!ADDRESS_PATTERN.test(address)) return response.status(400).json({ error: 'A valid public wallet address is required' });

  try {
    const url = `https://robinhoodchain.blockscout.com/api/v2/tokens/${NFT_ADDRESS}/instances?holder_address_hash=${address}`;
    const upstream = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'UltraRaresWorld/1.0 (+https://raresrares.fun)' } });
    if (!upstream.ok) throw new Error(`Blockscout returned ${upstream.status}`);
    const payload = await upstream.json();
    const items = (payload.items || []).slice(0, 50).map((item) => ({
      tokenId: String(item.id),
      name: item.metadata?.name || `Ultra Rare #${item.id}`,
      image: item.image_url || item.metadata?.image || item.media_url || null,
    }));
    response.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');
    return response.status(200).json({ address, count: items.length, items, source: 'Robinhood Chain Blockscout' });
  } catch {
    return response.status(502).json({ error: 'Owned Ultra Rares are temporarily unavailable' });
  }
};
