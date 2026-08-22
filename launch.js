(() => {
  'use strict';
  const MAINNET_CHAIN_ID = '0x1237';
  const ADMIN = '0x562f6ac10723ef6af9f077a83cf25135fb369612';
  const RARE = '0x1d522a4c3e1f3d97b585903474b2544cf9feeffb';
  const EXPLORER = 'https://robinhoodchain.blockscout.com';
  const RPC = 'https://rpc.mainnet.chain.robinhood.com/';
  const connect = document.querySelector('[data-launch-connect]');
  const form = document.querySelector('[data-launch-form]');
  const submit = document.querySelector('[data-launch-submit]');
  const status = document.querySelector('[data-launch-status]');
  const logoInput = document.querySelector('[data-logo-input]');
  const logoPreview = document.querySelector('[data-logo-preview]');
  const tokenList = document.querySelector('[data-token-list]');
  const STORAGE_KEY = 'ultraRaresLaunchTokensV2';
  const DEFAULT_LOGO = 'assets/rare-token.png';
  const LAUNCH_FEE = 250000n * 10n ** 18n;
  const INITIAL_VIRTUAL_ETH = 10n ** 18n;
  const GRADUATION_MARKET_CAP_ETH = 29n * 10n ** 18n;
  const FIXED_SUPPLY = 1_000_000_000n * 10n ** 18n;
  const GRADUATION_TARGET_ETH = 29;
  let logoData = DEFAULT_LOGO;
  let account = '';
  let config = { factoryAddress: '', pilotMode: true };
  let artifact;

  const short = (value) => `${value.slice(0, 6)}…${value.slice(-4)}`;
  const isAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(value);
  const safeText = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const word = (value) => BigInt(value).toString(16).padStart(64, '0');
  const addressWord = (value) => value.toLowerCase().replace('0x', '').padStart(64, '0');
  const selector = (signature) => artifact.methodIdentifiers[signature];
  const addressResult = (value) => `0x${value.slice(-40)}`.toLowerCase();
  const decodeString = (value) => {
    const offset = Number(BigInt(`0x${value.slice(2, 66)}`)) * 2 + 2;
    const length = Number(BigInt(`0x${value.slice(offset, offset + 64)}`));
    const bytes = value.slice(offset + 64, offset + 64 + length * 2).match(/.{2}/g)?.map((hex) => parseInt(hex, 16)) || [];
    return new TextDecoder().decode(new Uint8Array(bytes));
  };
  const setStatus = (message, error = false) => { status.textContent = message; status.classList.toggle('is-error', error); };
  const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value < 1000 ? 2 : 0 }).format(value);

  function encodeString(value) {
    const bytes = new TextEncoder().encode(value);
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${word(bytes.length)}${hex.padEnd(Math.ceil(bytes.length / 32) * 64, '0')}`;
  }

  function encodeCreate(name, symbol) {
    const nameTail = encodeString(name);
    const symbolTail = encodeString(symbol);
    const headBytes = 3n * 32n;
    const symbolOffset = headBytes + BigInt(nameTail.length / 2);
    return `0x${selector('createToken(string,string,uint256)')}${word(headBytes)}${word(symbolOffset)}${word(LAUNCH_FEE)}${nameTail}${symbolTail}`;
  }

  async function rpc(method, params) {
    const response = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error.message || 'Robinhood Chain request failed.');
    return payload.result;
  }

  async function verifyFactory() {
    const call = (signature) => rpc('eth_call', [{ to: config.factoryAddress, data: `0x${selector(signature)}` }, 'latest']);
    const [version, rare, vault, admin, treasury, seed, target, launchFee, tradeFee, creatorShare, treasuryShare, supply, graduation, publicCreation, migrator] = await Promise.all([
      call('FACTORY_VERSION()'),
      call('rareToken()'), call('raresVault()'), call('launchAdmin()'), call('ethTreasury()'), call('initialVirtualEth()'),
      call('graduationMarketCapEth()'), call('LAUNCH_FEE_RARE()'), call('TRADE_FEE_BPS()'), call('CREATOR_FEE_SHARE_BPS()'), call('TREASURY_FEE_SHARE_BPS()'),
      call('FIXED_TOKEN_SUPPLY()'), call('GRADUATION_ENABLED()'), call('PUBLIC_CREATION_ENABLED()'),
      call('graduationMigrator()'),
    ]);
    if (BigInt(version) !== 4n) throw new Error('The configured Factory is not the locked-liquidity Factory V4.');
    if (addressResult(rare) !== RARE || addressResult(vault) !== '0xcc8ebc12d8df4b23d7e4a93b31a330762c211b32' || addressResult(admin) !== ADMIN || addressResult(treasury) !== ADMIN) throw new Error('The configured Factory addresses do not match the reviewed pilot.');
    if (BigInt(seed) !== INITIAL_VIRTUAL_ETH || BigInt(target) !== GRADUATION_MARKET_CAP_ETH || BigInt(launchFee) !== LAUNCH_FEE || BigInt(tradeFee) !== 100n || BigInt(creatorShare) !== 9700n || BigInt(treasuryShare) !== 300n || BigInt(supply) !== FIXED_SUPPLY) throw new Error('The configured Factory economics do not match V4.');
    if (BigInt(graduation) !== 1n || BigInt(publicCreation) !== 0n || !isAddress(addressResult(migrator))) throw new Error('The Factory is not the reviewed admin-only, locked-graduation V4.');
  }

  async function walletCall(to, data) {
    return window.ethereum.request({ method: 'eth_call', params: [{ to, data }, 'latest'] });
  }

  async function waitForReceipt(hash) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const receipt = await window.ethereum.request({ method: 'eth_getTransactionReceipt', params: [hash] });
      if (receipt) {
        if (receipt.status !== '0x1') throw new Error('The transaction reverted. Nothing was launched.');
        return receipt;
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    throw new Error('Confirmation is taking longer than expected. Check the transaction in your wallet.');
  }

  async function switchNetwork() {
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: MAINNET_CHAIN_ID }] });
    } catch (error) {
      if (error.code !== 4902) throw error;
      await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: MAINNET_CHAIN_ID, chainName: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [RPC], blockExplorerUrls: [EXPLORER] }] });
    }
  }

  const readTokens = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; } };
  const saveToken = (token) => {
    const tokens = readTokens().filter((entry) => entry.address?.toLowerCase() !== token.address?.toLowerCase());
    tokens.unshift(token);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens.slice(0, 20)));
  };

  async function syncFactoryTokens() {
    if (!isAddress(config.factoryAddress)) return;
    const saved = readTokens();
    const savedByAddress = new Map(saved.map((token) => [token.address?.toLowerCase(), token]));
    const count = Number(BigInt(await rpc('eth_call', [{ to: config.factoryAddress, data: `0x${selector('tokenCount()')}` }, 'latest'])));
    const discovered = [];
    for (let index = count - 1; index >= 0; index -= 1) {
      const rawAddress = await rpc('eth_call', [{ to: config.factoryAddress, data: `0x${selector('allTokens(uint256)')}${word(index)}` }, 'latest']);
      const address = addressResult(rawAddress);
      const existing = savedByAddress.get(address) || {};
      const [nameRaw, symbolRaw] = await Promise.all([
        rpc('eth_call', [{ to: address, data: '0x06fdde03' }, 'latest']),
        rpc('eth_call', [{ to: address, data: '0x95d89b41' }, 'latest']),
      ]);
      discovered.push({ ...existing, address, name: decodeString(nameRaw), symbol: decodeString(symbolRaw), supply: '1000000000', logo: existing.logo || DEFAULT_LOGO, status: 'Live on Robinhood Chain' });
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(discovered));
  }

  function renderTokens() {
    const tokens = readTokens();
    tokenList.innerHTML = tokens.length ? tokens.map((token) => `<article class="launch-directory-card" data-launch-token="${safeText(token.address)}" data-terminal-href="launch-token.html?token=${safeText(token.address)}" tabindex="0" role="link"><img src="${safeText(token.logo || DEFAULT_LOGO)}" alt="" /><div><span>${safeText(token.status || 'Live on Robinhood Chain')}</span><h3>${safeText(token.name)}</h3><strong>$${safeText(token.symbol)}</strong><dl><div><dt>Pair</dt><dd>$${safeText(token.symbol)} / ETH</dd></div><div><dt>Supply</dt><dd>1,000,000,000</dd></div><div><dt>Market cap</dt><dd data-token-mc>Loading…</dd></div><div><dt>Contract</dt><dd><a href="${EXPLORER}/address/${safeText(token.address)}" target="_blank" rel="noopener">${safeText(short(token.address))} ↗</a></dd></div></dl><div class="launch-card-progress"><div><span>Road to DEX</span><strong data-token-progress>$0 / $70K</strong></div><div class="launch-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="70000" aria-valuenow="0" data-token-track><i data-token-fill></i></div><small>Live target · migration safety-locked</small></div><a class="launch-terminal-link" href="launch-token.html?token=${safeText(token.address)}">Open trading terminal ↗</a></div></article>`).join('') : '<article class="launch-directory-card"><div><span>Waiting</span><h3>NO TOKENS LAUNCHED YET</h3><strong>The first confirmed launch will appear here.</strong></div></article>';
    tokenList.querySelectorAll('[data-terminal-href]').forEach((card) => {
      card.addEventListener('click', (event) => { if (!event.target.closest('a')) location.href = card.dataset.terminalHref; });
      card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); location.href = card.dataset.terminalHref; } });
    });
  }

  async function refreshGraduationProgress() {
    const cards = [...document.querySelectorAll('[data-launch-token]')];
    if (!cards.length || !isAddress(config.factoryAddress)) return;
    let ethPriceUsd = null;
    try {
      const market = await fetch('/api/rare-market', { cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject());
      ethPriceUsd = Number(market.ethPriceUsd);
    } catch {}
    if (!Number.isFinite(ethPriceUsd) || ethPriceUsd <= 0) return;
    const targetUsd = GRADUATION_TARGET_ETH * ethPriceUsd;
    await Promise.allSettled(cards.map(async (card, index) => {
      const address = card.dataset.launchToken;
      if (!isAddress(address)) return;
      const result = await rpc('eth_call', [{ to: config.factoryAddress, data: `0x${selector('marketCapEth(address)')}${addressWord(address)}` }, 'latest']);
      const marketCapUsd = Number(BigInt(result)) / 1e18 * ethPriceUsd;
      const percentage = Math.max(0, Math.min(100, marketCapUsd / targetUsd * 100));
      card.querySelector('[data-token-mc]').textContent = money(marketCapUsd);
      card.querySelector('[data-token-progress]').textContent = `${money(marketCapUsd)} / ${money(targetUsd)}`;
      card.querySelector('[data-token-fill]').style.width = `${percentage}%`;
      card.querySelector('[data-token-track]').setAttribute('aria-valuemax', String(Math.round(targetUsd)));
      card.querySelector('[data-token-track]').setAttribute('aria-valuenow', String(Math.round(marketCapUsd)));
      if (index === 0) {
        document.querySelector('[data-first-mc]').textContent = `${money(marketCapUsd)} / ${money(targetUsd)}`;
        document.querySelector('[data-first-track]').setAttribute('aria-valuemax', String(Math.round(targetUsd)));
        document.querySelector('[data-first-fill]').style.width = `${percentage}%`;
        document.querySelector('[data-first-track]').setAttribute('aria-valuenow', String(Math.round(marketCapUsd)));
        document.querySelector('[data-first-status]').textContent = percentage >= 100 ? 'Target reached · migration locked' : 'Trading · progress live';
      }
    }));
  }

  logoInput.addEventListener('change', () => {
    const file = logoInput.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { logoInput.value = ''; setStatus('Choose a logo smaller than 2MB.', true); return; }
    const reader = new FileReader();
    reader.onload = () => { logoData = String(reader.result); logoPreview.src = logoData; };
    reader.readAsDataURL(file);
  });

  async function syncAccount() {
    if (!window.ethereum) return;
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    account = accounts[0]?.toLowerCase() || '';
    connect.textContent = account ? short(account) : 'Connect wallet';
  }

  connect.addEventListener('click', async () => {
    if (!window.ethereum) { setStatus('Install or open an EVM wallet. Never enter a seed phrase into this website.', true); return; }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      await switchNetwork();
      account = accounts[0]?.toLowerCase() || '';
      connect.textContent = short(account);
      if (!isAddress(config.factoryAddress)) setStatus('Wallet connected. The verified ETH Factory address has not been published yet.', true);
      else if (config.pilotMode && account !== ADMIN) setStatus('Wallet connected. The pilot allows public trading, but only the administrator can create the first token.', true);
      else setStatus('Wallet connected to Robinhood Chain mainnet. Review the launch details before signing.');
    } catch (error) { setStatus(error?.message || 'Wallet connection was cancelled.', true); }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const symbol = String(data.get('symbol') || '').trim().replace(/[^a-z0-9]/gi, '').toUpperCase();
    if (!name || name.length > 32 || !symbol || symbol.length > 10) { setStatus('Enter a token name and an uppercase symbol of no more than 10 characters.', true); return; }
    if (!isAddress(config.factoryAddress)) { setStatus('The Factory is not connected yet. This form cannot send a launch transaction.', true); return; }
    if (!window.ethereum || !account) { setStatus('Connect the administrator wallet first.', true); return; }
    if (config.pilotMode && account !== ADMIN) { setStatus('Only the administrator can create the first pilot token.', true); return; }
    submit.disabled = true;
    try {
      await switchNetwork();
      const allowanceData = `0xdd62ed3e${addressWord(account)}${addressWord(config.factoryAddress)}`;
      const allowance = BigInt(await walletCall(RARE, allowanceData));
      if (allowance < LAUNCH_FEE) {
        setStatus('Step 1 of 2: approve exactly 250,000 $RARE for this launch.');
        const approveHash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: account, to: RARE, data: `0x095ea7b3${addressWord(config.factoryAddress)}${word(LAUNCH_FEE)}`, value: '0x0' }] });
        await waitForReceipt(approveHash);
      }
      const countData = `0x${selector('tokenCount()')}`;
      const countBefore = BigInt(await walletCall(config.factoryAddress, countData));
      setStatus('Step 2 of 2: create the token with 0 ETH attached. Only network gas should appear in your wallet.');
      const createHash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: account, to: config.factoryAddress, data: encodeCreate(name, symbol), value: '0x0' }] });
      await waitForReceipt(createHash);
      const tokenResult = await walletCall(config.factoryAddress, `0x${selector('allTokens(uint256)')}${word(countBefore)}`);
      const tokenAddress = `0x${tokenResult.slice(-40)}`;
      saveToken({ name, symbol, supply: '1000000000', logo: logoData, status: 'Live on Robinhood Chain', address: tokenAddress, transaction: createHash, createdAt: Date.now() });
      renderTokens();
      await refreshGraduationProgress();
      document.querySelector('.launch-directory')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setStatus(`${name} ($${symbol}) is live at ${short(tokenAddress)}. The transaction and token contract are linked below.`);
      form.reset(); logoData = DEFAULT_LOGO; logoPreview.src = DEFAULT_LOGO;
    } catch (error) {
      setStatus(error?.code === 4001 ? 'Signature cancelled. No token was launched.' : (error?.message || 'Launch failed.'), true);
    } finally { submit.disabled = false; }
  });

  async function initialize() {
    [config, artifact] = await Promise.all([fetch('launch-config.json', { cache: 'no-store' }).then((response) => response.json()), fetch('assets/RareLaunchFactory.json').then((response) => response.json())]);
    if (isAddress(config.factoryAddress)) {
      try {
        const code = await rpc('eth_getCode', [config.factoryAddress, 'latest']);
        if (!code || code === '0x') throw new Error('Configured Factory address has no mainnet contract code.');
        await verifyFactory();
      } catch (error) {
        config.factoryAddress = '';
        throw error;
      }
    }
    await syncAccount();
    await syncFactoryTokens();
    renderTokens();
    await refreshGraduationProgress();
    window.setInterval(refreshGraduationProgress, 30_000);
  }

  window.ethereum?.on?.('accountsChanged', syncAccount);
  initialize().catch((error) => { renderTokens(); setStatus(error?.message || 'Launchpad configuration could not be loaded.', true); });
})();
