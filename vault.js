const ROBINHOOD_CHAIN_ID = '0x1237';
const ROBINHOOD_NETWORK = {
  chainId: ROBINHOOD_CHAIN_ID,
  chainName: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://rpc.mainnet.chain.robinhood.com/'],
  blockExplorerUrls: ['https://robinhoodchain.blockscout.com/'],
};

const vaultSection = document.querySelector('[data-claim-vault]');
const vaultAddress = vaultSection?.dataset.vaultAddress || '';
const connectButton = document.querySelector('[data-connect-wallet]');
const claimButton = document.querySelector('[data-claim-rare]');
const tokenIdsInput = document.querySelector('[data-claim-token-ids]');
const claimStatus = document.querySelector('[data-claim-status]');
const vaultState = document.querySelector('[data-vault-state]');
let connectedWallet = null;

const shortenAddress = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const padWord = (value) => BigInt(value).toString(16).padStart(64, '0');

function encodeClaim(tokenIds) {
  return `0x6ba4c138${padWord(32)}${padWord(tokenIds.length)}${tokenIds.map(padWord).join('')}`;
}

async function switchToRobinhoodChain() {
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ROBINHOOD_CHAIN_ID }] });
  } catch (error) {
    if (error.code !== 4902) throw error;
    await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [ROBINHOOD_NETWORK] });
  }
}

connectButton?.addEventListener('click', async () => {
  if (!window.ethereum) {
    claimStatus.textContent = 'Open this page in Robinhood Wallet or another EVM-compatible wallet browser.';
    return;
  }

  connectButton.disabled = true;
  connectButton.textContent = 'Connecting…';
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    await switchToRobinhoodChain();
    connectedWallet = accounts[0];
    connectButton.textContent = `Connected ${shortenAddress(connectedWallet)}`;
    if (vaultAddress) {
      tokenIdsInput.disabled = false;
      claimButton.disabled = false;
      vaultState.textContent = `Vault ${shortenAddress(vaultAddress)} · Robinhood Chain`;
      claimStatus.textContent = 'Enter the Ultra Rare token IDs owned by this wallet.';
    } else {
      claimStatus.textContent = 'Wallet connected. Claims unlock after the vault is deployed and funded.';
    }
  } catch {
    connectedWallet = null;
    connectButton.textContent = 'Connect wallet';
    connectButton.disabled = false;
    claimStatus.textContent = 'Wallet connection was cancelled or unavailable.';
  }
});

claimButton?.addEventListener('click', async () => {
  if (!connectedWallet || !vaultAddress) return;
  const rawIds = tokenIdsInput.value.split(',').map((value) => value.trim()).filter(Boolean);
  const tokenIds = [...new Set(rawIds.map(Number))];
  if (!tokenIds.length || tokenIds.some((tokenId) => !Number.isSafeInteger(tokenId) || tokenId < 1 || tokenId > 420)) {
    claimStatus.textContent = 'Enter valid token IDs from 1 through 420, separated by commas.';
    return;
  }

  claimButton.disabled = true;
  claimButton.textContent = 'Confirm in wallet…';
  try {
    const transactionHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{ from: connectedWallet, to: vaultAddress, data: encodeClaim(tokenIds), value: '0x0' }],
    });
    claimStatus.innerHTML = '';
    const link = document.createElement('a');
    link.href = `https://robinhoodchain.blockscout.com/tx/${transactionHash}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Claim submitted · View transaction ↗';
    claimStatus.append(link);
  } catch (error) {
    claimStatus.textContent = error?.message?.includes('AlreadyClaimed')
      ? 'One of these NFTs has already claimed.'
      : 'Claim was cancelled or could not be completed.';
  } finally {
    claimButton.disabled = false;
    claimButton.textContent = 'Claim $RARE';
  }
});

if (!vaultAddress && vaultState) vaultState.classList.add('is-pending');
