const ADMIN = '0x562f6ac10723ef6af9f077a83cf25135fb369612';
const NFT = '0x923aaaa62c12505b1bbb57ed52b730d6462c01c5';
const RARE = '0x1d522a4c3e1f3d97b585903474b2544cf9feeffb';
const CHAIN_ID = '0x1237';
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const TRANSFER_VALIDATOR = '0xa000027a9b2802e1ddf7000061001e5c005a0000';
const CREATED_LIST_TOPIC = '0x5cc365f89543268cb9f25c255f7f610e9147e733c589bc2732279575f125be14';
const controls = {
  connect: document.querySelector('[data-auction-admin-connect]'),
  deployVault: document.querySelector('[data-deploy-fee-vault]'),
  deployAuction: document.querySelector('[data-deploy-auction]'),
  authorize: document.querySelector('[data-authorize-auction]'),
  destinations: document.querySelector('[data-set-fee-destinations]'),
  lock: document.querySelector('[data-lock-fee-config]'),
  verify: document.querySelector('[data-verify-auction]'),
  transferPolicy: document.querySelector('[data-authorize-transfer-policy]'),
};
const status = document.querySelector('[data-auction-admin-status]');
const output = document.querySelector('[data-auction-output]');
let account = '';
let feeVault = localStorage.getItem('ultraRaresFeeVaultAddress') || '';
let auction = localStorage.getItem('ultraRaresAuctionAddress') || '';
let transferListId = localStorage.getItem('ultraRaresTransferListId') || '';
let feeArtifact;
let auctionArtifact;

const isAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(value);
const addressWord = (value) => value.toLowerCase().replace('0x', '').padStart(64, '0');
const word = (value) => BigInt(value).toString(16).padStart(64, '0');
const boolWord = (value) => (value ? '1' : '0').padStart(64, '0');
const setStatus = (message) => { status.textContent = message; };
const feeCall = (signature, args = []) => `0x${feeArtifact.methodIdentifiers[signature]}${args.join('')}`;
const auctionCall = (signature, args = []) => `0x${auctionArtifact.methodIdentifiers[signature]}${args.join('')}`;

async function switchNetwork() {
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID }] });
  } catch (error) {
    if (error.code !== 4902) throw error;
    await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: CHAIN_ID, chainName: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://rpc.mainnet.chain.robinhood.com/'], blockExplorerUrls: [EXPLORER] }] });
  }
}

async function waitForReceipt(hash) {
  for (;;) {
    const receipt = await window.ethereum.request({ method: 'eth_getTransactionReceipt', params: [hash] });
    if (receipt) {
      if (receipt.status !== '0x1') throw new Error('Transaction reverted. Nothing was configured.');
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
}

async function send(to, data, label) {
  setStatus(`${label}: review and confirm in your wallet…`);
  const hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: account, to, data, value: '0x0' }] });
  setStatus(`${label}: waiting for confirmation…`);
  const receipt = await waitForReceipt(hash);
  setStatus(`${label} confirmed · ${hash.slice(0, 10)}…`);
  return receipt;
}

async function deploy(bytecode, constructorArgs, label) {
  setStatus(`${label}: review the contract creation in your wallet…`);
  const hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: account, data: bytecode + constructorArgs, value: '0x0' }] });
  const receipt = await waitForReceipt(hash);
  if (!isAddress(receipt.contractAddress)) throw new Error(`${label} did not return a contract address.`);
  return receipt.contractAddress.toLowerCase();
}

async function requireCode(address, label) {
  const code = await window.ethereum.request({ method: 'eth_getCode', params: [address, 'latest'] });
  if (!code || code === '0x') throw new Error(`${label} has no deployed bytecode.`);
}

async function read(address, data) {
  return window.ethereum.request({ method: 'eth_call', params: [{ to: address, data }, 'latest'] });
}

const decodedAddress = (result) => `0x${result.slice(-40)}`.toLowerCase();

async function verifyContracts() {
  if (feeVault) {
    await requireCode(feeVault, 'Saved fee vault');
    const [token, owner] = await Promise.all([
      read(feeVault, feeCall('rareToken()')),
      read(feeVault, feeCall('owner()')),
    ]);
    if (decodedAddress(token) !== RARE || decodedAddress(owner) !== ADMIN) throw new Error('Saved fee vault does not match the official $RARE token and administrator.');
  }
  if (auction) {
    await requireCode(auction, 'Saved auction house');
    const [collection, token, configuredVault] = await Promise.all([
      read(auction, auctionCall('collection()')),
      read(auction, auctionCall('rareToken()')),
      read(auction, auctionCall('feeVault()')),
    ]);
    if (decodedAddress(collection) !== NFT || decodedAddress(token) !== RARE || decodedAddress(configuredVault) !== feeVault) {
      throw new Error('Saved auction house does not match the official NFT, $RARE, and fee-vault addresses.');
    }
  }
}

async function refreshConfiguration() {
  if (!feeVault) return;
  const [lockedResult, claimsResult, liquidityResult] = await Promise.all([
    read(feeVault, feeCall('configurationLocked()')),
    read(feeVault, feeCall('claimDestination()')),
    read(feeVault, feeCall('liquidityDestination()')),
  ]);
  const locked = BigInt(lockedResult) === 1n;
  const destinationsReady = decodedAddress(claimsResult) === ADMIN && decodedAddress(liquidityResult) === ADMIN;
  let sourceReady = false;
  if (auction) sourceReady = BigInt(await read(feeVault, feeCall('feeSources(address)', [addressWord(auction)]))) === 1n;
  controls.authorize.disabled = !auction || sourceReady || locked;
  controls.destinations.disabled = destinationsReady || locked;
  controls.lock.disabled = locked || !sourceReady || !destinationsReady;
  controls.verify.disabled = !auction;
  await refreshTransferPolicy();
}

async function refreshTransferPolicy() {
  if (!auction) { controls.transferPolicy.disabled = true; return false; }
  const data = `0x8e28800f${addressWord(NFT)}${addressWord(auction)}`;
  const result = await read(TRANSFER_VALIDATOR, data);
  const allowed = BigInt(result) === 1n;
  controls.transferPolicy.disabled = allowed;
  if (allowed) controls.transferPolicy.textContent = 'Auction allowed by NFT policy ✓';
  return allowed;
}

function encodeString(value) {
  const bytes = new TextEncoder().encode(value);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return word(bytes.length) + hex.padEnd(Math.ceil(bytes.length / 32) * 64, '0');
}

function showAddresses() {
  output.hidden = !(feeVault || auction);
  document.querySelector('[data-deployed-fee-vault]').textContent = feeVault || 'Not deployed';
  document.querySelector('[data-deployed-auction]').textContent = auction || 'Not deployed';
}

controls.connect.addEventListener('click', async () => {
  try {
    if (!window.ethereum) throw new Error('Open this page in Robinhood Wallet or another EVM wallet browser.');
    [feeArtifact, auctionArtifact] = await Promise.all([
      fetch('assets/RareFeeVault.json').then((response) => response.json()),
      fetch('assets/RareAuctionHouse.json').then((response) => response.json()),
    ]);
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    await switchNetwork();
    account = accounts[0]?.toLowerCase();
    if (account !== ADMIN) throw new Error('Connected wallet is not the configured administrator.');
    await verifyContracts();
    controls.connect.textContent = `Connected ${account.slice(0, 6)}…${account.slice(-4)}`;
    controls.deployVault.disabled = Boolean(feeVault);
    controls.deployAuction.disabled = !feeVault || Boolean(auction);
    await refreshConfiguration();
    showAddresses();
    setStatus('Administrator verified. Complete the enabled steps in order.');
  } catch (error) { setStatus(error.message || 'Wallet connection failed.'); }
});

controls.deployVault.addEventListener('click', async () => {
  try {
    feeVault = await deploy(feeArtifact.bytecode, addressWord(RARE) + addressWord(ADMIN), 'Deploy fee vault');
    localStorage.setItem('ultraRaresFeeVaultAddress', feeVault);
    controls.deployVault.disabled = true;
    controls.deployAuction.disabled = false;
    showAddresses();
    await verifyContracts();
    await refreshConfiguration();
  } catch (error) { setStatus(error.message || 'Fee-vault deployment failed or was cancelled.'); }
});

controls.deployAuction.addEventListener('click', async () => {
  try {
    auction = await deploy(auctionArtifact.bytecode, addressWord(NFT) + addressWord(RARE) + addressWord(feeVault), 'Deploy auction house');
    localStorage.setItem('ultraRaresAuctionAddress', auction);
    controls.deployAuction.disabled = true;
    showAddresses();
    await verifyContracts();
    await refreshConfiguration();
  } catch (error) { setStatus(error.message || 'Auction deployment failed or was cancelled.'); }
});

controls.authorize.addEventListener('click', async () => {
  try {
    await send(feeVault, feeCall('setFeeSource(address,bool)', [addressWord(auction), boolWord(true)]), 'Authorize auction');
    await refreshConfiguration();
  } catch (error) { setStatus(error.message || 'Auction authorization failed.'); }
});

controls.destinations.addEventListener('click', async () => {
  try {
    await send(feeVault, feeCall('setDestinations(address,address)', [addressWord(ADMIN), addressWord(ADMIN)]), 'Set fee destinations');
    await refreshConfiguration();
  } catch (error) { setStatus(error.message || 'Destination setup failed.'); }
});

controls.lock.addEventListener('click', async () => {
  if (!confirm('Permanently lock the administrator wallet as both fee destinations and the auction as a fee source?')) return;
  try {
    await send(feeVault, feeCall('lockConfiguration()'), 'Lock fee configuration');
    await refreshConfiguration();
  } catch (error) { setStatus(error.message || 'Configuration lock failed. Complete steps 4 and 5 first.'); }
});

controls.verify.addEventListener('click', async () => {
  try {
    await verifyContracts();
    const locked = await window.ethereum.request({ method: 'eth_call', params: [{ to: feeVault, data: feeCall('configurationLocked()') }, 'latest'] });
    const source = await window.ethereum.request({ method: 'eth_call', params: [{ to: feeVault, data: feeCall('feeSources(address)', [addressWord(auction)]) }, 'latest'] });
    if (BigInt(locked) !== 1n || BigInt(source) !== 1n) throw new Error('Deployment exists, but authorization or permanent lock is incomplete.');
    setStatus('Verified on-chain. Copy both addresses and provide them for public marketplace activation.');
  } catch (error) { setStatus(error.message || 'On-chain verification failed.'); }
});

controls.transferPolicy.addEventListener('click', async () => {
  controls.transferPolicy.disabled = true;
  try {
    if (!transferListId) {
      const name = encodeString('Ultra Rares + Auction');
      const receipt = await send(TRANSFER_VALIDATOR, `0xde02cbb1${word(64)}${word(0)}${name}`, 'Copy existing NFT transfer whitelist');
      const created = receipt.logs?.find((log) => log.address?.toLowerCase() === TRANSFER_VALIDATOR && log.topics?.[0]?.toLowerCase() === CREATED_LIST_TOPIC);
      if (!created?.topics?.[1]) throw new Error('The new transfer-list ID was not found in the receipt.');
      transferListId = BigInt(created.topics[1]).toString();
      localStorage.setItem('ultraRaresTransferListId', transferListId);
    }
    const addAuctionData = `0xa1cc5cc1${word(transferListId)}${word(64)}${word(1)}${addressWord(auction)}`;
    await send(TRANSFER_VALIDATOR, addAuctionData, 'Add auction to copied whitelist');
    const applyData = `0xbf7bfd7e${addressWord(NFT)}${word(transferListId)}`;
    await send(TRANSFER_VALIDATOR, applyData, 'Apply expanded whitelist to Ultra Rares');
    if (!await refreshTransferPolicy()) throw new Error('Transfer policy transactions confirmed, but the auction is not yet reported as allowed.');
    setStatus('Auction transfer permission verified. You can now create auctions without disabling collection protection.');
  } catch (error) {
    controls.transferPolicy.disabled = false;
    setStatus(error?.code === 4001 ? 'Transfer-policy update cancelled. Existing collection settings were preserved.' : (error.message || 'Transfer-policy update failed.'));
  }
});

document.querySelector('[data-copy-auction-config]').addEventListener('click', async () => {
  await navigator.clipboard.writeText(`Fee vault: ${feeVault}\nAuction house: ${auction}`);
  setStatus('Deployment addresses copied.');
});

showAddresses();
