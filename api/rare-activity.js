const RARE_TOKEN = '0x1d522a4c3e1f3d97b585903474b2544cf9feeffb';
const EXPLORER = 'https://robinhoodchain.blockscout.com';

const shortAddress = (value = '') => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : 'Unknown';

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
  try {
    const result = await fetch(`${EXPLORER}/api/v2/tokens/${RARE_TOKEN}/transfers`, {
      headers: { accept: 'application/json', 'user-agent': 'UltraRares/1.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (!result.ok) throw new Error('Explorer unavailable');
    const payload = await result.json();
    const transfers = (payload.items || []).slice(0, 30).map((item) => ({
      hash: item.transaction_hash,
      logIndex: item.log_index,
      from: item.from?.hash || '',
      fromLabel: item.from?.name || shortAddress(item.from?.hash),
      to: item.to?.hash || '',
      toLabel: item.to?.name || shortAddress(item.to?.hash),
      value: item.total?.value || '0',
      decimals: Number(item.total?.decimals || item.token?.decimals || 18),
      timestamp: item.timestamp,
      url: `${EXPLORER}/tx/${item.transaction_hash}`,
    }));
    response.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
    return response.status(200).json({
      transfers,
      gmeDistributed: '0',
      gmeStatus: 'No public GME distribution recorded yet',
      updatedAt: new Date().toISOString(),
    });
  } catch {
    return response.status(502).json({ error: 'Live $RARE activity is temporarily unavailable' });
  }
};
