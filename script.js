const ULTRA_RARES_CONTRACT = '0x923aaaa62c12505b1bbb57ed52b730d6462c01c5';
const ROBINHOOD_CHAIN_ID = '0x1237';
const connectWalletButton = document.querySelector('.connect-wallet');
const walletStatus = document.querySelector('.wallet-status');
const nftStep = document.querySelector('.nft-step');
const utilityStep = document.querySelector('.utility-step');
const ownedNfts = document.querySelector('.owned-nfts');
const nftHelper = document.querySelector('.nft-helper');
const manualTokenForm = document.querySelector('.manual-token-form');
const selectedRare = document.querySelector('.selected-rare');
let connectedAccount = null;

const encodeUint = (value) => BigInt(value).toString(16).padStart(64, '0');
const shortAddress = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;

async function rpcCall(data) {
  return window.ethereum.request({ method: 'eth_call', params: [{ to: ULTRA_RARES_CONTRACT, data }, 'latest'] });
}

async function useRobinhoodChain() {
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ROBINHOOD_CHAIN_ID }] });
  } catch (error) {
    if (error.code !== 4902) throw error;
    await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: ROBINHOOD_CHAIN_ID, chainName: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'], blockExplorerUrls: ['https://robinhoodchain.blockscout.com'] }] });
  }
}

function selectToken(tokenId, button) {
  document.querySelectorAll('.nft-choice').forEach((choice) => choice.classList.remove('selected'));
  if (button) button.classList.add('selected');
  selectedRare.innerHTML = `Ultra Rare <strong>#${tokenId}</strong> selected · contract ${shortAddress(ULTRA_RARES_CONTRACT)}`;
  utilityStep.classList.remove('is-locked');
}

async function ownsToken(tokenId) {
  const result = await rpcCall(`0x6352211e${encodeUint(tokenId)}`);
  return `0x${result.slice(-40)}`.toLowerCase() === connectedAccount.toLowerCase();
}

async function discoverOwnedTokens() {
  ownedNfts.innerHTML = '';
  nftHelper.textContent = 'Looking for your Ultra Rares…';
  try {
    const addressArg = connectedAccount.slice(2).padStart(64, '0');
    const balance = Number(BigInt(await rpcCall(`0x70a08231${addressArg}`)));
    if (!balance) {
      nftHelper.textContent = 'No Ultra Rares were found in this connected wallet.';
      return;
    }
    const tokenIds = [];
    for (let index = 0; index < Math.min(balance, 30); index += 1) {
      const result = await rpcCall(`0x2f745c59${addressArg}${encodeUint(index)}`);
      tokenIds.push(BigInt(result).toString());
    }
    nftHelper.textContent = `${balance} Ultra Rare${balance === 1 ? '' : 's'} found. Select one:`;
    tokenIds.forEach((tokenId) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nft-choice';
      button.textContent = `#${tokenId}`;
      button.addEventListener('click', () => selectToken(tokenId, button));
      ownedNfts.appendChild(button);
    });
  } catch {
    nftHelper.textContent = 'Automatic NFT listing is unavailable for this wallet. Enter a token number below to verify ownership onchain.';
  }
}

connectWalletButton.addEventListener('click', async () => {
  if (!window.ethereum) {
    walletStatus.textContent = 'No compatible wallet detected. Open this site in Robinhood Wallet’s Web3 browser or use a browser wallet that supports Robinhood Chain.';
    return;
  }
  connectWalletButton.disabled = true;
  walletStatus.textContent = 'Waiting for wallet…';
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    await useRobinhoodChain();
    [connectedAccount] = accounts;
    walletStatus.textContent = `Connected · ${shortAddress(connectedAccount)} · Robinhood Chain`;
    connectWalletButton.textContent = 'Wallet connected';
    nftStep.classList.remove('is-locked');
    await discoverOwnedTokens();
  } catch (error) {
    walletStatus.textContent = error?.message || 'Wallet connection was cancelled.';
    connectWalletButton.disabled = false;
  }
});

manualTokenForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!connectedAccount) return;
  const tokenId = new FormData(manualTokenForm).get('tokenId');
  if (!/^\d+$/.test(tokenId)) return;
  nftHelper.textContent = `Verifying Ultra Rare #${tokenId}…`;
  try {
    if (await ownsToken(tokenId)) {
      nftHelper.textContent = `Ownership verified for #${tokenId}.`;
      selectToken(tokenId);
    } else {
      nftHelper.textContent = `#${tokenId} is not owned by the connected wallet.`;
    }
  } catch {
    nftHelper.textContent = 'Could not verify that token number on Robinhood Chain.';
  }
});
