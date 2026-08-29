(() => {
  const eth = document.querySelector('[data-buyback-eth]');
  const usd = document.querySelector('[data-buyback-usd]');
  const breakdown = document.querySelector('[data-buyback-breakdown]');
  if (!eth || !usd || !breakdown) return;

  const refresh = async () => {
    try {
      const response = await fetch('/api/buyback-fund', { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('Unavailable');
      const data = await response.json();
      eth.textContent = `${Number(data.availableEth).toLocaleString('en-US', { maximumFractionDigits: 5 })} ETH`;
      usd.textContent = `≈ ${Number(data.availableUsd).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })}`;
      breakdown.textContent = `${Number(data.nativeEth).toFixed(5)} ETH + ${Number(data.wrappedEth).toFixed(5)} WETH · ${Number(data.rareBalance).toLocaleString('en-US', { maximumFractionDigits: 2 })} $RARE`;
    } catch {
      eth.textContent = 'FEED RETRYING';
      usd.textContent = 'OPEN WALLET ↗';
      breakdown.textContent = 'PUBLIC BLOCKSCOUT BALANCE';
    }
  };

  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 15000);
})();
