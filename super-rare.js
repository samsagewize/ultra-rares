(() => {
  const root = document.querySelector('[data-super-rare]');
  if (!root) return;

  const set = (name, value) => {
    document.querySelectorAll(`[data-super-${name}]`).forEach((node) => { node.textContent = value; });
  };
  const formatEth = (value) => `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH`;

  fetch('/api/super-rare-stats', { headers: { accept: 'application/json' } })
    .then((response) => {
      if (!response.ok) throw new Error('Unavailable');
      return response.json();
    })
    .then((data) => {
      const frame = root.querySelector('iframe');
      const link = root.querySelector('[data-super-link]');
      const listing = root.querySelector('[data-super-listing]');
      if (frame) frame.src = `super-rare-frame.html?token=${encodeURIComponent(data.featuredTokenId)}&url=${encodeURIComponent(data.featuredUrl)}&image=${encodeURIComponent(data.featuredImageUrl || '')}`;
      if (link) link.href = data.featuredUrl;
      if (listing) listing.href = data.featuredUrl;
      set('token', `DAILY ARTWORK · #${data.featuredTokenId}`);
      set('listing-token', `#${data.featuredTokenId}`);
      set('price', data.featuredListingPriceEth ? formatEth(data.featuredListingPriceEth) : 'VIEW PRICE ↗');
      set('volume', formatEth(data.grossRevenueEth ?? data.grossMintRevenueEth));
      set('vault', formatEth(data.vaultBuybackEth));
      set('remainder', formatEth(data.remainderEth));
      set('minted', `${data.mintedUnits} MINTED · ${data.artworkCount} ARTWORK${data.artworkCount === 1 ? '' : 'S'}`);
      set('sold', `${data.soldCount} SUPER RARE${data.soldCount === 1 ? '' : 'S'} SOLD`);
      set('sales-volume', formatEth(data.salesVolumeEth));
      set('status', `LIVE · UPDATED ${new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
      root.classList.toggle('is-sold', data.featuredSoldCount > 0);
    })
    .catch(() => set('status', 'LIVE FEED RETRYING'));
})();
