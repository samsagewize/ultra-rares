const requestForm = document.querySelector('[data-rare-request]');
const result = document.querySelector('[data-request-result]');
const walletInput = document.querySelector('#wallet-address');
const copyContractButton = document.querySelector('[data-copy-contract]');
const copyHoldersButton = document.querySelector('[data-copy-holders]');
const holderCopyStatus = document.querySelector('[data-holder-copy-status]');
const contractAddress = '0x1d522a4c3e1f3d97b585903474b2544cf9feeffb';
const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const marketCapElement = document.querySelector('[data-rare-market-cap]');
const marketStatusElement = document.querySelector('[data-rare-market-status]');
const goalFill = document.querySelector('[data-goal-fill]');

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
    marketStatusElement.textContent = `Live via DexScreener · ${market.liquidityUsd === null ? 'liquidity unavailable' : `${formatMarketCap(market.liquidityUsd)} liquidity`}`;
    goalFill.style.width = `${progress}%`;
  } catch {
    marketCapElement.textContent = 'Live data unavailable';
    marketStatusElement.textContent = 'The milestone roadmap remains active';
    goalFill.style.width = '0%';
  }
}

copyContractButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(contractAddress);
  copyContractButton.textContent = 'Copied!';
  window.setTimeout(() => { copyContractButton.textContent = 'Copy contract'; }, 1600);
});

copyHoldersButton.addEventListener('click', async () => {
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

requestForm.addEventListener('submit', async (event) => {
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
  submitButton.textContent = 'Checking holder…';
  result.textContent = 'Checking this wallet on Robinhood Chain…';

  try {
    const response = await fetch('/api/rare-request', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ wallet }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Request could not be submitted');

    result.innerHTML = '';
    const heading = document.createElement('strong');
    heading.textContent = 'Request received.';
    const details = document.createElement('span');
    details.textContent = ` ${payload.nftBalance} Ultra Rare${payload.nftBalance === 1 ? '' : 's'} verified · Request ${payload.requestId}`;
    result.append(heading, details);
    result.classList.add('is-success');
    requestForm.reset();
  } catch (error) {
    result.textContent = error.message;
    result.classList.add('is-error');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Request RARE ↗';
  }
});

refreshRareMarket();
window.setInterval(() => {
  if (!document.hidden) refreshRareMarket();
}, 60000);
