const ADMIN = '0x562f6ac10723ef6af9f077a83cf25135fb369612';
const NFT = '0x923aaaa62c12505b1bbb57ed52b730d6462c01c5';
const RARE = '0x1d522a4c3e1f3d97b585903474b2544cf9feeffb';
const CHAIN_ID = '0x1237';
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const connectButton = document.querySelector('[data-rename-admin-connect]');
const deployButton = document.querySelector('[data-deploy-rename]');
const verifyButton = document.querySelector('[data-verify-rename]');
const status = document.querySelector('[data-rename-admin-status]');
const output = document.querySelector('[data-rename-output]');
let account = '';
let artifact;
let registry = localStorage.getItem('ultraRaresRenameRegistryAddress') || '';

const isAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(value);
const addressWord = (value) => value.toLowerCase().replace('0x', '').padStart(64, '0');
const selector = (signature) => artifact.methodIdentifiers[signature];
const decodedAddress = (result) => `0x${result.slice(-40)}`.toLowerCase();
const setStatus = (message) => { status.textContent = message; };

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
      if (receipt.status !== '0x1') throw new Error('Transaction reverted. The registry was not deployed.');
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
}

async function read(signature) {
  return window.ethereum.request({ method: 'eth_call', params: [{ to: registry, data: `0x${selector(signature)}` }, 'latest'] });
}

async function verifyRegistry() {
  if (!isAddress(registry)) throw new Error('No valid rename registry address is saved.');
  const code = await window.ethereum.request({ method: 'eth_getCode', params: [registry, 'latest'] });
  if (!code || code === '0x') throw new Error('Saved address has no deployed contract code.');
  const [collection, token, admin, cost] = await Promise.all([read('collection()'), read('rareToken()'), read('admin()'), read('RENAME_COST()')]);
  if (decodedAddress(collection) !== NFT || decodedAddress(token) !== RARE || decodedAddress(admin) !== ADMIN || BigInt(cost) !== 30000n * 10n ** 18n) {
    throw new Error('Registry configuration does not match the official collection, $RARE, administrator, and rename cost.');
  }
  return true;
}

function showRegistry() {
  output.hidden = !registry;
  document.querySelector('[data-deployed-rename]').textContent = registry || 'Not deployed';
}

connectButton.addEventListener('click', async () => {
  connectButton.disabled = true;
  try {
    if (!window.ethereum) throw new Error('Open this page in Robinhood Wallet or another EVM wallet browser.');
    artifact = await fetch('assets/RareRenameRegistry.json').then((response) => response.json());
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    await switchNetwork();
    account = accounts[0]?.toLowerCase();
    if (account !== ADMIN) throw new Error('Connected wallet is not the configured administrator.');
    if (registry) await verifyRegistry();
    connectButton.textContent = `Connected ${account.slice(0, 6)}…${account.slice(-4)}`;
    deployButton.disabled = Boolean(registry);
    verifyButton.disabled = !registry;
    showRegistry();
    setStatus(registry ? 'Saved registry verified. Copy its address for public activation.' : 'Administrator verified. Review and deploy the registry.');
  } catch (error) {
    connectButton.disabled = false;
    setStatus(error.message || 'Wallet connection failed.');
  }
});

deployButton.addEventListener('click', async () => {
  deployButton.disabled = true;
  setStatus('Deploy rename registry: review the contract creation in your wallet…');
  try {
    const data = artifact.bytecode + addressWord(NFT) + addressWord(RARE) + addressWord(ADMIN);
    const hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: account, data, value: '0x0' }] });
    setStatus('Deployment submitted. Waiting for confirmation…');
    const receipt = await waitForReceipt(hash);
    if (!isAddress(receipt.contractAddress)) throw new Error('Deployment did not return a contract address.');
    registry = receipt.contractAddress.toLowerCase();
    localStorage.setItem('ultraRaresRenameRegistryAddress', registry);
    await verifyRegistry();
    verifyButton.disabled = false;
    showRegistry();
    setStatus('Rename registry deployed and verified. Copy the address for public activation.');
  } catch (error) {
    deployButton.disabled = false;
    setStatus(error?.code === 4001 ? 'Deployment cancelled. Nothing was deployed.' : (error.message || 'Deployment failed.'));
  }
});

verifyButton.addEventListener('click', async () => {
  try {
    await verifyRegistry();
    setStatus('Verified on-chain: official NFT, official $RARE, administrator, and 30,000 $RARE cost all match.');
  } catch (error) { setStatus(error.message || 'Verification failed.'); }
});

document.querySelector('[data-copy-rename]').addEventListener('click', async () => {
  if (!registry) return;
  await navigator.clipboard.writeText(registry);
  setStatus('Rename registry address copied.');
});

showRegistry();
