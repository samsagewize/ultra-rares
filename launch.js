(() => {
  'use strict';
  const TEST_CHAIN_ID = '0xb626';
  const connect = document.querySelector('[data-launch-connect]');
  const form = document.querySelector('[data-launch-form]');
  const status = document.querySelector('[data-launch-status]');
  let account = '';

  const short = (value) => `${value.slice(0, 6)}…${value.slice(-4)}`;
  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('is-error', error);
  };
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
    if (!account) return setStatus('Connect your public wallet before creating a launch preview.', true);
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const symbol = String(data.get('symbol') || '').trim().replace(/[^a-z0-9]/gi, '').toUpperCase();
    const supply = String(data.get('supply') || '').replace(/,/g, '');
    if (!name || !symbol || !/^\d+$/.test(supply) || BigInt(supply) <= 0n) return setStatus('Enter a valid name, symbol and whole-number fixed supply.', true);
    setStatus(`Preview ready: ${name} ($${symbol}), ${Number(supply).toLocaleString()} supply, paired with $RARE. On-chain launch is locked until the verified factory address is published.`);
  });
  window.ethereum?.on?.('accountsChanged', syncAccount);
  syncAccount().catch(() => {});
})();
