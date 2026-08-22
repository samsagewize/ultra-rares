(() => {
  'use strict';
  const CHAIN_ID = '0x1237';
  const RPC = 'https://rpc.mainnet.chain.robinhood.com/';
  const EXPLORER = 'https://robinhoodchain.blockscout.com';
  const FACTORY_START_BLOCK = 43472117;
  const TARGET = 29n * 10n ** 18n;
  const ONE = 10n ** 18n;
  const FACTORY_STORAGE = 'ultraRaresLaunchTokensV2';
  const PUBLISHED_LOGOS = { '0x2da461daa157b692404f6fa6da779b7f8bd81e22': 'assets/test-token.png' };
  const terminal = document.querySelector('[data-terminal]');
  const errorPanel = document.querySelector('[data-terminal-error]');
  const errorCopy = document.querySelector('[data-terminal-error-copy]');
  const connect = document.querySelector('[data-terminal-connect]');
  const form = document.querySelector('[data-terminal-trade-form]');
  const amountInput = document.querySelector('[data-trade-amount]');
  const quoteOutput = document.querySelector('[data-trade-quote]');
  const submit = document.querySelector('[data-trade-submit]');
  const tradeStatus = document.querySelector('[data-trade-status]');
  const token = new URLSearchParams(location.search).get('token') || '';
  let factory = '';
  let factoryArtifact;
  let tokenArtifact;
  let account = '';
  let mode = 'buy';
  let quotedOut = 0n;
  let quoteTimer = 0;
  let ethPriceUsd = 0;
  let tokenSymbol = '';
  let tokenBalance = 0n;
  let walletEthBalance = 0n;
  let graduated = false;
  let chartMode = 'candles';
  let latestActivity = [];
  let latestLaunch = null;

  const isAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(value);
  const short = (value) => `${value.slice(0, 6)}…${value.slice(-4)}`;
  const word = (value) => BigInt(value).toString(16).padStart(64, '0');
  const addressWord = (value) => value.toLowerCase().replace('0x', '').padStart(64, '0');
  const selector = (signature) => factoryArtifact.methodIdentifiers[signature];
  const setTradeStatus = (message, error = false) => { tradeStatus.textContent = message; tradeStatus.classList.toggle('is-error', error); };
  const rpc = async (method, params) => {
    const response = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }) });
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error.message || 'Robinhood Chain request failed.');
    return payload.result;
  };
  const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']);
  const decodeString = (value) => {
    const offset = Number(BigInt(`0x${value.slice(2, 66)}`)) * 2 + 2;
    const length = Number(BigInt(`0x${value.slice(offset, offset + 64)}`));
    const bytes = value.slice(offset + 64, offset + 64 + length * 2).match(/.{2}/g)?.map((hex) => parseInt(hex, 16)) || [];
    return new TextDecoder().decode(new Uint8Array(bytes));
  };
  const parseUnits = (value) => {
    if (!/^\d*(\.\d{0,18})?$/.test(value) || !value || value === '.') throw new Error('Enter a valid amount.');
    const [whole = '0', fraction = ''] = value.split('.');
    return BigInt(whole || '0') * ONE + BigInt((fraction + '0'.repeat(18)).slice(0, 18));
  };
  const formatUnits = (value, digits = 5) => {
    const amount = Number(value) / 1e18;
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(amount);
  };
  const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value < 1000 ? 2 : 0 }).format(value);
  const compactMoney = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(value);
  const savedLogo = () => {
    if (PUBLISHED_LOGOS[token.toLowerCase()]) return PUBLISHED_LOGOS[token.toLowerCase()];
    try { return JSON.parse(localStorage.getItem(FACTORY_STORAGE) || '[]').find((entry) => entry.address?.toLowerCase() === token.toLowerCase())?.logo; } catch { return null; }
  };

  async function switchNetwork() {
    try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID }] }); }
    catch (error) {
      if (error.code !== 4902) throw error;
      await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: CHAIN_ID, chainName: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [RPC], blockExplorerUrls: [EXPLORER] }] });
    }
  }

  async function waitForReceipt(hash) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const receipt = await window.ethereum.request({ method: 'eth_getTransactionReceipt', params: [hash] });
      if (receipt) {
        if (receipt.status !== '0x1') throw new Error('Transaction reverted on-chain.');
        return receipt;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error('Confirmation is taking longer than expected. Check your wallet activity.');
  }

  async function syncWallet() {
    if (!window.ethereum) return;
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    account = accounts[0]?.toLowerCase() || '';
    connect.textContent = account ? short(account) : 'Connect wallet';
    submit.textContent = account ? (mode === 'buy' ? `Buy $${tokenSymbol}` : `Sell $${tokenSymbol}`) : `Connect wallet to ${mode}`;
    await refreshBalances();
  }

  async function refreshBalances() {
    if (!account || !isAddress(token)) {
      document.querySelector('[data-trade-max]').textContent = '—';
      return;
    }
    const [ethRaw, tokenRaw] = await Promise.all([rpc('eth_getBalance', [account, 'latest']), call(token, `0x70a08231${addressWord(account)}`)]);
    walletEthBalance = BigInt(ethRaw);
    tokenBalance = BigInt(tokenRaw);
    document.querySelector('[data-trade-max]').textContent = mode === 'buy' ? `${formatUnits(walletEthBalance, 5)} ETH` : `${formatUnits(tokenBalance, 2)} ${tokenSymbol}`;
  }

  async function refreshQuote() {
    clearTimeout(quoteTimer);
    const raw = amountInput.value.trim();
    if (!raw) { quotedOut = 0n; quoteOutput.textContent = 'Enter an amount'; return; }
    try {
      const amount = parseUnits(raw);
      if (amount <= 0n) throw new Error('Amount must be greater than zero.');
      if (mode === 'buy') {
        const result = await call(factory, `0x${selector('quoteBuy(address,uint256)')}${addressWord(token)}${word(amount)}`);
        quotedOut = BigInt(`0x${result.slice(2, 66)}`);
        quoteOutput.textContent = `${formatUnits(quotedOut, 4)} ${tokenSymbol}`;
      } else {
        const result = await call(factory, `0x${selector('quoteSell(address,uint256)')}${addressWord(token)}${word(amount)}`);
        quotedOut = BigInt(`0x${result.slice(2, 66)}`);
        const reserveSufficient = BigInt(`0x${result.slice(130, 194)}`) === 1n;
        if (!reserveSufficient) throw new Error('The curve does not have enough ETH reserve for this sale.');
        quoteOutput.textContent = `${formatUnits(quotedOut, 7)} ETH`;
      }
    } catch (error) { quotedOut = 0n; quoteOutput.textContent = error.message || 'Quote unavailable'; }
  }

  async function loadActivity(launch) {
    const topic = '0xf7dd8a134438de4c59401760e24ef5c6cc9c74583b2b022085697f3021e59768';
    const tokenTopic = `0x${addressWord(token)}`;
    const logs = await rpc('eth_getLogs', [{ address: factory, fromBlock: `0x${FACTORY_START_BLOCK.toString(16)}`, toBlock: 'latest', topics: [topic, tokenTopic] }]);
    const activity = [];
    for (const log of logs.slice(-80)) {
      const isBuy = BigInt(log.topics[3]) === 1n;
      const ethAmount = BigInt(`0x${log.data.slice(2, 66)}`);
      const tokenAmount = BigInt(`0x${log.data.slice(66, 130)}`);
      activity.push({ isBuy, ethAmount, tokenAmount, trader: `0x${log.topics[2].slice(-40)}`, hash: log.transactionHash, block: Number(BigInt(log.blockNumber)) });
    }
    document.querySelector('[data-terminal-trade-count]').textContent = String(activity.length);
    const list = document.querySelector('[data-terminal-activity]');
    list.innerHTML = activity.length ? activity.slice().reverse().map((trade) => `<li class="${trade.isBuy ? 'is-buy' : 'is-sell'}"><b>${trade.isBuy ? 'BUY' : 'SELL'}</b><strong>${formatUnits(trade.tokenAmount, 2)} $${tokenSymbol}</strong><span>${formatUnits(trade.ethAmount, 6)} ETH · ${short(trade.trader)}</span><a href="${EXPLORER}/tx/${trade.hash}" target="_blank" rel="noopener">Block ${trade.block.toLocaleString()} ↗</a></li>`).join('') : '<li>Waiting for the first confirmed trade.</li>';
    latestActivity = activity;
    latestLaunch = launch;
    drawChart(activity, launch);
  }

  function drawChart(activity, launch) {
    const empty = document.querySelector('[data-chart-empty]');
    const line = document.querySelector('[data-chart-line]');
    const area = document.querySelector('[data-chart-area]');
    const candles = document.querySelector('[data-chart-candles]');
    const marketAxis = document.querySelector('[data-chart-market-axis]');
    if (!activity.length) { empty.hidden = false; line.setAttribute('d', ''); area.setAttribute('d', ''); candles.replaceChildren(); marketAxis.replaceChildren(); return; }
    empty.hidden = true;
    let virtualEth = ONE;
    let virtualToken = 1_000_000_000n * ONE;
    const points = [{ x: 0, value: Number(virtualEth) / Number(virtualToken) }];
    activity.forEach((trade, index) => {
      if (trade.isBuy) {
        const fee = trade.ethAmount / 100n;
        virtualEth += trade.ethAmount - fee;
        virtualToken -= trade.tokenAmount;
      } else {
        const gross = trade.ethAmount * 10_000n / 9_900n;
        virtualEth -= gross;
        virtualToken += trade.tokenAmount;
      }
      points.push({ x: index + 1, value: Number(virtualEth) / Number(virtualToken) });
    });
    const values = points.map((point) => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || max || 1;
    const graphWidth = 790;
    const coords = points.map((point, index) => `${index / Math.max(1, points.length - 1) * graphWidth},${320 - ((point.value - min) / range) * 270}`).join(' L');
    line.setAttribute('d', `M${coords}`);
    area.setAttribute('d', `M${coords} L${graphWidth},340 L0,340 Z`);
    const candleWidth = Math.max(4, Math.min(28, 720 / activity.length));
    const y = (value) => 320 - ((value - min) / range) * 270;
    candles.replaceChildren(...activity.map((trade, index) => {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', trade.isBuy ? 'chart-candle is-buy' : 'chart-candle is-sell');
      const x = (index + .5) / activity.length * graphWidth;
      const openY = y(points[index].value);
      const closeY = y(points[index + 1].value);
      const wick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      wick.setAttribute('x1', x); wick.setAttribute('x2', x); wick.setAttribute('y1', Math.min(openY, closeY) - 5); wick.setAttribute('y2', Math.max(openY, closeY) + 5);
      const body = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      body.setAttribute('x', x - candleWidth / 2); body.setAttribute('y', Math.min(openY, closeY)); body.setAttribute('width', candleWidth); body.setAttribute('height', Math.max(5, Math.abs(closeY - openY)));
      group.append(wick, body);
      return group;
    }));
    const showCandles = chartMode === 'candles';
    candles.style.display = showCandles ? '' : 'none';
    line.style.display = showCandles ? 'none' : '';
    area.style.display = showCandles ? 'none' : '';
    const axisValues = Array.from({ length: 5 }, (_, index) => max - range * index / 4);
    marketAxis.innerHTML = '<strong>Market cap</strong>' + axisValues.map((price, index) => {
      const marketCapEth = price * 1_000_000_000;
      const label = ethPriceUsd > 0 ? compactMoney(marketCapEth * ethPriceUsd) : `${marketCapEth.toFixed(3)} ETH`;
      return `<i style="top:${50 + index * 67.5}px"><span>${label}</span></i>`;
    }).join('');
  }

  async function refreshMarket() {
    const raw = await call(factory, `0x${selector('launches(address)')}${addressWord(token)}`);
    const fields = [];
    for (let i = 0; i < 7; i += 1) fields.push(BigInt(`0x${raw.slice(2 + i * 64, 66 + i * 64)}`));
    const launch = { creator: `0x${raw.slice(26, 66)}`, virtualEth: fields[1], virtualToken: fields[2], realEth: fields[3], graduated: fields[6] === 1n };
    if (launch.creator === '0x0000000000000000000000000000000000000000') throw new Error('This token was not created by the verified launch factory.');
    graduated = launch.graduated;
    const marketCapEth = launch.virtualEth * (1_000_000_000n * ONE) / launch.virtualToken;
    const marketCapUsd = Number(marketCapEth) / 1e18 * ethPriceUsd;
    const progress = Math.min(100, Number(marketCapEth) / Number(TARGET) * 100);
    document.querySelector('[data-terminal-market-cap]').textContent = ethPriceUsd ? money(marketCapUsd) : `${formatUnits(marketCapEth, 4)} ETH`;
    document.querySelector('[data-terminal-market-cap-stat]').textContent = ethPriceUsd ? money(marketCapUsd) : `${formatUnits(marketCapEth, 3)} ETH`;
    document.querySelector('[data-terminal-price]').textContent = `1 ${tokenSymbol} = ${formatUnits(launch.virtualEth * ONE / launch.virtualToken, 12)} ETH`;
    document.querySelector('[data-terminal-reserve]').textContent = `${formatUnits(launch.realEth, 6)} ETH`;
    document.querySelector('[data-terminal-progress-copy]').textContent = `${formatUnits(marketCapEth, 3)} / 29 ETH MC`;
    const progressNode = document.querySelector('[data-terminal-progress]');
    progressNode.setAttribute('aria-valuenow', String(Number(marketCapEth) / 1e18));
    progressNode.querySelector('i').style.width = `${progress}%`;
    document.querySelector('[data-terminal-status]').textContent = graduated ? 'Graduated to Uniswap' : 'Curve trading live';
    submit.disabled = graduated;
    if (graduated) setTradeStatus('Curve trading has ended. Trade this token through its locked Uniswap pool.');
    await loadActivity(launch);
  }

  function selectMode(nextMode) {
    mode = nextMode;
    document.querySelectorAll('[data-trade-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tradeTab === mode));
    document.querySelector('[data-trade-input-unit]').textContent = mode === 'buy' ? 'ETH' : tokenSymbol;
    document.querySelector('[data-trade-input-label]').textContent = mode === 'buy' ? 'You pay' : 'You sell';
    submit.textContent = account ? (mode === 'buy' ? `Buy $${tokenSymbol}` : `Sell $${tokenSymbol}`) : `Connect wallet to ${mode}`;
    amountInput.value = ''; quotedOut = 0n; quoteOutput.textContent = 'Enter an amount';
    refreshBalances().catch(() => {});
  }

  connect.addEventListener('click', async () => {
    if (!window.ethereum) { setTradeStatus('Open this page in an EVM wallet browser. Never enter a seed phrase here.', true); return; }
    try { await window.ethereum.request({ method: 'eth_requestAccounts' }); await switchNetwork(); await syncWallet(); setTradeStatus('Wallet connected. Quotes are read directly from Robinhood Chain.'); }
    catch (error) { setTradeStatus(error.code === 4001 ? 'Wallet connection cancelled.' : error.message, true); }
  });
  document.querySelectorAll('[data-trade-tab]').forEach((button) => button.addEventListener('click', () => selectMode(button.dataset.tradeTab)));
  document.querySelector('[data-terminal-copy-ca]').addEventListener('click', async (event) => {
    try {
      await navigator.clipboard.writeText(token);
      event.currentTarget.textContent = 'Copied ✓';
      setTimeout(() => { event.currentTarget.textContent = 'Copy CA'; }, 1800);
    } catch { setTradeStatus(`Copy this contract address: ${token}`, true); }
  });
  document.querySelectorAll('[data-chart-mode]').forEach((button) => button.addEventListener('click', () => {
    chartMode = button.dataset.chartMode;
    document.querySelectorAll('[data-chart-mode]').forEach((option) => option.classList.toggle('active', option === button));
    drawChart(latestActivity, latestLaunch);
  }));
  amountInput.addEventListener('input', () => { clearTimeout(quoteTimer); quoteTimer = setTimeout(refreshQuote, 250); });
  document.querySelector('[data-trade-max]').addEventListener('click', () => { amountInput.value = mode === 'buy' ? formatUnits(walletEthBalance * 95n / 100n, 18).replace(/,/g, '') : formatUnits(tokenBalance, 18).replace(/,/g, ''); refreshQuote(); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (graduated) return;
    if (!window.ethereum || !account) { connect.click(); return; }
    submit.disabled = true;
    try {
      await switchNetwork();
      const amount = parseUnits(amountInput.value.trim());
      await refreshQuote();
      if (quotedOut <= 0n) throw new Error('No valid quote is available.');
      const minOut = quotedOut * 99n / 100n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
      let hash;
      if (mode === 'buy') {
        const data = `0x${selector('buy(address,uint256,uint256)')}${addressWord(token)}${word(minOut)}${word(deadline)}`;
        setTradeStatus(`Confirm buying at least ${formatUnits(minOut, 4)} $${tokenSymbol}.`);
        hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: account, to: factory, data, value: `0x${amount.toString(16)}` }] });
      } else {
        const allowance = BigInt(await call(token, `0xdd62ed3e${addressWord(account)}${addressWord(factory)}`));
        if (allowance < amount) {
          setTradeStatus(`Approve exactly ${formatUnits(amount, 4)} $${tokenSymbol} for this sale.`);
          const approve = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: account, to: token, data: `0x095ea7b3${addressWord(factory)}${word(amount)}`, value: '0x0' }] });
          await waitForReceipt(approve);
        }
        const data = `0x${selector('sell(address,uint256,uint256,uint256)')}${addressWord(token)}${word(amount)}${word(minOut)}${word(deadline)}`;
        setTradeStatus(`Confirm selling for at least ${formatUnits(minOut, 7)} ETH.`);
        hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: account, to: factory, data, value: '0x0' }] });
      }
      await waitForReceipt(hash);
      setTradeStatus(`Trade confirmed. View transaction: ${short(hash)}`);
      amountInput.value = ''; quotedOut = 0n; quoteOutput.textContent = 'Enter an amount';
      await Promise.all([refreshMarket(), refreshBalances()]);
    } catch (error) { setTradeStatus(error.code === 4001 ? 'Transaction cancelled. Nothing changed.' : (error.message || 'Trade failed.'), true); }
    finally { submit.disabled = graduated; }
  });

  async function initialize() {
    if (!isAddress(token)) throw new Error('The token address is missing or invalid.');
    const [config, factoryJson, tokenJson, market] = await Promise.all([
      fetch('launch-config.json', { cache: 'no-store' }).then((response) => response.json()),
      fetch('assets/RareLaunchFactory.json').then((response) => response.json()),
      fetch('assets/RareLaunchToken.json').then((response) => response.json()),
      fetch('/api/rare-market', { cache: 'no-store' }).then((response) => response.ok ? response.json() : {}).catch(() => ({})),
    ]);
    factory = config.factoryAddress;
    factoryArtifact = factoryJson;
    tokenArtifact = tokenJson;
    if (!isAddress(factory) || !(await rpc('eth_getCode', [factory, 'latest']))?.startsWith('0x60')) throw new Error('The verified launch factory is unavailable.');
    const [nameRaw, symbolRaw] = await Promise.all([call(token, '0x06fdde03'), call(token, '0x95d89b41')]);
    const name = decodeString(nameRaw);
    tokenSymbol = decodeString(symbolRaw);
    ethPriceUsd = Number(market.ethPriceUsd) || 0;
    document.title = `${name} ($${tokenSymbol}) — Token Terminal`;
    document.querySelector('[data-terminal-name]').textContent = name;
    document.querySelector('[data-terminal-symbol]').textContent = `$${tokenSymbol} / ETH`;
    document.querySelector('[data-terminal-ca]').textContent = token;
    const logo = savedLogo();
    if (logo) document.querySelector('[data-terminal-logo]').src = logo;
    document.querySelector('[data-token-explorer]').href = `${EXPLORER}/address/${token}`;
    document.querySelector('[data-token-explorer]').textContent = `${short(token)} ↗`;
    document.querySelector('[data-factory-explorer]').href = `${EXPLORER}/address/${factory}`;
    document.querySelector('[data-factory-explorer]').textContent = `${short(factory)} ↗`;
    terminal.hidden = false;
    await syncWallet();
    selectMode('buy');
    await refreshMarket();
    window.setInterval(() => refreshMarket().catch(() => {}), 8000);
  }

  window.ethereum?.on?.('accountsChanged', syncWallet);
  initialize().catch((error) => { terminal.hidden = true; errorPanel.hidden = false; errorCopy.textContent = error.message || 'The token terminal could not be loaded.'; });
})();
