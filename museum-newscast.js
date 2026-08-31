(() => {
  const track = document.querySelector('[data-museum-newscast]');
  if (!track) return;

  const short = (value = '') => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : 'collector';
  const rareAmount = (value, decimals = 18) => {
    const amount = Number(value) / (10 ** Number(decimals));
    return Number.isFinite(amount) ? amount.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—';
  };

  const makeItem = (copy, kind, href) => {
    const link = document.createElement('a');
    link.className = `newscast-item is-${kind}`;
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = copy;
    return link;
  };

  async function refresh() {
    const [nftResult, rareResult, superResult, vaultResult] = await Promise.allSettled([
      fetch('/api/collection-activity', { headers: { accept: 'application/json' } }).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch('/api/rare-activity', { headers: { accept: 'application/json' } }).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch('/api/super-rare-stats', { headers: { accept: 'application/json' } }).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch('/api/live-auctions', { headers: { accept: 'application/json' } }).then((response) => response.ok ? response.json() : Promise.reject()),
    ]);

    const items = [];
    if (vaultResult.status === 'fulfilled' && vaultResult.value.stats?.vaultBalance !== null) {
      items.push(makeItem(`FEE VAULT · ${rareAmount(vaultResult.value.stats.vaultBalance)} $RARE ON-CHAIN`, 'vault', 'https://robinhoodchain.blockscout.com/address/0x55f3ed784d5b0142a833e411d133f043df426f79'));
    }
    if (superResult.status === 'fulfilled') {
      const superData = superResult.value;
      superData.latestSales.forEach((sale) => items.push(makeItem(`${superData.soldCount} SUPER RARE${superData.soldCount === 1 ? '' : 'S'} SOLD · #${sale.tokenId} · ${sale.priceEth.toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH · VOLUME ${superData.salesVolumeEth.toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH`, 'super', sale.itemUrl)));
    }
    if (nftResult.status === 'fulfilled') {
      nftResult.value.activity.forEach((sale) => items.push(makeItem(`NFT SOLD · ULTRA RARE #${sale.tokenId} · ${sale.priceNative ?? '—'} ${sale.priceSymbol || 'ETH'} · TO ${sale.buyer}`, 'nft', sale.itemUrl)));
    }
    if (rareResult.status === 'fulfilled') {
      rareResult.value.transfers.filter((transfer) => transfer.side === 'buy').slice(0, 10).forEach((buy) => items.push(makeItem(`$RARE BUY · ${rareAmount(buy.value, buy.decimals)} $RARE · ${short(buy.to)}`, 'buy', buy.url)));
    }
    if (!items.length) items.push(makeItem('LIVE MARKET TAPE RETRYING · VIEW $RARE MARKET', 'status', 'rare.html'));
    track.replaceChildren(...items, ...items.map((item) => item.cloneNode(true)));
  }

  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 8000);
})();
