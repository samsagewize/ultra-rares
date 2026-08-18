const requestForm = document.querySelector('[data-rare-check]');
const result = document.querySelector('[data-check-result]');
const walletInput = document.querySelector('#wallet-address');
const copyContractButton = document.querySelector('[data-copy-contract]');
const copyHoldersButton = document.querySelector('[data-copy-holders]');
const holderCopyStatus = document.querySelector('[data-holder-copy-status]');
const contractAddress = '0x1d522a4c3e1f3d97b585903474b2544cf9feeffb';
const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const marketCapElement = document.querySelector('[data-rare-market-cap]');
const marketStatusElement = document.querySelector('[data-rare-market-status]');
const goalFill = document.querySelector('[data-goal-fill]');
const rareVolumeElement = document.querySelector('[data-rare-volume]');
const rareVolumeTradesElement = document.querySelector('[data-rare-volume-trades]');
const rareTokenLogo = 'https://cdn.dexscreener.com/cms/images/eAnRpxERpMRHGDxC?width=800&height=800&quality=95&format=auto';
const rareTransferTrack = document.querySelector('[data-rare-transfers]');
const gmeDistributedElement = document.querySelector('[data-gme-distributed]');
const gmeNextElement = document.querySelector('[data-gme-next]');
const gmeRoundsElement = document.querySelector('[data-gme-rounds]');
const gmeCreatorElement = document.querySelector('[data-gme-creator]');
const gmeMinElement = document.querySelector('[data-gme-min]');
const gmeSplitElement = document.querySelector('[data-gme-split]');
const rareActivityStatus = document.querySelector('[data-rare-activity-status]');
const rareTransferTicker = document.querySelector('.rare-transfer-ticker');
let latestRareBuyHash = null;
let rareBuyTimer = null;

const formatMarketCap = (value) => Number(value).toLocaleString('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

async function refreshRareMarket() {
  try {
    const response = await fetch('/api/rare-market', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('Market data unavailable');
    const market = await response.json();
    const progress = Math.min(100, Math.max(0, (market.marketCap / 1000000) * 100));
    marketCapElement.textContent = formatMarketCap(market.marketCap);
    rareVolumeElement.textContent = formatMarketCap(market.volume24hUsd || 0);
    rareVolumeTradesElement.textContent = `${Number(market.buys24h || 0).toLocaleString('en-US')} buys · ${Number(market.sells24h || 0).toLocaleString('en-US')} sells`;
    marketStatusElement.textContent = `Live via DexScreener · ${market.liquidityUsd === null ? 'liquidity unavailable' : `${formatMarketCap(market.liquidityUsd)} liquidity`}`;
    goalFill.style.width = `${progress}%`;
  } catch {
    marketCapElement.textContent = 'Live data unavailable';
    rareVolumeElement.textContent = 'Unavailable';
    rareVolumeTradesElement.textContent = 'DexScreener feed retrying';
    marketStatusElement.textContent = 'The milestone roadmap remains active';
    goalFill.style.width = '0%';
  }
}

copyContractButton?.addEventListener('click', async () => {
  await navigator.clipboard.writeText(contractAddress);
  copyContractButton.textContent = 'Copied!';
  window.setTimeout(() => { copyContractButton.textContent = 'Copy contract'; }, 1600);
});

copyHoldersButton?.addEventListener('click', async () => {
  copyHoldersButton.disabled = true;
  copyHoldersButton.textContent = 'Loading holders…';
  holderCopyStatus.textContent = '';
  try {
    const response = await fetch('/api/holder-addresses', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('Holder list unavailable');
    const payload = await response.json();
    await navigator.clipboard.writeText(payload.addresses.join('\n'));
    copyHoldersButton.textContent = `Copied ${payload.addresses.length} addresses!`;
    holderCopyStatus.textContent = `Live snapshot · ${payload.totalNfts} NFTs across ${payload.addresses.length} wallets`;
  } catch {
    copyHoldersButton.textContent = 'Try copying again';
    holderCopyStatus.textContent = 'The live holder list is temporarily unavailable.';
  } finally {
    copyHoldersButton.disabled = false;
  }
});

requestForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const wallet = walletInput.value.trim();
  result.className = 'request-result';

  if (!addressPattern.test(wallet)) {
    result.textContent = 'Enter a complete Ethereum-style wallet address beginning with 0x.';
    result.classList.add('is-error');
    walletInput.focus();
    return;
  }

  const submitButton = requestForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = 'Checking wallet…';
  result.textContent = 'Checking this wallet on Robinhood Chain…';

  try {
    const response = await fetch('/api/rare-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ wallet }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Wallet could not be checked');

    result.innerHTML = '';
    const heading = document.createElement('strong');
    heading.textContent = payload.marked ? '✓ You are marked for $RARE' : 'Not marked for $RARE';
    const details = document.createElement('span');
    details.textContent = payload.marked
      ? ` · ${payload.nftBalance} Ultra Rare${payload.nftBalance === 1 ? '' : 's'} verified in this wallet.`
      : ' · No Ultra Rare NFT was found in this wallet.';
    result.append(heading, details);
    result.classList.add(payload.marked ? 'is-success' : 'is-error');
  } catch (error) {
    result.textContent = error.message;
    result.classList.add('is-error');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Check wallet ↗';
  }
});

const shortWallet = (value) => `${value.slice(0, 6)}…${value.slice(-4)}`;

function formatRareTransfer(value, decimals) {
  const amount = BigInt(value);
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = String(amount % scale).padStart(decimals, '0').slice(0, 2).replace(/0+$/, '');
  const display = Number(whole).toLocaleString('en-US');
  return `${display}${fraction ? `.${fraction}` : ''} $RARE`;
}

function renderRareTransfers(transfers, newBuyHash = null) {
  if (!rareTransferTrack) return;
  const rows = transfers.map((transfer) => {
    const link = document.createElement('a');
    link.className = 'ticker-item rare-transfer-item';
    if (transfer.side === 'buy') link.classList.add('is-rare-buy');
    if (transfer.side === 'sell') link.classList.add('is-rare-sell');
    if (transfer.hash === newBuyHash && transfer.side === 'buy') link.classList.add('is-new-rare-buy');
    link.href = transfer.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const icon = document.createElement('span');
    icon.className = 'rare-token-icon';
    const logo = document.createElement('img');
    logo.src = rareTokenLogo;
    logo.alt = '$RARE token logo';
    logo.loading = 'lazy';
    icon.append(logo);
    if (transfer.hash === newBuyHash && transfer.side === 'buy') {
      const buyBadge = document.createElement('em');
      buyBadge.textContent = 'BUY';
      icon.append(buyBadge);
    }
    const copy = document.createElement('span');
    const amount = document.createElement('strong');
    amount.textContent = formatRareTransfer(transfer.value, transfer.decimals);
    const route = document.createElement('small');
    route.textContent = `${transfer.fromLabel || shortWallet(transfer.from)} → ${transfer.toLabel || shortWallet(transfer.to)}`;
    const time = document.createElement('small');
    const sideLabel = transfer.side === 'buy' ? 'BUY · ' : transfer.side === 'sell' ? 'SELL · ' : '';
    time.textContent = `${sideLabel}${new Date(transfer.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    copy.append(amount, route, time);
    link.append(icon, copy);
    return link;
  });
  rareTransferTrack.replaceChildren(...rows);
}

function announceRareBuy() {
  if (!rareTransferTicker) return;
  rareTransferTicker.classList.remove('has-new-buy');
  void rareTransferTicker.offsetWidth;
  rareTransferTicker.classList.add('has-new-buy');
  clearTimeout(rareBuyTimer);
  rareBuyTimer = window.setTimeout(() => {
    rareTransferTicker.classList.remove('has-new-buy');
    rareTransferTrack.querySelectorAll('.is-new-rare-buy').forEach((item) => item.classList.remove('is-new-rare-buy'));
  }, 9000);
}

const formatGme = (value) => `${Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 4 })} GME`;
const compactNumber = (value) => Number(value || 0).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 });

async function refreshRareActivity() {
  if (!rareTransferTrack) return;
  try {
    const response = await fetch(`/api/rare-activity?t=${Math.floor(Date.now() / 10000)}`);
    if (!response.ok) throw new Error('Activity unavailable');
    const payload = await response.json();
    const newBuyHash = latestRareBuyHash && payload.latestBuyHash && payload.latestBuyHash !== latestRareBuyHash ? payload.latestBuyHash : null;
    renderRareTransfers(payload.transfers, newBuyHash);
    if (newBuyHash) announceRareBuy();
    latestRareBuyHash = payload.latestBuyHash || latestRareBuyHash;
    const gme = payload.gme;
    gmeDistributedElement.textContent = formatGme(gme.paidToHolders);
    gmeNextElement.textContent = formatGme(gme.nextRound);
    gmeRoundsElement.textContent = `${gme.roundsPaid} / ${gme.holderCount} holders`;
    gmeCreatorElement.textContent = formatGme(gme.creatorEarned);
    gmeMinElement.textContent = compactNumber(gme.minBalance);
    gmeSplitElement.textContent = `${gme.feeSplit.holders}/${gme.feeSplit.creator}/${gme.feeSplit.platform}`;
    rareActivityStatus.textContent = `Live · updated ${new Date(payload.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    rareActivityStatus.classList.add('is-live');
  } catch {
    rareActivityStatus.textContent = 'Live feed retrying…';
    rareActivityStatus.classList.remove('is-live');
  }
}

refreshRareMarket();
refreshRareActivity();
window.setInterval(() => {
  if (!document.hidden) {
    refreshRareMarket();
    refreshRareActivity();
  }
}, 20000);
