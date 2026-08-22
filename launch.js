(() => {
  'use strict';
  const TEST_CHAIN_ID = '0xb626';
  const connect = document.querySelector('[data-launch-connect]');
  const form = document.querySelector('[data-launch-form]');
  const status = document.querySelector('[data-launch-status]');
  const logoInput = document.querySelector('[data-logo-input]');
  const logoPreview = document.querySelector('[data-logo-preview]');
  const tokenList = document.querySelector('[data-token-list]');
  const STORAGE_KEY = 'ultraRaresLaunchPreviewsV1';
  const DEFAULT_LOGO = 'assets/rare-token.png';
  let logoData = DEFAULT_LOGO;
  const liveRareCost = 250000;
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
    const supply = '1000000000';
    const openingBuy = String(data.get('openingBuy') || '0').replace(/,/g, '');
    if (!name || !symbol) return setStatus('Enter a valid token name and symbol.', true);
    if (!/^\d*(\.\d+)?$/.test(openingBuy) || Number(openingBuy) < 0) return setStatus('Enter a valid optional opening buy, or use 0 to skip it.', true);
    const tokens = readTokens();
    tokens.unshift({ name, symbol, supply, openingBuy, logo: logoData, status: 'Launch preview', createdAt: Date.now() });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens.slice(0, 12))); } catch { return setStatus('The logo is too large to save in this browser. Choose a smaller image.', true); }
    renderTokens();
    document.querySelector('.launch-directory')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setStatus(`${name} ($${symbol}) was added to your token list. Fixed launch fee: ${liveRareCost.toLocaleString()} $RARE sent directly to the Vault. Connect your wallet when the verified factory goes live.`);
    form.reset(); logoData = DEFAULT_LOGO; logoPreview.src = DEFAULT_LOGO;
  });
  window.ethereum?.on?.('accountsChanged', syncAccount);
  syncAccount().catch(() => {});
  renderTokens();
})();
