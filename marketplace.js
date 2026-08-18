const MARKET_CHAIN_ID = '0x1237';
const MARKET_NFT = '0x923aaaa62c12505b1bbb57ed52b730d6462c01c5';
const MARKET_RARE = '0x1d522a4c3e1f3d97b585903474b2544cf9feeffb';
const marketRoot = document.querySelector('[data-marketplace]');
const marketplaceAddress = marketRoot?.dataset.marketplaceAddress || '';
const auctionAddress = marketRoot?.dataset.auctionAddress || '';
const marketStatus = document.querySelector('[data-market-status]');
const connectMarket = document.querySelector('[data-market-connect]');
const controls = [...document.querySelectorAll('.marketplace-tools input, .marketplace-tools button')];
const auctionControls = [...document.querySelectorAll('.auction-tools input, .auction-tools select, .auction-tools button')];
const ownedGrid = document.querySelector('[data-owned-rares]');
const ownedCount = document.querySelector('[data-owned-count]');
const auctionModal = document.querySelector('[data-auction-modal]');
let marketAccount = '';
let marketArtifact;
let auctionArtifact;
let selectedListing = null;

const marketWord = (value) => BigInt(value).toString(16).padStart(64, '0');
const marketAddressWord = (address) => address.toLowerCase().replace('0x', '').padStart(64, '0');
const marketSelector = (signature) => marketArtifact.methodIdentifiers[signature];
const marketCall = (signature, args = []) => `0x${marketSelector(signature)}${args.join('')}`;
const rareUnits = (value) => BigInt(value) * 10n ** 18n;
const auctionSelector = (signature) => auctionArtifact.methodIdentifiers[signature];
const auctionCall = (signature, args = []) => `0x${auctionSelector(signature)}${args.join('')}`;
const ownerOfData = (tokenId) => `0x6352211e${marketWord(tokenId)}`;
const tokenUriData = (tokenId) => `0xc87b56dd${marketWord(tokenId)}`;

function decodeAbiString(result) {
  const hex = result.slice(2);
  const length = Number.parseInt(hex.slice(64, 128), 16);
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) bytes[index] = Number.parseInt(hex.slice(128 + index * 2, 130 + index * 2), 16);
  return new TextDecoder().decode(bytes);
}

const ipfsUrl = (value) => value?.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${value.slice(7)}` : value;

async function nftMetadata(tokenId) {
  try {
    const result = await window.ethereum.request({ method: 'eth_call', params: [{ to: MARKET_NFT, data: tokenUriData(tokenId) }, 'latest'] });
    const uri = decodeAbiString(result);
    let metadata;
    if (uri.startsWith('data:application/json;base64,')) metadata = JSON.parse(atob(uri.split(',')[1]));
    else if (uri.startsWith('data:application/json,')) metadata = JSON.parse(decodeURIComponent(uri.split(',').slice(1).join(',')));
    else metadata = await fetch(ipfsUrl(uri)).then((response) => response.json());
    return { name: metadata.name || `Ultra Rare #${tokenId}`, image: ipfsUrl(metadata.image) || 'assets/untitled.png' };
  } catch { return { name: `Ultra Rare #${tokenId}`, image: 'assets/untitled.png' }; }
}

function selectOwnedRare(tokenId, card) {
  document.querySelectorAll('.owned-rare-card.is-selected').forEach((item) => item.classList.remove('is-selected'));
  card.classList.add('is-selected');
  document.querySelector('[data-auction-token]').value = tokenId;
  document.querySelector('[data-selected-auction-id]').textContent = tokenId;
  auctionModal.hidden = false;
  document.body.classList.add('modal-open');
  marketStatus.textContent = auctionAddress
    ? `Ultra Rare #${tokenId} selected. Set the reserve and auction duration.`
    : `Ultra Rare #${tokenId} selected. Auction creation unlocks after the reviewed contract is deployed.`;
}

async function loadOwnedRares() {
  ownedCount.textContent = 'Scanning 420 Ultra Rares…';
  ownedGrid.innerHTML = '<div class="owned-empty">Reading ownership directly from Robinhood Chain…</div>';
  const owned = [];
  for (let start = 1; start <= 420; start += 20) {
    const ids = Array.from({ length: Math.min(20, 421 - start) }, (_, index) => start + index);
    const owners = await Promise.all(ids.map(async (tokenId) => {
      try {
        const result = await window.ethereum.request({ method: 'eth_call', params: [{ to: MARKET_NFT, data: ownerOfData(tokenId) }, 'latest'] });
        return `0x${result.slice(-40)}`.toLowerCase();
      } catch { return ''; }
    }));
    ids.forEach((tokenId, index) => { if (owners[index] === marketAccount.toLowerCase()) owned.push(tokenId); });
  }

  ownedCount.textContent = `${owned.length} Ultra Rare${owned.length === 1 ? '' : 's'} found`;
  if (!owned.length) {
    ownedGrid.innerHTML = '<div class="owned-empty">No Ultra Rares were found in this wallet.</div>';
    return;
  }
  const metadata = await Promise.all(owned.map(nftMetadata));
  const cards = owned.map((tokenId, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'owned-rare-card';
    const image = document.createElement('img');
    image.src = metadata[index].image;
    image.alt = metadata[index].name;
    image.onerror = () => { image.src = 'assets/untitled.png'; };
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = metadata[index].name;
    const edition = document.createElement('small');
    edition.textContent = `Ultra Rares · #${tokenId}`;
    const action = document.createElement('b');
    action.textContent = 'List for auction ↗';
    copy.append(name, edition, action);
    button.append(image, copy);
    button.addEventListener('click', () => selectOwnedRare(tokenId, button));
    return button;
  });
  ownedGrid.replaceChildren(...cards);
}

function closeAuctionModal() {
  auctionModal.hidden = true;
  document.body.classList.remove('modal-open');
}

document.querySelector('[data-close-auction]')?.addEventListener('click', closeAuctionModal);
auctionModal?.addEventListener('click', (event) => { if (event.target === auctionModal) closeAuctionModal(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !auctionModal?.hidden) closeAuctionModal(); });

async function marketNetwork() {
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: MARKET_CHAIN_ID }] });
  } catch (error) {
    if (error.code !== 4902) throw error;
    await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: MARKET_CHAIN_ID, chainName: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://rpc.mainnet.chain.robinhood.com/'], blockExplorerUrls: ['https://robinhoodchain.blockscout.com/'] }] });
  }
}

async function marketSend(to, data, label) {
  marketStatus.textContent = `${label}: confirm in wallet…`;
  const hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: marketAccount, to, data, value: '0x0' }] });
  marketStatus.innerHTML = `<a href="https://robinhoodchain.blockscout.com/tx/${hash}" target="_blank" rel="noopener noreferrer">${label} submitted · View transaction ↗</a>`;
}

connectMarket?.addEventListener('click', async () => {
  try {
    if (!window.ethereum) throw new Error('Open in Robinhood Wallet or another EVM wallet browser.');
    marketArtifact = await fetch('assets/RareMarketplace.json').then((response) => response.json());
    auctionArtifact = await fetch('assets/RareAuctionHouse.json').then((response) => response.json());
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    await marketNetwork();
    marketAccount = accounts[0];
    connectMarket.textContent = `Connected ${marketAccount.slice(0, 6)}…${marketAccount.slice(-4)}`;
    if (marketplaceAddress) controls.forEach((control) => { control.disabled = false; });
    if (auctionAddress) auctionControls.forEach((control) => { control.disabled = false; });
    marketStatus.textContent = 'Wallet connected. Loading your Ultra Rares…';
    await loadOwnedRares();
    marketStatus.textContent = auctionAddress
      ? 'Choose one of your Ultra Rares to create an auction.'
      : 'Your collection is loaded. Auction transactions unlock after contract review and deployment.';
  } catch (error) { marketStatus.textContent = error.message || 'Wallet connection failed.'; }
});

document.querySelector('[data-approve-nft]')?.addEventListener('click', async () => {
  const tokenId = document.querySelector('[data-list-token]').value;
  if (!tokenId) return;
  await marketSend(MARKET_NFT, `0x095ea7b3${marketAddressWord(marketplaceAddress)}${marketWord(tokenId)}`, 'NFT approval');
});

document.querySelector('[data-create-listing]')?.addEventListener('click', async () => {
  const tokenId = document.querySelector('[data-list-token]').value;
  const price = document.querySelector('[data-list-price]').value;
  if (!tokenId || !price || !Number.isSafeInteger(Number(price))) { marketStatus.textContent = 'Enter a valid NFT ID and whole-number $RARE price.'; return; }
  await marketSend(marketplaceAddress, marketCall('createListing(uint256,uint256)', [marketWord(tokenId), marketWord(rareUnits(price))]), 'Create listing');
});

document.querySelector('[data-check-listing]')?.addEventListener('click', async () => {
  const tokenId = document.querySelector('[data-buy-token]').value;
  if (!tokenId) return;
  const result = await window.ethereum.request({ method: 'eth_call', params: [{ to: marketplaceAddress, data: marketCall('listings(uint256)', [marketWord(tokenId)]) }, 'latest'] });
  const seller = `0x${result.slice(26, 66)}`;
  const price = BigInt(`0x${result.slice(66, 130)}`);
  selectedListing = seller === '0x0000000000000000000000000000000000000000' ? null : { tokenId, seller, price };
  document.querySelector('[data-listing-result]').textContent = selectedListing ? `#${tokenId} · ${price / 10n ** 18n} $RARE · seller ${seller.slice(0, 6)}…${seller.slice(-4)}` : 'This NFT is not currently listed.';
});

document.querySelector('[data-approve-rare]')?.addEventListener('click', async () => {
  if (!selectedListing) return;
  await marketSend(MARKET_RARE, `0x095ea7b3${marketAddressWord(marketplaceAddress)}${marketWord(selectedListing.price)}`, '$RARE approval');
});

document.querySelector('[data-buy-nft]')?.addEventListener('click', async () => {
  if (!selectedListing) return;
  await marketSend(marketplaceAddress, marketCall('buy(uint256)', [marketWord(selectedListing.tokenId)]), 'Buy Ultra Rare');
});

document.querySelector('[data-approve-auction-nft]')?.addEventListener('click', async () => {
  const tokenId = document.querySelector('[data-auction-token]').value;
  if (!tokenId) return;
  await marketSend(MARKET_NFT, `0x095ea7b3${marketAddressWord(auctionAddress)}${marketWord(tokenId)}`, 'Auction NFT approval');
});

document.querySelector('[data-create-auction]')?.addEventListener('click', async () => {
  const tokenId = document.querySelector('[data-auction-token]').value;
  const reserve = document.querySelector('[data-auction-reserve]').value;
  const duration = document.querySelector('[data-auction-duration]').value;
  if (!tokenId || !reserve) { marketStatus.textContent = 'Enter an NFT ID and minimum $RARE reserve.'; return; }
  await marketSend(auctionAddress, auctionCall('createAuction(uint256,uint256,uint256)', [marketWord(tokenId), marketWord(rareUnits(reserve)), marketWord(duration)]), 'Create auction');
});

document.querySelector('[data-check-auction]')?.addEventListener('click', async () => {
  const tokenId = document.querySelector('[data-bid-token]').value;
  if (!tokenId) return;
  const result = await window.ethereum.request({ method: 'eth_call', params: [{ to: auctionAddress, data: auctionCall('auctions(uint256)', [marketWord(tokenId)]) }, 'latest'] });
  const words = result.slice(2).match(/.{64}/g) || [];
  const seller = `0x${words[0]?.slice(24) || '0'.repeat(40)}`;
  if (seller === '0x0000000000000000000000000000000000000000') {
    document.querySelector('[data-auction-result]').textContent = 'This NFT does not have an active auction.';
    return;
  }
  const endTime = Number(BigInt(`0x${words[1]}`));
  const reserve = BigInt(`0x${words[2]}`) / 10n ** 18n;
  const highBid = BigInt(`0x${words[4]}`) / 10n ** 18n;
  document.querySelector('[data-auction-result]').textContent = `#${tokenId} · reserve ${reserve} $RARE · high bid ${highBid} $RARE · ends ${new Date(endTime * 1000).toLocaleString()}`;
});

document.querySelector('[data-approve-bid]')?.addEventListener('click', async () => {
  const amount = document.querySelector('[data-bid-amount]').value;
  if (!amount) return;
  await marketSend(MARKET_RARE, `0x095ea7b3${marketAddressWord(auctionAddress)}${marketWord(rareUnits(amount))}`, 'Bid approval');
});

document.querySelector('[data-place-bid]')?.addEventListener('click', async () => {
  const tokenId = document.querySelector('[data-bid-token]').value;
  const amount = document.querySelector('[data-bid-amount]').value;
  if (!tokenId || !amount) return;
  await marketSend(auctionAddress, auctionCall('bid(uint256,uint256)', [marketWord(tokenId), marketWord(rareUnits(amount))]), 'Place bid');
});

document.querySelector('[data-settle-auction]')?.addEventListener('click', async () => {
  const tokenId = document.querySelector('[data-bid-token]').value;
  if (tokenId) await marketSend(auctionAddress, auctionCall('settle(uint256)', [marketWord(tokenId)]), 'Settle auction');
});

document.querySelector('[data-cancel-auction]')?.addEventListener('click', async () => {
  const tokenId = document.querySelector('[data-bid-token]').value;
  if (tokenId) await marketSend(auctionAddress, auctionCall('cancelAuction(uint256)', [marketWord(tokenId)]), 'Cancel auction');
});

document.querySelector('[data-withdraw-refund]')?.addEventListener('click', async () => {
  await marketSend(auctionAddress, auctionCall('withdrawRefund()'), 'Withdraw refund');
});
