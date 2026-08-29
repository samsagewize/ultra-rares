const ADMIN = '0xd060fB7c2b6E29AcC949c85f182266804061Fe1E';
const RARE = '0x1d522a4c3e1f3d97b585903474b2544cf9feeffb';
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const RPC = 'https://rpc.mainnet.chain.robinhood.com/';
const RARE_PAIR = '0x8ec9c76ed191fb03397637acee1ce928426beb80';

const asUnits = (value = '0', decimals = 18) => Number(value) / (10 ** Number(decimals));

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
  try {
    const balanceOf = `0x70a08231${ADMIN.slice(2).toLowerCase().padStart(64, '0')}`;
    const [rpcResponse, marketResponse] = await Promise.all([
      fetch(RPC, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(12000),
        body: JSON.stringify([
          { jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [ADMIN, 'latest'] },
          { jsonrpc: '2.0', id: 2, method: 'eth_call', params: [{ to: WETH, data: balanceOf }, 'latest'] },
          { jsonrpc: '2.0', id: 3, method: 'eth_call', params: [{ to: RARE, data: balanceOf }, 'latest'] },
        ]),
      }),
      fetch(`https://api.dexscreener.com/latest/dex/pairs/robinhood/${RARE_PAIR}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12000) }),
    ]);
    if (!rpcResponse.ok || !marketResponse.ok) throw new Error('Live sources unavailable');
    const rpcPayload = await rpcResponse.json();
    const market = await marketResponse.json();
    const result = (id) => rpcPayload.find((entry) => entry.id === id)?.result;
    if (!result(1) || !result(2) || !result(3)) throw new Error('Balance read failed');
    const pair = market.pairs?.[0];
    const nativeEth = asUnits(BigInt(result(1)).toString(), 18);
    const wrappedEth = asUnits(BigInt(result(2)).toString(), 18);
    const rareBalance = asUnits(BigInt(result(3)).toString(), 18);
    const ethPriceUsd = pair?.priceNative ? Number(pair.priceUsd || 0) / Number(pair.priceNative) : 0;
    const availableEth = nativeEth + wrappedEth;

    response.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
    return response.status(200).json({
      admin: ADMIN,
      nativeEth,
      wrappedEth,
      availableEth,
      availableUsd: availableEth * ethPriceUsd,
      rareBalance,
      ethPriceUsd,
      methodology: 'Available native ETH plus WETH held by the public admin destination. This is a capacity estimate, not audited fee attribution.',
      source: `${EXPLORER}/address/${ADMIN}`,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    return response.status(502).json({ error: 'Buyback estimate is temporarily unavailable' });
  }
};
