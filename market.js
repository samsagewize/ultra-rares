const statElements = {
  volumeNative: document.querySelector('[data-stat="volume-native"]'),
  volumeUsd: document.querySelector('[data-stat="volume-usd"]'),
  floorNative: document.querySelector('[data-stat="floor-native"]'),
  floorUsd: document.querySelector('[data-stat="floor-usd"]'),
  owners: document.querySelector('[data-stat="owners"]'),
  supply: document.querySelector('[data-stat="supply"]'),
};
const liveStatus = document.querySelector('.live-status');
const activityGrid = document.querySelector('.scooped-grid');

const formatEth = (value, maximumFractionDigits = 5) => `${Number(value).toLocaleString('en-US', { maximumFractionDigits })} ETH`;
const formatUsd = (value) => Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

const formatSaleTime = (value) => {
  const date = new Date(value);
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

function createActivityCard(sale) {
  const card = document.createElement('a');
  card.className = 'scoop-card';
  card.href = sale.itemUrl;
  card.target = '_blank';
  card.rel = 'noopener noreferrer';

  const image = document.createElement('img');
  image.src = sale.imageUrl;
  image.alt = `Ultra Rare number ${sale.tokenId}`;
  image.loading = 'lazy';

  const info = document.createElement('div');
  info.className = 'scoop-info';

  const saleRow = document.createElement('p');
  const token = document.createElement('strong');
  token.textContent = sale.name || `#${sale.tokenId}`;
  const price = document.createElement('span');
  price.textContent = sale.priceNative === null ? 'Sale' : `${Number(sale.priceNative).toLocaleString('en-US', { maximumFractionDigits: 6 })} ${sale.priceSymbol}`;
  saleRow.append(token, price);

  const buyerRow = document.createElement('p');
  const buyerLabel = document.createElement('small');
  buyerLabel.textContent = 'Scooped by';
  const buyer = document.createElement('span');
  buyer.textContent = `${sale.buyer} ↗`;
  buyerRow.append(buyerLabel, buyer);

  const metadataRow = document.createElement('p');
  metadataRow.className = 'scoop-metadata';
  const source = document.createElement('small');
  source.textContent = 'OpenSea sale';
  const time = document.createElement('time');
  time.dateTime = sale.eventTime;
  time.textContent = formatSaleTime(sale.eventTime);
  metadataRow.append(source, time);

  info.append(saleRow, buyerRow, metadataRow);
  card.append(image, info);
  return card;
}

function renderActivity(activity) {
  const cards = activity.map(createActivityCard);
  activityGrid.replaceChildren(...cards);
}

async function refreshMarketData() {
  liveStatus.textContent = 'Updating live data…';
  const [statsResult, activityResult] = await Promise.allSettled([
    fetch('/api/collection-stats', { headers: { accept: 'application/json' } }).then((response) => {
      if (!response.ok) throw new Error('Stats unavailable');
      return response.json();
    }),
    fetch('/api/collection-activity', { headers: { accept: 'application/json' } }).then((response) => {
      if (!response.ok) throw new Error('Activity unavailable');
      return response.json();
    }),
  ]);

  if (statsResult.status === 'fulfilled') {
    const stats = statsResult.value;
    statElements.volumeNative.textContent = formatEth(stats.volumeNative, 6);
    statElements.volumeUsd.textContent = formatUsd(stats.volumeUsd);
    statElements.floorNative.textContent = formatEth(stats.floorNative, 6);
    statElements.floorUsd.textContent = formatUsd(stats.floorUsd);
    statElements.owners.textContent = Number(stats.owners).toLocaleString('en-US');
    statElements.supply.textContent = `of ${Number(stats.totalSupply).toLocaleString('en-US')} rares`;
  }

  if (activityResult.status === 'fulfilled') renderActivity(activityResult.value.activity);

  if (statsResult.status === 'fulfilled' || activityResult.status === 'fulfilled') {
    const updatedAt = activityResult.status === 'fulfilled' ? activityResult.value.updatedAt : statsResult.value.updatedAt;
    const updated = new Date(updatedAt);
    liveStatus.textContent = `Live · updated ${updated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    liveStatus.classList.add('is-live');
  } else {
    liveStatus.textContent = 'Last known snapshot · live feed retrying';
    liveStatus.classList.remove('is-live');
  }
}

refreshMarketData();
setInterval(() => {
  if (!document.hidden) refreshMarketData();
}, 60000);
