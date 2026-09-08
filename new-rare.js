(() => {
  const track = document.querySelector('[data-new-rare-transfers]');
  const state = document.querySelector('[data-feed-state]');
  const copyButton = document.querySelector('[data-copy-ca]');
  const ca = document.querySelector('[data-rare-ca]')?.textContent.trim();
  let seen = new Set();
  const short = (value) => `${value.slice(0, 6)}…${value.slice(-4)}`;
  const formatAmount = (raw, decimals = 18) => {
    const value = BigInt(raw || '0'); const scale = 10n ** BigInt(decimals); const whole = value / scale;
    const fraction = String(value % scale).padStart(decimals, '0').slice(0, 3).replace(/0+$/, '');
    return `${Number(whole).toLocaleString('en-US')}${fraction ? `.${fraction}` : ''} RARE`;
  };
  const render = (items) => {
    if (!items.length) { track.innerHTML = '<p class="new-rare-feed-empty">No confirmed transfers in the current live block window.</p>'; return; }
    const incoming = new Set(items.map((item) => `${item.hash}:${item.logIndex}`));
    const rows = items.map((item) => {
      const key = `${item.hash}:${item.logIndex}`; const link = document.createElement('a');
      link.className = `ticker-item rare-transfer-item new-rare-transfer is-rare-${item.side || 'transfer'}${seen.size && !seen.has(key) ? ' is-new-trade-pop' : ''}`;
      link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      const icon = document.createElement('span'); icon.className = 'rare-token-icon';
      const logo = document.createElement('img'); logo.src = 'assets/rare-token.png'; logo.alt = ''; icon.append(logo);
      const body = document.createElement('span'); const value = document.createElement('strong'); value.textContent = formatAmount(item.value, item.decimals);
      const route = document.createElement('small'); route.textContent = `${short(item.from)} → ${short(item.to)}`;
      const time = document.createElement('small'); time.textContent = `${item.side === 'buy' ? 'BUY' : item.side === 'sell' ? 'SELL' : 'TRANSFER'} · ${new Date(item.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      body.append(value, route, time); link.append(icon, body); return link;
    });
    track.replaceChildren(...rows); seen = incoming;
  };
  const refresh = async () => {
    try { const response = await fetch('/api/new-rare-activity', { cache: 'no-store' }); if (!response.ok) throw new Error();
      const payload = await response.json(); render(payload.transfers || []); state.textContent = 'LIVE'; state.classList.remove('is-retrying');
    } catch (_) { state.textContent = 'RETRYING'; state.classList.add('is-retrying'); }
  };
  copyButton?.addEventListener('click', async () => { await navigator.clipboard.writeText(ca); copyButton.textContent = 'COPIED ✓'; setTimeout(() => { copyButton.textContent = 'COPY CA'; }, 1800); });
  refresh(); setInterval(refresh, 4000);
})();
