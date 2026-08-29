(() => {
  const desk = document.querySelector('[data-buyback-goal]');
  if (!desk) return;
  const fill = desk.querySelector('[data-buyback-goal-fill]');
  const marker = desk.querySelector('[data-buyback-goal-marker]');
  const value = desk.querySelector('[data-buyback-goal-value]');
  const status = desk.querySelector('[data-buyback-goal-status]');
  const money = (amount) => Number(amount || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  async function refresh() {
    try {
      const response = await fetch('/api/rare-market', { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('Unavailable');
      const market = await response.json();
      const cap = Number(market.marketCap || 0);
      const progress = Math.min(100, Math.max(0, (cap / 100000) * 100));
      fill.style.width = `${progress}%`;
      marker.style.left = `clamp(13px, ${progress}%, calc(100% - 13px))`;
      value.textContent = money(cap);
      status.textContent = 'LIVE $RARE MARKET CAP';
      desk.classList.add('is-live');
    } catch {
      value.textContent = 'RETRYING';
      status.textContent = 'LIVE FEED PENDING';
      desk.classList.remove('is-live');
    }
  }

  refresh();
  window.setInterval(() => { if (!document.hidden) refresh(); }, 10000);
})();
