(() => {
  'use strict';
  const TEST_CHAIN_ID = '0xb626';
  const connect = document.querySelector('[data-launch-connect]');
  const form = document.querySelector('[data-launch-form]');
  const status = document.querySelector('[data-launch-status]');
  const cost = document.querySelector('[data-launch-cost]');
  const costSource = document.querySelector('[data-launch-cost-source]');
  const logoInput = document.querySelector('[data-logo-input]');
  const logoPreview = document.querySelector('[data-logo-preview]');
  const tokenList = document.querySelector('[data-token-list]');
  const STORAGE_KEY = 'ultraRaresLaunchPreviewsV1';
  const DEFAULT_LOGO = 'assets/rare-token.png';
  let logoData = DEFAULT_LOGO;
  let liveRareCost = null;
  let account = '';

  const short = (value) => `${value.slice(0, 6)}…${value.slice(-4)}`;
  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('is-error', error);
  };
  const safeText = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const readTokens = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
  };
  const renderTokens = () => {
    const created = readTokens();
    const tokens = [{ name: 'First Rare', symbol: 'FIRST', supply: '1000000000', logo: DEFAULT_LOGO, status: 'Pre-launch test', openingBuy: '0' }, ...created];
    tokenList.innerHTML = tokens.map((token) => `<article class="launch-directory-card"><img src="${safeText(token.logo || DEFAULT_LOGO)}" alt="" /><div><span>${safeText(token.status || 'Launch preview')}</span><h3>${safeText(token.name)}</h3><strong>$${safeText(token.symbol)}</strong><dl><div><dt>Pair</dt><dd>$${safeText(token.symbol)} / $RARE</dd></div><div><dt>Supply</dt><dd>${Number(token.supply).toLocaleString()}</dd></div><div><dt>Opening buy</dt><dd>${Number(token.openingBuy || 0).toLocaleString()} $RARE</dd></div><div><dt>Graduation</dt><dd>$70K MC</dd></div></dl></div></article>`).join('');
  };
  const loadRareQuote = async () => {
    try {
      const response = await fetch('https://api.dexscreener.com/latest/dex/pairs/robinhood/0x8ec9c76ed191fb03397637acee1ce928426beb80', { cache: 'no-store' });
      if (!response.ok) throw new Error('Quote unavailable');
      const payload = await response.json();
      const pair = payload.pair || payload.pairs?.[0];
      const rarePerEth = 1 / Number(pair?.priceNative);
      if (!Number.isFinite(rarePerEth) || rarePerEth <= 0) throw new Error('Invalid quote');
      liveRareCost = Math.ceil(rarePerEth * 0.001);
      cost.textContent = `${liveRareCost.toLocaleString()} $RARE`;
      costSource.textContent = `Approx. 0.001 ETH at the current RARE/WETH market quote · checked ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    } catch {
      liveRareCost = null;
      cost.textContent = 'Quote temporarily unavailable';
      costSource.textContent = 'The launch transaction stays unavailable until a fresh on-chain quote can be verified.';
    }
  };
  logoInput.addEventListener('change', () => {
    const file = logoInput.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { logoInput.value = ''; return setStatus('Choose a logo smaller than 2MB.', true); }
    const reader = new FileReader();
    reader.onload = () => { logoData = String(reader.result); logoPreview.src = logoData; };
    reader.readAsDataURL(file);
  });
  const syncAccount = async () => {
    if (!window.ethereum) return;
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    account = accounts[0] || '';
    connect.textContent = account ? short(account) : 'Connect wallet';
  };
  connect.addEventListener('click', async () => {
    if (!window.ethereum) return setStatus('Install or open a wallet that supports Robinhood Chain. Never enter a seed phrase here.', true);
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      account = accounts[0] || '';
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      connect.textContent = short(account);
      setStatus(chainId === TEST_CHAIN_ID ? 'Wallet connected. Test launch previews are enabled.' : 'Wallet connected. Switch to Robinhood testnet before any launch transaction.', chainId !== TEST_CHAIN_ID);
    } catch (error) { setStatus(error?.message || 'Wallet connection was cancelled.', true); }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const symbol = String(data.get('symbol') || '').trim().replace(/[^a-z0-9]/gi, '').toUpperCase();
    const supply = String(data.get('supply') || '').replace(/,/g, '');
    const openingBuy = String(data.get('openingBuy') || '0').replace(/,/g, '');
    if (!name || !symbol || !/^\d+$/.test(supply) || BigInt(supply) <= 0n) return setStatus('Enter a valid name, symbol and whole-number fixed supply.', true);
    if (!/^\d*(\.\d+)?$/.test(openingBuy) || Number(openingBuy) < 0) return setStatus('Enter a valid optional opening buy, or use 0 to skip it.', true);
    const tokens = readTokens();
    tokens.unshift({ name, symbol, supply, openingBuy, logo: logoData, status: 'Launch preview', createdAt: Date.now() });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens.slice(0, 12))); } catch { return setStatus('The logo is too large to save in this browser. Choose a smaller image.', true); }
    renderTokens();
    document.querySelector('.launch-directory')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setStatus(`${name} ($${symbol}) was added to your token list. ${liveRareCost ? `Current launch fee: ${liveRareCost.toLocaleString()} $RARE.` : 'A fresh launch-fee quote is still required.'} Connect your wallet when the verified factory goes live.`);
    form.reset(); logoData = DEFAULT_LOGO; logoPreview.src = DEFAULT_LOGO;
  });
  window.ethereum?.on?.('accountsChanged', syncAccount);
  syncAccount().catch(() => {});
  renderTokens();
  loadRareQuote();
  setInterval(loadRareQuote, 30000);
})();
