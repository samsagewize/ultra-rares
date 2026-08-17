const ADMIN = '0x562f6ac10723ef6af9f077a83cf25135fb369612';
const NFT = '0x923aaaa62c12505b1bbb57ed52b730d6462c01c5';
const RARE = '0x1d522a4c3e1f3d97b585903474b2544cf9feeffb';
const CHAIN_ID = '0x1237';
const REWARD = 65933n * 10n ** 18n;
const INVENTORY = REWARD * 420n;
const EXPLORER = 'https://robinhoodchain.blockscout.com';

const buttons = {
  connect: document.querySelector('[data-admin-connect]'),
  deploy: document.querySelector('[data-deploy-vault]'),
  reward: document.querySelector('[data-set-reward]'),
  approve: document.querySelector('[data-approve-funding]'),
  fund: document.querySelector('[data-fund-vault]'),
  lock: document.querySelector('[data-lock-vault]'),
  enable: document.querySelector('[data-enable-claims]'),
  withdraw: document.querySelector('[data-withdraw-remainder]'),
};
const status = document.querySelector('[data-admin-status]');
const output = document.querySelector('[data-vault-output]');
const addressOutput = document.querySelector('[data-deployed-vault]');
let account = '';
let vault = localStorage.getItem('ultraRaresVaultAddress') || '';
let artifact;

const word = (value) => BigInt(value).toString(16).padStart(64, '0');
const addressWord = (address) => address.toLowerCase().replace('0x', '').padStart(64, '0');
const setStatus = (message) => { status.textContent = message; };
const selector = (signature) => artifact.methodIdentifiers[signature];
const callData = (signature, args = []) => `0x${selector(signature)}${args.join('')}`;

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
      if (receipt.status !== '0x1') throw new Error('Transaction reverted');
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
}

async function send(to, data, label) {
  setStatus(`${label}: confirm in your wallet…`);
  const hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: account, to, data, value: '0x0' }] });
  setStatus(`${label}: waiting for confirmation…`);
  const receipt = await waitForReceipt(hash);
  setStatus(`${label} confirmed · ${hash.slice(0, 10)}…`);
  return receipt;
}

function showVault() {
  if (!vault) return;
  output.hidden = false;
  addressOutput.textContent = vault;
    buttons.reward.disabled = false;
    buttons.approve.disabled = false;
    buttons.withdraw.disabled = false;
}

buttons.connect.addEventListener('click', async () => {
  try {
    if (!window.ethereum) throw new Error('Open in Robinhood Wallet or an EVM wallet browser.');
    artifact = await fetch('assets/RareNftClaimVault.json').then((response) => response.json());
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    await switchNetwork();
    account = accounts[0].toLowerCase();
    if (account !== ADMIN) throw new Error('Connected wallet is not the configured vault administrator.');
    buttons.connect.textContent = `Connected ${account.slice(0, 6)}…${account.slice(-4)}`;
    buttons.deploy.disabled = Boolean(vault);
    showVault();
    setStatus(vault ? 'Administrator connected. Continue the existing vault setup.' : 'Administrator connected. Ready to deploy.');
  } catch (error) { setStatus(error.message || 'Wallet connection failed.'); }
});

buttons.deploy.addEventListener('click', async () => {
  try {
    const constructorArgs = addressWord(NFT) + addressWord(RARE) + addressWord(ADMIN);
    setStatus('Deploy vault: confirm in your wallet…');
    const hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: account, data: artifact.bytecode + constructorArgs, value: '0x0' }] });
    const receipt = await waitForReceipt(hash);
    vault = receipt.contractAddress;
    localStorage.setItem('ultraRaresVaultAddress', vault);
    buttons.deploy.disabled = true;
    showVault();
    setStatus('Vault deployed. Copy this address and verify it on the explorer before funding.');
  } catch (error) { setStatus(error.message || 'Deployment failed or was cancelled.'); }
});

buttons.reward.addEventListener('click', async () => {
  try { await send(vault, callData('setDefaultReward(uint256)', [word(REWARD)]), 'Set reward'); buttons.fund.disabled = false; }
  catch (error) { setStatus(error.message || 'Reward setup failed.'); }
});

buttons.approve.addEventListener('click', async () => {
  try { await send(RARE, `0x095ea7b3${addressWord(vault)}${word(INVENTORY)}`, 'Approve funding'); buttons.fund.disabled = false; }
  catch (error) { setStatus(error.message || 'Approval failed.'); }
});

buttons.fund.addEventListener('click', async () => {
  try { await send(vault, callData('fund(uint256)', [word(INVENTORY)]), 'Fund vault'); buttons.lock.disabled = false; }
  catch (error) { setStatus(error.message || 'Funding failed.'); }
});

buttons.lock.addEventListener('click', async () => {
  try { await send(vault, callData('lockAllocations()'), 'Lock allocations'); buttons.enable.disabled = false; }
  catch (error) { setStatus(error.message || 'Locking failed.'); }
});

buttons.enable.addEventListener('click', async () => {
  if (!confirm('Start the 30-day claim window now? The deadline cannot be extended.')) return;
  try { await send(vault, callData('enableClaims()'), 'Open claims'); buttons.enable.disabled = true; }
  catch (error) { setStatus(error.message || 'Opening claims failed.'); }
});

buttons.withdraw.addEventListener('click', async () => {
  if (!confirm('Withdraw all unclaimed RARE to the administrator wallet? This works only after the 30-day deadline.')) return;
  try { await send(vault, callData('withdrawAfterDeadline(address)', [addressWord(ADMIN)]), 'Withdraw remainder'); }
  catch (error) { setStatus(error.message || 'The claim window may still be open, or no RARE remains.'); }
});

document.querySelector('[data-copy-vault]').addEventListener('click', async () => {
  await navigator.clipboard.writeText(vault);
  setStatus('Vault address copied.');
});

showVault();
