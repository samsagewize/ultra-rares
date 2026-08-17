const crypto = require('crypto');

const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com/';
const ULTRA_RARES_CONTRACT = '0x923aaaa62c12505b1bbb57ed52b730d6462c01c5';
const RARE_TOKEN_CONTRACT = '0x1d522a4c3e1f3d97b585903474b2544cf9feeffb';
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

async function rpcCall(to, data) {
  const rpcResponse = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
  });
  if (!rpcResponse.ok) throw new Error('Robinhood Chain RPC unavailable');
  const payload = await rpcResponse.json();
  if (payload.error || !payload.result) throw new Error('Wallet balance check failed');
  return BigInt(payload.result);
}

function balanceOfData(wallet) {
  return `0x70a08231${wallet.slice(2).toLowerCase().padStart(64, '0')}`;
}

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' });

  const wallet = String(request.body?.wallet || '').trim();
  if (!ADDRESS_PATTERN.test(wallet)) return response.status(400).json({ error: 'Enter a valid Ethereum-style wallet address.' });

  try {
    const nftBalance = await rpcCall(ULTRA_RARES_CONTRACT, balanceOfData(wallet));
    if (nftBalance === 0n) {
      return response.status(403).json({ error: 'No Ultra Rare NFT was found in this wallet.' });
    }

    const existingRareBalance = await rpcCall(RARE_TOKEN_CONTRACT, balanceOfData(wallet));
    const submittedAt = new Date().toISOString();
    const requestId = `RARE-${crypto.createHash('sha256').update(`${wallet.toLowerCase()}:${submittedAt}`).digest('hex').slice(0, 10).toUpperCase()}`;
    const record = {
      type: 'rare_holder_request',
      requestId,
      wallet: wallet.toLowerCase(),
      nftBalance: nftBalance.toString(),
      existingRareBalance: existingRareBalance.toString(),
      submittedAt,
    };

    if (process.env.RARE_REQUEST_WEBHOOK_URL) {
      const webhookResponse = await fetch(process.env.RARE_REQUEST_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(record),
      });
      if (!webhookResponse.ok) throw new Error('Request storage unavailable');
    }

    console.log(JSON.stringify(record));
    response.setHeader('Cache-Control', 'no-store');
    return response.status(201).json({ requestId, wallet: record.wallet, nftBalance: Number(nftBalance), submittedAt });
  } catch (error) {
    return response.status(502).json({ error: 'The holder check is temporarily unavailable. Please try again.' });
  }
};
