(() => {
  'use strict';
  const ADMIN = '0x562f6ac10723ef6af9f077a83cf25135fb369612';
  const RARE = '0x1d522a4c3e1f3d97b585903474b2544cf9feeffb';
  const VAULT = '0xcc8ebc12d8df4b23d7e4a93b31a330762c211b32';
  const CHAIN_ID = '0x1237';
  const EXPLORER = 'https://robinhoodchain.blockscout.com';
  const INITIAL_VIRTUAL_ETH = 10n ** 18n;
  const EXPECTED_LAUNCH_FEE = 250000n * 10n ** 18n;
  const connectButton = document.querySelector('[data-launch-factory-connect]');
  const deployButton = document.querySelector('[data-launch-factory-deploy]');
  const verifyButton = document.querySelector('[data-launch-factory-verify]');
  const status = document.querySelector('[data-launch-factory-status]');
  const output = document.querySelector('[data-launch-factory-output]');
  const addressOutput = document.querySelector('[data-launch-factory-address]');
  const explorerLink = document.querySelector('[data-launch-factory-explorer]');
  let account = '';
  let artifact;
  let factory = localStorage.getItem('rareEthLaunchFactoryAddressV2') || '';

  const isAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(value);
  const addressWord = (value) => value.toLowerCase().replace('0x', '').padStart(64, '0');
  const uintWord = (value) => BigInt(value).toString(16).padStart(64, '0');
  const addressResult = (value) => `0x${value.slice(-40)}`.toLowerCase();
  const selector = (signature) => artifact.methodIdentifiers[signature];
  const setStatus = (message) => { status.textContent = message; };

  async function switchNetwork() {
    try {
      await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID }] });
    } catch (error) {
      if (error.code !== 4902) throw error;
      await ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: CHAIN_ID, chainName: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://rpc.mainnet.chain.robinhood.com/'], blockExplorerUrls: [EXPLORER] }] });
    }
  }

  async function waitForReceipt(hash) {
    for (;;) {
      const receipt = await ethereum.request({ method: 'eth_getTransactionReceipt', params: [hash] });
      if (receipt) {
        if (receipt.status !== '0x1') throw new Error('Factory deployment reverted.');
        return receipt;
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
  }

  async function read(signature) {
    return ethereum.request({ method: 'eth_call', params: [{ to: factory, data: `0x${selector(signature)}` }, 'latest'] });
  }

  async function verify() {
    if (!isAddress(factory)) throw new Error('No valid Factory address is saved.');
    const code = await ethereum.request({ method: 'eth_getCode', params: [factory, 'latest'] });
    if (!code || code === '0x') throw new Error('No deployed contract exists at the saved Factory address.');
    const [version, rare, vault, admin, treasury, seed, fee, tradeFee, creatorShare, treasuryShare, supply, graduation, publicCreation] = await Promise.all([
      read('FACTORY_VERSION()'),
      read('rareToken()'), read('raresVault()'), read('launchAdmin()'), read('ethTreasury()'), read('initialVirtualEth()'),
      read('LAUNCH_FEE_RARE()'), read('TRADE_FEE_BPS()'), read('CREATOR_FEE_SHARE_BPS()'), read('TREASURY_FEE_SHARE_BPS()'),
      read('FIXED_TOKEN_SUPPLY()'), read('GRADUATION_ENABLED()'), read('publicCreationEnabled()'),
    ]);
    if (BigInt(version) !== 2n) throw new Error('This is not the zero-ETH token-creation Factory V2.');
    if (addressResult(rare) !== RARE || addressResult(vault) !== VAULT || addressResult(admin) !== ADMIN || addressResult(treasury) !== ADMIN) throw new Error('Factory addresses do not match the reviewed mainnet configuration.');
    if (BigInt(seed) !== INITIAL_VIRTUAL_ETH || BigInt(fee) !== EXPECTED_LAUNCH_FEE || BigInt(tradeFee) !== 100n || BigInt(creatorShare) !== 9700n || BigInt(treasuryShare) !== 300n || BigInt(supply) !== 1_000_000_000n * 10n ** 18n) throw new Error('Factory economic constants do not match the reviewed pilot.');
    if (BigInt(graduation) !== 0n || BigInt(publicCreation) !== 0n) throw new Error('Pilot safety state is not locked to admin-only creation with graduation disabled.');
    return true;
  }

  function show() {
    output.hidden = !factory;
    addressOutput.textContent = factory || 'Not deployed';
    explorerLink.href = factory ? `${EXPLORER}/address/${factory}?tab=contract` : '#';
  }

  connectButton.addEventListener('click', async () => {
    connectButton.disabled = true;
    try {
      if (!window.ethereum) throw new Error('Open this page inside an EVM wallet browser.');
      artifact = await fetch('assets/RareLaunchFactory.json').then((response) => response.json());
      const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
      await switchNetwork();
      account = accounts[0]?.toLowerCase();
      if (account !== ADMIN) throw new Error('Connected wallet is not the configured administrator.');
      if (factory) await verify();
      connectButton.textContent = `Connected ${account.slice(0, 6)}…${account.slice(-4)}`;
      deployButton.disabled = Boolean(factory);
      verifyButton.disabled = !factory;
      show();
      setStatus(factory ? 'Saved ETH Factory verified on-chain.' : 'Administrator verified. Review the immutable settings, then deploy once.');
    } catch (error) {
      connectButton.disabled = false;
      setStatus(error?.message || 'Wallet connection failed.');
    }
  });

  deployButton.addEventListener('click', async () => {
    deployButton.disabled = true;
    setStatus('Review the contract creation in your wallet. Deployment sends no ETH or $RARE.');
    try {
      const data = `${artifact.bytecode}${addressWord(RARE)}${addressWord(VAULT)}${addressWord(ADMIN)}${addressWord(ADMIN)}${uintWord(INITIAL_VIRTUAL_ETH)}`;
      const hash = await ethereum.request({ method: 'eth_sendTransaction', params: [{ from: account, data, value: '0x0' }] });
      setStatus('Factory deployment submitted. Waiting for confirmation…');
      const receipt = await waitForReceipt(hash);
      if (!isAddress(receipt.contractAddress)) throw new Error('No deployed Factory address was returned.');
      factory = receipt.contractAddress.toLowerCase();
      localStorage.setItem('rareEthLaunchFactoryAddressV2', factory);
      await verify();
      verifyButton.disabled = false;
      show();
      setStatus('ETH Factory deployed and immutable pilot settings verified. Copy the address so it can be source-published and connected publicly.');
    } catch (error) {
      deployButton.disabled = false;
      setStatus(error?.code === 4001 ? 'Deployment cancelled. Nothing was deployed.' : (error?.message || 'Deployment failed.'));
    }
  });

  verifyButton.addEventListener('click', async () => {
    try { await verify(); setStatus('Verified: official $RARE, Launch Vault, admin, treasury, fixed supply, ETH curve, 1% fee split and disabled graduation all match.'); }
    catch (error) { setStatus(error?.message || 'Verification failed.'); }
  });

  document.querySelector('[data-launch-factory-copy]').addEventListener('click', async () => {
    if (!factory) return;
    await navigator.clipboard.writeText(factory);
    setStatus('ETH Factory address copied.');
  });
  show();
})();
