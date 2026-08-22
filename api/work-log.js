const ADMIN = '0x562f6ac10723ef6af9f077a83cf25135fb369612';
const RARE = '0x1d522a4c3e1f3d97b585903474b2544cf9feeffb';
const POOL = '0x8ec9c76ed191fb03397637acee1ce928426beb80';
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const DEX = `https://api.dexscreener.com/token-pairs/v1/robinhood/${RARE}`;

const amount = (item) => {
  const decimals = Number(item.total?.decimals || item.token?.decimals || 18);
  const value = Number(item.total?.value || 0) / (10 ** decimals);
  return Number.isFinite(value) ? value : 0;
};

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
  try {
    const [transfersResponse, pairsResponse] = await Promise.all([
      fetch(`${EXPLORER}/api/v2/tokens/${RARE}/transfers`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) }),
      fetch(DEX, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) }).catch(() => null),
    ]);
    if (!transfersResponse.ok) throw new Error('source unavailable');
    const transfers = (await transfersResponse.json()).items || [];
    const pairs = pairsResponse?.ok ? await pairsResponse.json() : [];
    const pair = pairs.sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0))[0];
    const liquidity = Number(pair?.liquidity?.usd || 0);
    const change = Number(pair?.priceChange?.h1 || 0);
    const spreadGuard = liquidity >= 5000;
    const confidence = Math.min(95, Math.max(25, 55 + Math.abs(change) * 4 + (spreadGuard ? 10 : -20)));
    const entries = transfers.slice(0, 12).map((item, index) => {
      const from = item.from?.hash?.toLowerCase() || '';
      const to = item.to?.hash?.toLowerCase() || '';
      const side = from === POOL ? 'BUY OBSERVED' : to === POOL ? 'SELL OBSERVED' : 'TRANSFER OBSERVED';
      return {
        id: `${item.transaction_hash}-${item.log_index}`,
        step: side,
        detail: `${amount(item).toLocaleString('en-US', { maximumFractionDigits: 2 })} $RARE · paper engine ${index === 0 ? 'evaluating latest flow' : 'recorded market context'}`,
        timestamp: item.timestamp,
        goal: side === 'BUY OBSERVED' ? 'Measure follow-through without chasing price' : side === 'SELL OBSERVED' ? 'Wait for selling pressure to settle' : 'Keep the market model current',
        hash: item.transaction_hash,
        url: `${EXPLORER}/tx/${item.transaction_hash}`,
      };
    });
    entries.unshift({
      id: `decision-${entries[0]?.id || Date.now()}`,
      step: confidence >= 70 && spreadGuard ? 'PAPER SETUP FOUND' : 'PAPER WAIT',
      detail: pairs.length ? `Confidence ${confidence.toFixed(0)}% · 1h move ${change.toFixed(2)}% · liquidity $${liquidity.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : 'Market quote unavailable · fail-safe decision is WAIT',
      timestamp: new Date().toISOString(),
      goal: 'Protect ETH first; enter only after every risk check passes',
      hash: '',
      url: '',
    });
    response.setHeader('Cache-Control', 's-maxage=2, stale-while-revalidate=3');
    return response.status(200).json({
      mode: 'PAPER',
      admin: ADMIN,
      execution: 'NO FUNDS OR APPROVALS',
      currentGoal: 'Observe 100 qualified setups before enabling a disposable funded pilot',
      observedSetups: entries.length - 1,
      journey: [
        {
          number: 1,
          label: 'DEPOSIT',
          status: 'WAITING',
          headline: '0.01 ETH proposed',
          detail: 'Admin pilot deposit has not been made. No wallet approval requested.',
          timestamp: null,
        },
        {
          number: 2,
          label: 'ENTER TOKEN',
          status: 'LOCKED',
          headline: `Waiting · live $RARE market cap $${Number(pair?.marketCap || pair?.fdv || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
          detail: 'The exact ETH input, token output, entry market cap and transaction will appear after an audited entry.',
          timestamp: null,
        },
        {
          number: 3,
          label: 'EXIT TO WETH',
          status: 'LOCKED',
          headline: 'No position to exit',
          detail: 'Exit market cap, tokens sold, WETH returned and realized P/L will be recorded here.',
          timestamp: null,
        },
        {
          number: 4,
          label: 'SECURE PROFIT',
          status: 'LOCKED',
          headline: '70% claim pocket · 30% continues',
          detail: 'Only positive realized WETH is split. A loss creates no claim and counts toward the circuit breaker.',
          timestamp: null,
        },
      ],
      entries,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    return response.status(502).json({ error: 'The public paper-work log is temporarily unavailable' });
  }
};
