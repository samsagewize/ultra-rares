const COLLECTION_CONTRACT = '0x923aaaa62c12505b1bbb57ed52b730d6462c01c5';
const HOLDERS_URL = `https://robinhoodchain.blockscout.com/api/v2/tokens/${COLLECTION_CONTRACT}/holders`;

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });

  try {
    const holders = new Map();
    let nextPage = null;

    for (let page = 0; page < 10; page += 1) {
      const url = new URL(HOLDERS_URL);
      if (nextPage) Object.entries(nextPage).forEach(([key, value]) => url.searchParams.set(key, String(value)));
      const blockscoutResponse = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'UltraRaresHolders/1.0 (+https://ultra-rares.vercel.app)' },
      });
      if (!blockscoutResponse.ok) throw new Error(`Blockscout returned ${blockscoutResponse.status}`);

      const payload = await blockscoutResponse.json();
      for (const item of payload.items || []) {
        const address = item.address?.hash?.toLowerCase();
        if (/^0x[a-f0-9]{40}$/.test(address)) holders.set(address, Number(item.value) || 0);
      }

      nextPage = payload.next_page_params || null;
      if (!nextPage) break;
    }

    if (!holders.size) throw new Error('No holders were returned');
    const addresses = [...holders.keys()];
    const totalNfts = [...holders.values()].reduce((total, count) => total + count, 0);
    response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return response.status(200).json({
      addresses,
      uniqueHolders: addresses.length,
      totalNfts,
      source: 'Robinhood Chain Blockscout',
      updatedAt: new Date().toISOString(),
    });
  } catch {
    return response.status(502).json({ error: 'The live holder list is temporarily unavailable' });
  }
};
