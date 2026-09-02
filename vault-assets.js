(() => {
  const roots = [...document.querySelectorAll('[data-vault-assets]')];
  if (!roots.length) return;

  const format = (value, decimals = 18) => {
    const base = BigInt(value || 0);
    const scale = 10n ** BigInt(decimals);
    const whole = base / scale;
    const fraction = (base % scale).toString().padStart(decimals, '0').slice(0, 4).replace(/0+$/, '');
    return `${whole.toLocaleString()}${fraction ? `.${fraction}` : ''}`;
  };

  async function refresh() {
    try {
      const payload = await fetch(`/api/live-auctions?vaultAssets=${Math.floor(Date.now() / 5000)}`).then((response) => {
        if (!response.ok) throw new Error('Vault feed unavailable');
        return response.json();
      });
      const assets = (payload.stats?.assets || []).filter((asset) => asset.symbol?.toUpperCase() === 'RARE');
      roots.forEach((root) => {
        root.replaceChildren(...assets.map((asset) => {
          const row = document.createElement('span');
          const label = document.createElement('small');
          const amount = document.createElement('strong');
          label.textContent = asset.symbol;
          amount.textContent = `${format(asset.value, asset.decimals)} ${asset.symbol}`;
          row.append(label, amount);
          return row;
        }));
      });
      document.querySelectorAll('[data-home-rare-burned]').forEach((node) => {
        node.textContent = `${format(payload.stats?.verifiedBurned, 18)} $RARE`;
      });
    } catch {
      roots.forEach((root) => { if (!root.children.length) root.textContent = 'LIVE VAULT DATA RETRYING…'; });
    }
  }

  refresh();
  window.setInterval(() => { if (!document.hidden) refresh(); }, 10000);
})();
