const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com/';
const ULTRA_RARES_CONTRACT = '0x923aaaa62c12505b1bbb57ed52b730d6462c01c5';
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

function balanceOfData(wallet) {
  return `0x70a08231${wallet.slice(2).toLowerCase().padStart(64, '0')}`;
}

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' });

  const wallet = String(request.body?.wallet || '').trim();
  if (!ADDRESS_PATTERN.test(wallet)) return response.status(400).json({ error: 'Enter a valid Ethereum-style wallet address.' });

  try {
    const rpcResponse = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: ULTRA_RARES_CONTRACT, data: balanceOfData(wallet) }, 'latest'],
      }),
    });
    if (!rpcResponse.ok) throw new Error('Robinhood Chain RPC unavailable');
    const payload = await rpcResponse.json();
    if (payload.error || !payload.result) throw new Error('Holder check failed');

    const nftBalance = Number(BigInt(payload.result));
    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json({
      wallet: wallet.toLowerCase(),
      marked: nftBalance > 0,
      nftBalance,
      checkedAt: new Date().toISOString(),
    });
  } catch {
    return response.status(502).json({ error: 'The holder check is temporarily unavailable. Please try again.' });
  }
};
