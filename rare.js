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
const goalMarker = document.querySelector('[data-goal-marker]');
const goalMarkerCap = document.querySelector('[data-goal-marker-cap]');
const athMarker = document.querySelector('[data-ath-marker]');
const athValue = document.querySelector('[data-ath-value]');
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
const tradeBubbleLayer = document.querySelector('[data-trade-bubbles]');
const tradeSoundButton = document.querySelector('[data-trade-sound]');
let latestRareBuyHash = null;
let rareBuyTimer = null;
let rareTradesInitialized = false;
let knownRareTradeHashes = new Set();
const savedTradeSound = (() => {
  try {
    return window.localStorage.getItem('rareTradeSound');
  } catch {
    return null;
  }
})();
let tradeSoundEnabled = savedTradeSound === 'on';
let tradeAudioContext = null;
const ATH_BASELINE = 70000;
let highestMarketCap = (() => {
  try {
    return Math.max(ATH_BASELINE, Number(window.localStorage.getItem('rareAthMarketCap')) || 0);
  } catch {
    return ATH_BASELINE;
  }
})();

const formatMarketCap = (value) => Number(value).toLocaleString('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function updateAthMarker(marketCap) {
  if (marketCap > highestMarketCap) {
    highestMarketCap = marketCap;
    try {
      window.localStorage.setItem('rareAthMarketCap', String(highestMarketCap));
    } catch {
      // The live marker still updates when browser storage is unavailable.
    }
  }
  const athProgress = Math.min(100, Math.max(0, (highestMarketCap / 1000000) * 100));
  athMarker.style.left = `clamp(34px, ${athProgress}%, calc(100% - 34px))`;
  athValue.textContent = formatMarketCap(highestMarketCap);
}

async function refreshRareMarket() {
  try {
    const response = await fetch('/api/rare-market', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('Market data unavailable');
    const market = await response.json();
    const progress = Math.min(100, Math.max(0, (market.marketCap / 1000000) * 100));
    const formattedMarketCap = formatMarketCap(market.marketCap);
    marketCapElement.textContent = formattedMarketCap;
    goalMarkerCap.textContent = formattedMarketCap;
    rareVolumeElement.textContent = formatMarketCap(market.volume24hUsd || 0);
    rareVolumeTradesElement.textContent = `${Number(market.buys24h || 0).toLocaleString('en-US')} buys · ${Number(market.sells24h || 0).toLocaleString('en-US')} sells`;
    marketStatusElement.textContent = `Live via DexScreener · ${market.liquidityUsd === null ? 'liquidity unavailable' : `${formatMarketCap(market.liquidityUsd)} liquidity`}`;
    goalFill.style.width = `${progress}%`;
    goalMarker.style.left = `clamp(34px, ${progress}%, calc(100% - 34px))`;
    updateAthMarker(market.marketCap);
  } catch {
    marketCapElement.textContent = 'Live data unavailable';
    goalMarkerCap.textContent = 'Unavailable';
    rareVolumeElement.textContent = 'Unavailable';
    rareVolumeTradesElement.textContent = 'DexScreener feed retrying';
    marketStatusElement.textContent = 'The milestone roadmap remains active';
    goalFill.style.width = '0%';
    goalMarker.style.left = '34px';
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

function renderRareTransfers(transfers, newBuyHash = null, newTradeHashes = new Set()) {
  if (!rareTransferTrack) return;
  const rows = transfers.map((transfer) => {
    const link = document.createElement('a');
    link.className = 'ticker-item rare-transfer-item';
    if (transfer.side === 'buy') link.classList.add('is-rare-buy');
    if (transfer.side === 'sell') link.classList.add('is-rare-sell');
    if (newTradeHashes.has(transfer.hash)) link.classList.add('is-new-trade-pop');
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

function unlockTradeAudio() {
  const AudioApi = window.AudioContext || window.webkitAudioContext;
  if (!AudioApi) return;
  if (!tradeAudioContext) tradeAudioContext = new AudioApi();
  if (tradeAudioContext.state === 'suspended') tradeAudioContext.resume();
}

function playTradePop(side, delay = 0) {
  if (!tradeSoundEnabled || !tradeAudioContext || tradeAudioContext.state !== 'running') return;
  window.setTimeout(() => {
    const now = tradeAudioContext.currentTime;
    const oscillator = tradeAudioContext.createOscillator();
    const gain = tradeAudioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(side === 'buy' ? 680 : 310, now);
    oscillator.frequency.exponentialRampToValueAtTime(side === 'buy' ? 420 : 190, now + .09);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(.045, now + .008);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .11);
    oscillator.connect(gain).connect(tradeAudioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + .12);
  }, delay);
}

function animateTradeBubbles(trades) {
  if (!tradeBubbleLayer || !trades.length) return;
  trades.forEach((trade, tradeIndex) => {
    playTradePop(trade.side, tradeIndex * 85);
    for (let index = 0; index < 3; index += 1) {
      const bubble = document.createElement('span');
      bubble.className = `trade-bubble is-${trade.side}`;
      bubble.style.setProperty('--bubble-x', `${8 + Math.random() * 84}%`);
      bubble.style.setProperty('--bubble-size', `${14 + Math.random() * 34}px`);
      bubble.style.setProperty('--bubble-drift', `${-35 + Math.random() * 70}px`);
      bubble.style.setProperty('--bubble-delay', `${tradeIndex * .07 + index * .06}s`);
      bubble.addEventListener('animationend', () => bubble.remove(), { once: true });
      tradeBubbleLayer.append(bubble);
    }
  });
}

function findNewTrades(transfers) {
  const uniqueTrades = [...new Map(transfers
    .filter((transfer) => transfer.side === 'buy' || transfer.side === 'sell')
    .map((transfer) => [transfer.hash, transfer])).values()];
  if (!rareTradesInitialized) {
    knownRareTradeHashes = new Set(uniqueTrades.map((trade) => trade.hash));
    rareTradesInitialized = true;
    return [];
  }
  const fresh = uniqueTrades.filter((trade) => !knownRareTradeHashes.has(trade.hash));
  knownRareTradeHashes = new Set(uniqueTrades.map((trade) => trade.hash));
  return fresh;
}

document.addEventListener('pointerdown', unlockTradeAudio, { once: true });
function updateTradeSoundButton() {
  if (!tradeSoundButton) return;
  tradeSoundButton.textContent = `Sound: ${tradeSoundEnabled ? 'on' : 'off'}`;
  tradeSoundButton.setAttribute('aria-pressed', String(tradeSoundEnabled));
  tradeSoundButton.classList.toggle('is-on', tradeSoundEnabled);
}

tradeSoundButton?.addEventListener('click', () => {
  unlockTradeAudio();
  tradeSoundEnabled = !tradeSoundEnabled;
  try {
    window.localStorage.setItem('rareTradeSound', tradeSoundEnabled ? 'on' : 'off');
  } catch {
    // The control still works for this visit when storage is unavailable.
  }
  updateTradeSoundButton();
  if (tradeSoundEnabled) playTradePop('buy');
});
updateTradeSoundButton();

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
    const newTrades = findNewTrades(payload.transfers);
    const newTradeHashes = new Set(newTrades.map((trade) => trade.hash));
    renderRareTransfers(payload.transfers, newBuyHash, newTradeHashes);
    animateTradeBubbles(newTrades);
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
