const NFT_CONTRACT = '0x923aaaa62c12505b1bbb57ed52b730d6462c01c5';
const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
const TOKEN_URI_SELECTOR = 'c87b56dd';
const IPFS_GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs/',
  'https://dweb.link/ipfs/',
  'https://ipfs.io/ipfs/',
];

function decodeAbiString(value) {
  const hex = value.slice(2);
  const offset = Number.parseInt(hex.slice(0, 64), 16) * 2;
  const length = Number.parseInt(hex.slice(offset, offset + 64), 16);
  return Buffer.from(hex.slice(offset + 64, offset + 64 + length * 2), 'hex').toString('utf8');
}

function gatewayUrl(uri, gateway = IPFS_GATEWAYS[0]) {
  return uri?.startsWith('ipfs://') ? `${gateway}${uri.slice(7)}` : uri;
}

async function fetchMetadata(uri) {
  if (uri.startsWith('data:application/json;base64,')) {
    return JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString('utf8'));
  }
  if (uri.startsWith('data:application/json,')) {
    return JSON.parse(decodeURIComponent(uri.split(',').slice(1).join(',')));
  }

  const urls = uri.startsWith('ipfs://') ? IPFS_GATEWAYS.map((gateway) => gatewayUrl(uri, gateway)) : [uri];
  for (const url of urls) {
    try {
      const result = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (result.ok) return result.json();
    } catch {}
  }
  throw new Error('NFT metadata is unavailable');
}

async function fetchOpenSeaImage(tokenId) {
  try {
    const itemUrl = `https://opensea.io/item/robinhood/${NFT_CONTRACT}/${tokenId}`;
    const page = await fetch(itemUrl, {
      headers: { 'user-agent': 'UltraRaresMetadata/1.0 (+https://ultra-rares.vercel.app)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!page.ok) return '';
    const html = await page.text();
    const images = [...html.matchAll(/"imageUrl":"([^"]+)"/g)].map((match) => match[1].replaceAll('\\u0026', '&'));
    return images.find((image) => image.includes(`/robinhood/${NFT_CONTRACT}/`)) || '';
  } catch {
    return '';
  }
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
  const tokenId = Number.parseInt(request.query.tokenId, 10);
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > 420) return response.status(400).json({ error: 'Invalid token ID' });

  try {
    const data = `0x${TOKEN_URI_SELECTOR}${tokenId.toString(16).padStart(64, '0')}`;
    const rpcResponse = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: NFT_CONTRACT, data }, 'latest'] }),
      signal: AbortSignal.timeout(10000),
    });
    const rpcPayload = await rpcResponse.json();
    if (!rpcPayload.result || rpcPayload.error) throw new Error('tokenURI lookup failed');
    const tokenUri = decodeAbiString(rpcPayload.result);
    const metadata = await fetchMetadata(tokenUri);
    const openSeaImage = await fetchOpenSeaImage(tokenId);
    response.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return response.status(200).json({
      tokenId,
      name: metadata.name || `Ultra Rare #${tokenId}`,
      image: openSeaImage || gatewayUrl(metadata.image),
    });
  } catch {
    return response.status(502).json({ error: 'NFT artwork is temporarily unavailable' });
  }
};
