const statElements = {
  volumeNative: document.querySelector('[data-stat="volume-native"]'),
  volumeUsd: document.querySelector('[data-stat="volume-usd"]'),
  floorNative: document.querySelector('[data-stat="floor-native"]'),
  floorUsd: document.querySelector('[data-stat="floor-usd"]'),
  owners: document.querySelector('[data-stat="owners"]'),
  supply: document.querySelector('[data-stat="supply"]'),
};
const liveStatus = document.querySelector('.live-status');

const formatEth = (value, maximumFractionDigits = 5) => `${Number(value).toLocaleString('en-US', { maximumFractionDigits })} ETH`;
const formatUsd = (value) => Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

async function refreshMarketStats() {
  liveStatus.textContent = 'Updating live data…';
  try {
    const response = await fetch('/api/collection-stats', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('Stats unavailable');
    const stats = await response.json();
    statElements.volumeNative.textContent = formatEth(stats.volumeNative, 6);
    statElements.volumeUsd.textContent = formatUsd(stats.volumeUsd);
    statElements.floorNative.textContent = formatEth(stats.floorNative, 6);
    statElements.floorUsd.textContent = formatUsd(stats.floorUsd);
    statElements.owners.textContent = Number(stats.owners).toLocaleString('en-US');
    statElements.supply.textContent = `of ${Number(stats.totalSupply).toLocaleString('en-US')} rares`;
    const updated = new Date(stats.updatedAt);
    liveStatus.textContent = `Live · updated ${updated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    liveStatus.classList.add('is-live');
  } catch {
    liveStatus.textContent = 'Last known snapshot · live feed retrying';
    liveStatus.classList.remove('is-live');
  }
}

refreshMarketStats();
setInterval(() => {
  if (!document.hidden) refreshMarketStats();
}, 60000);
