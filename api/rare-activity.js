const RARE_TOKEN = '0x1d522a4c3e1f3d97b585903474b2544cf9feeffb';
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const LEMON_VAULT = `https://lemon.fun/api/public/launchpad/vault/${RARE_TOKEN}`;
const RARE_POOL = '0x8ec9c76ed191fb03397637acee1ce928426beb80';

const shortAddress = (value = '') => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : 'Unknown';

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
  try {
    const [transferResult, lemonResult] = await Promise.all([
      fetch(`${EXPLORER}/api/v2/tokens/${RARE_TOKEN}/transfers`, {
        headers: { accept: 'application/json', 'user-agent': 'UltraRares/1.0' },
        signal: AbortSignal.timeout(12000),
      }),
      fetch(LEMON_VAULT, {
        headers: { accept: 'application/json', 'user-agent': 'UltraRares/1.0' },
        signal: AbortSignal.timeout(12000),
      }),
    ]);
    if (!transferResult.ok || !lemonResult.ok) throw new Error('Live source unavailable');
    const payload = await transferResult.json();
    const lemon = await lemonResult.json();
    const items = payload.items || [];
    const liquidityCandidates = [...new Set(items
      .filter((item) => item.to?.hash?.toLowerCase() === RARE_POOL)
      .map((item) => item.transaction_hash))];
    const liquidityChecks = await Promise.all(liquidityCandidates.map(async (hash) => {
      try {
        const transactionResult = await fetch(`${EXPLORER}/api/v2/transactions/${hash}`, {
          headers: { accept: 'application/json', 'user-agent': 'UltraRares/1.0' },
          signal: AbortSignal.timeout(7000),
        });
        if (!transactionResult.ok) return null;
        const transaction = await transactionResult.json();
        const destination = `${transaction.to?.name || ''} ${transaction.to?.hash || ''}`.toLowerCase();
        return destination.includes('nonfungiblepositionmanager') ? hash : null;
      } catch {
        return null;
      }
    }));
    const liquidityHashes = new Set(liquidityChecks.filter(Boolean));
    const buyHashes = new Set(items
      .filter((item) => item.from?.hash?.toLowerCase() === RARE_POOL)
      .map((item) => item.transaction_hash));
    const sellHashes = new Set(items
      .filter((item) => item.to?.hash?.toLowerCase() === RARE_POOL)
      .map((item) => item.transaction_hash));
    const transfers = items.slice(0, 30).map((item) => ({
      hash: item.transaction_hash,
      logIndex: item.log_index,
      from: item.from?.hash || '',
      fromLabel: item.from?.name || shortAddress(item.from?.hash),
      to: item.to?.hash || '',
      toLabel: item.to?.name || shortAddress(item.to?.hash),
      value: item.total?.value || '0',
      decimals: Number(item.total?.decimals || item.token?.decimals || 18),
      timestamp: item.timestamp,
      side: liquidityHashes.has(item.transaction_hash) ? 'liquidity' : buyHashes.has(item.transaction_hash) ? 'buy' : sellHashes.has(item.transaction_hash) ? 'sell' : 'transfer',
      url: `${EXPLORER}/tx/${item.transaction_hash}`,
    }));
    response.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
    return response.status(200).json({
      transfers,
      latestBuyHash: items.find((item) => buyHashes.has(item.transaction_hash))?.transaction_hash || null,
      gme: {
        symbol: lemon.stockSymbol || 'GME',
        paidToHolders: lemon.stats?.totalPublished || lemon.stats?.totalDistributed || '0',
        nextRound: lemon.stats?.pendingStock || '0',
        roundsPaid: Number(lemon.stats?.epochCount || lemon.epochs?.length || 0),
        holderCount: Math.max(0, ...(lemon.epochs || []).map((epoch) => Number(epoch.holder_count || 0))),
        creatorEarned: lemon.creatorEarned || '0',
        minBalance: lemon.stats?.minShareBalance || lemon.minShareBalance || '0',
        feeSplit: {
          holders: Number(lemon.splits?.holdersBps || 0) / 100,
          creator: Number(lemon.splits?.creatorBps || 0) / 100,
          platform: Number(lemon.splits?.platformBps || 0) / 100,
        },
        vault: lemon.vault || '',
        source: `https://lemon.fun/terminal/${RARE_TOKEN}`,
      },
      updatedAt: new Date().toISOString(),
    });
  } catch {
    return response.status(502).json({ error: 'Live $RARE activity is temporarily unavailable' });
  }
};
