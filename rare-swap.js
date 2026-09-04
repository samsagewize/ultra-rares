(() => {
  const root = document.querySelector('[data-rare-swap]');
  if (!root) return;

  const RARE_TOKEN = '0x1d522a4c3e1f3d97b585903474b2544cf9feeffb';
  const ROBINHOOD_CHAIN_ID = '0x1237';
  const SUSHI_SWAP_URL = `https://www.sushi.com/robinhood/swap?token0=${RARE_TOKEN}&token1=NATIVE`;
  const connectButton = root.querySelector('[data-swap-connect]');
  const amountInput = root.querySelector('[data-swap-amount]');
  const maxButton = root.querySelector('[data-swap-max]');
  const submitButton = root.querySelector('[data-swap-submit]');
  const output = root.querySelector('[data-swap-output]');
  const rareBalance = root.querySelector('[data-swap-rare-balance]');
  const ethBalance = root.querySelector('[data-swap-eth-balance]');
  const rate = root.querySelector('[data-swap-rate]');
  const liquidity = root.querySelector('[data-swap-liquidity]');
  const venue = root.querySelector('[data-swap-venue]');
  const status = root.querySelector('[data-swap-status]');
  const slippageButtons = [...root.querySelectorAll('[data-swap-slippage]')];

  let account = '';
  let rareBalanceRaw = 0n;
  let priceNative = 0;
  let selectedSlippage = 1;

  const shortAddress = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;
  const formatUsd = (value) => Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const formatUnits = (raw, decimals = 18, precision = 5) => {
    const negative = raw < 0n;
    const value = negative ? -raw : raw;
    const base = 10n ** BigInt(decimals);
    const whole = value / base;
    const fraction = (value % base).toString().padStart(decimals, '0').slice(0, precision).replace(/0+$/, '');
    return `${negative ? '-' : ''}${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}`;
  };

  function updateEstimate() {
    const amount = Number(amountInput.value);
    const valid = Number.isFinite(amount) && amount > 0 && priceNative > 0;
    const estimated = valid ? amount * priceNative : 0;
    output.textContent = `${estimated.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 10 })} ETH`;
    submitButton.disabled = !valid;
    submitButton.textContent = valid ? (account ? 'Review swap on Sushi ↗' : 'Connect wallet to continue') : 'Enter an amount';
    if (valid) status.textContent = `Indicative output before price impact · ${selectedSlippage}% preferred slippage`;
  }

  async function loadMarket() {
    try {
      const response = await fetch(`/api/rare-market?swap=${Date.now()}`);
      if (!response.ok) throw new Error('Quote unavailable');
      const market = await response.json();
      priceNative = Number(market.priceNative || 0);
      if (!priceNative) throw new Error('Quote unavailable');
      rate.textContent = `1 $RARE = ${priceNative.toLocaleString('en-US', { maximumFractionDigits: 12 })} ETH`;
      liquidity.textContent = formatUsd(market.liquidityUsd);
      venue.textContent = market.dexId === 'sushiswap' ? 'SushiSwap V3' : (market.dexId || 'Active DEX');
      status.textContent = 'Live DexScreener quote ready.';
      updateEstimate();
    } catch {
      status.textContent = 'Live quote unavailable. Retrying shortly…';
      rate.textContent = 'Unavailable';
    }
  }

  async function ensureRobinhoodChain() {
    const ethereum = window.ethereum;
    const current = await ethereum.request({ method: 'eth_chainId' });
    if (current.toLowerCase() === ROBINHOOD_CHAIN_ID) return;
    try {
      await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ROBINHOOD_CHAIN_ID }] });
    } catch (error) {
      if (error?.code !== 4902) throw error;
      await ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: ROBINHOOD_CHAIN_ID,
          chainName: 'Robinhood Chain',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'],
          blockExplorerUrls: ['https://robinhoodchain.blockscout.com'],
        }],
      });
    }
  }

  async function refreshBalances() {
    if (!account || !window.ethereum) return;
    const balanceOfData = `0x70a08231${account.slice(2).padStart(64, '0')}`;
    const [rareHex, ethHex] = await Promise.all([
      window.ethereum.request({ method: 'eth_call', params: [{ to: RARE_TOKEN, data: balanceOfData }, 'latest'] }),
      window.ethereum.request({ method: 'eth_getBalance', params: [account, 'latest'] }),
    ]);
    rareBalanceRaw = BigInt(rareHex);
    rareBalance.textContent = `${formatUnits(rareBalanceRaw, 18, 4)} $RARE`;
    ethBalance.textContent = `${formatUnits(BigInt(ethHex), 18, 6)} ETH`;
  }

  async function connectWallet() {
    if (!window.ethereum) {
      status.textContent = 'No browser wallet found. Open this page inside your wallet browser.';
      return false;
    }
    try {
      status.textContent = 'Waiting for wallet…';
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      account = accounts[0] || '';
      if (!account) throw new Error('No account selected');
      await ensureRobinhoodChain();
      connectButton.textContent = shortAddress(account);
      connectButton.classList.add('is-connected');
      await refreshBalances();
      status.textContent = 'Wallet connected on Robinhood Chain.';
      updateEstimate();
      return true;
    } catch (error) {
      status.textContent = error?.message || 'Wallet connection was cancelled.';
      return false;
    }
  }

  connectButton.addEventListener('click', connectWallet);
  amountInput.addEventListener('input', updateEstimate);
  maxButton.addEventListener('click', () => {
    if (!account) return void connectWallet();
    amountInput.value = formatUnits(rareBalanceRaw, 18, 8).replace(/,/g, '');
    updateEstimate();
  });
  slippageButtons.forEach((button) => button.addEventListener('click', () => {
    selectedSlippage = Number(button.dataset.swapSlippage);
    slippageButtons.forEach((candidate) => candidate.classList.toggle('is-active', candidate === button));
    updateEstimate();
  }));
  submitButton.addEventListener('click', async () => {
    if (!account && !(await connectWallet())) return;
    window.open(SUSHI_SWAP_URL, '_blank', 'noopener,noreferrer');
    status.textContent = 'Sushi opened with $RARE → ETH selected. Confirm the final quote there before signing.';
  });

  window.ethereum?.on?.('accountsChanged', (accounts) => {
    account = accounts[0] || '';
    connectButton.textContent = account ? shortAddress(account) : 'Connect wallet';
    if (account) refreshBalances().catch(() => {});
    updateEstimate();
  });
  window.ethereum?.on?.('chainChanged', () => {
    if (account) refreshBalances().catch(() => {});
  });

  loadMarket();
  window.setInterval(() => { if (!document.hidden) loadMarket(); }, 30000);
})();
