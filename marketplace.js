const MARKET_CHAIN_ID = '0x1237';
const MARKET_NFT = '0x923aaaa62c12505b1bbb57ed52b730d6462c01c5';
const MARKET_RARE = '0x1d522a4c3e1f3d97b585903474b2544cf9feeffb';
const MARKET_ADMIN = '0x562f6ac10723ef6af9f077a83cf25135fb369612';
const MARKET_TRANSFER_VALIDATOR = '0xa000027a9b2802e1ddf7000061001e5c005a0000';
const marketRoot = document.querySelector('[data-marketplace]');
const marketplaceAddress = marketRoot?.dataset.marketplaceAddress || '';
const auctionAddress = marketRoot?.dataset.auctionAddress || '';
const renameRegistryAddress = marketRoot?.dataset.renameRegistryAddress || '';
const marketStatus = document.querySelector('[data-market-status]');
const connectMarket = document.querySelector('[data-market-connect]');
const disconnectMarket = document.querySelector('[data-market-disconnect]');
const rareBalance = document.querySelector('[data-rare-balance]');
const controls = [...document.querySelectorAll('.marketplace-tools input, .marketplace-tools button')];
const auctionControls = [...document.querySelectorAll('.auction-tools input, .auction-tools select, .auction-tools button')];
const ownedGrid = document.querySelector('[data-owned-rares]');
const ownedCount = document.querySelector('[data-owned-count]');
const auctionModal = document.querySelector('[data-auction-modal]');
const auctionFlowStatus = document.querySelector('[data-auction-flow-status]');
const renameModal = document.querySelector('[data-rename-modal]');
const renameStatus = document.querySelector('[data-rename-status]');
const renameName = document.querySelector('[data-rename-name]');
const renameSubmit = document.querySelector('[data-submit-rename]');
const confirmModal = document.querySelector('[data-confirm-modal]');
let confirmResolver = null;
let marketAccount = '';
let marketArtifact;
let auctionArtifact;
let feeVaultArtifact;
let renameArtifact;
let selectedListing = null;
let selectedBidAuction = null;
let selectedRenameToken = null;
let renameReady = false;
let liveAuctionRefresh;

function closeSiteConfirm(accepted = false) {
  if (!confirmModal || confirmModal.hidden) return;
  confirmModal.hidden = true;
  document.body.classList.remove('modal-open');
  const resolve = confirmResolver;
  confirmResolver = null;
  resolve?.(accepted);
}

function siteConfirm({ eyebrow = 'Confirm action', title = 'Are you sure?', copy, confirmLabel = 'Confirm' }) {
  document.querySelector('[data-confirm-eyebrow]').textContent = eyebrow;
  document.querySelector('[data-confirm-title]').textContent = title;
  document.querySelector('[data-confirm-copy]').textContent = copy;
  document.querySelector('[data-confirm-accept]').textContent = confirmLabel;
  confirmModal.hidden = false;
  document.body.classList.add('modal-open');
  document.querySelector('[data-confirm-cancel]').focus();
  return new Promise((resolve) => { confirmResolver = resolve; });
}

document.querySelector('[data-confirm-cancel]')?.addEventListener('click', () => closeSiteConfirm(false));
document.querySelector('[data-confirm-accept]')?.addEventListener('click', () => closeSiteConfirm(true));
confirmModal?.addEventListener('click', (event) => { if (event.target === confirmModal) closeSiteConfirm(false); });

const marketWord = (value) => BigInt(value).toString(16).padStart(64, '0');
const marketAddressWord = (address) => address.toLowerCase().replace('0x', '').padStart(64, '0');
const marketSelector = (signature) => marketArtifact.methodIdentifiers[signature];
const marketCall = (signature, args = []) => `0x${marketSelector(signature)}${args.join('')}`;
const rareUnits = (value) => BigInt(value) * 10n ** 18n;
const auctionSelector = (signature) => auctionArtifact.methodIdentifiers[signature];
const auctionCall = (signature, args = []) => `0x${auctionSelector(signature)}${args.join('')}`;
const renameSelector = (signature) => renameArtifact.methodIdentifiers[signature];
const renameCall = (signature, args = []) => `0x${renameSelector(signature)}${args.join('')}`;
const isAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(value);

function formatRareBalance(value) {
  const whole = BigInt(value) / 10n ** 18n;
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(whole)} $RARE`;
}

async function loadRareBalance() {
  const data = `0x70a08231${marketAddressWord(marketAccount)}`;
  const result = await window.ethereum.request({ method: 'eth_call', params: [{ to: MARKET_RARE, data }, 'latest'] });
  rareBalance.textContent = formatRareBalance(result);
}

async function readContractAddress(target, selector) {
  const result = await window.ethereum.request({ method: 'eth_call', params: [{ to: target, data: `0x${selector}` }, 'latest'] });
  return `0x${result.slice(-40)}`.toLowerCase();
}

async function verifyAuctionDeployment() {
  if (!isAddress(auctionAddress)) return false;
  const code = await window.ethereum.request({ method: 'eth_getCode', params: [auctionAddress, 'latest'] });
  if (!code || code === '0x') throw new Error('Auction address has no deployed contract code.');
  const collection = await readContractAddress(auctionAddress, auctionArtifact.methodIdentifiers['collection()']);
  const token = await readContractAddress(auctionAddress, auctionArtifact.methodIdentifiers['rareToken()']);
  const vault = await readContractAddress(auctionAddress, auctionArtifact.methodIdentifiers['feeVault()']);
  if (collection !== MARKET_NFT || token !== MARKET_RARE) throw new Error('Auction contract does not match the official Ultra Rares NFT and $RARE token.');
  const vaultCode = await window.ethereum.request({ method: 'eth_getCode', params: [vault, 'latest'] });
  if (!vaultCode || vaultCode === '0x') throw new Error('Auction fee vault is not a deployed contract.');
  const vaultToken = await readContractAddress(vault, feeVaultArtifact.methodIdentifiers['rareToken()']);
  const vaultOwner = await readContractAddress(vault, feeVaultArtifact.methodIdentifiers['owner()']);
  const claimDestination = await readContractAddress(vault, feeVaultArtifact.methodIdentifiers['claimDestination()']);
  const liquidityDestination = await readContractAddress(vault, feeVaultArtifact.methodIdentifiers['liquidityDestination()']);
  const vaultLocked = await window.ethereum.request({ method: 'eth_call', params: [{ to: vault, data: `0x${feeVaultArtifact.methodIdentifiers['configurationLocked()']}` }, 'latest'] });
  const sourceData = `0x${feeVaultArtifact.methodIdentifiers['feeSources(address)']}${marketAddressWord(auctionAddress)}`;
  const sourceAuthorized = await window.ethereum.request({ method: 'eth_call', params: [{ to: vault, data: sourceData }, 'latest'] });
  if (vaultToken !== MARKET_RARE || vaultOwner !== MARKET_ADMIN || claimDestination !== MARKET_ADMIN || liquidityDestination !== MARKET_ADMIN || BigInt(vaultLocked) !== 1n || BigInt(sourceAuthorized) !== 1n) {
    throw new Error('Auction fee vault configuration does not match the verified locked deployment.');
  }
  const whitelistData = `0x8e28800f${marketAddressWord(MARKET_NFT)}${marketAddressWord(auctionAddress)}`;
  const whitelisted = await window.ethereum.request({ method: 'eth_call', params: [{ to: MARKET_TRANSFER_VALIDATOR, data: whitelistData }, 'latest'] });
  if (BigInt(whitelisted) !== 1n) throw new Error('Auction deployment is waiting for collection transfer-policy authorization.');
  return true;
}

async function verifyRenameDeployment() {
  if (!isAddress(renameRegistryAddress)) return false;
  const code = await window.ethereum.request({ method: 'eth_getCode', params: [renameRegistryAddress, 'latest'] });
  if (!code || code === '0x') throw new Error('Rename registry address has no deployed contract code.');
  const [collection, token, admin, cost] = await Promise.all([
    readContractAddress(renameRegistryAddress, renameSelector('collection()')),
    readContractAddress(renameRegistryAddress, renameSelector('rareToken()')),
    readContractAddress(renameRegistryAddress, renameSelector('admin()')),
    window.ethereum.request({ method: 'eth_call', params: [{ to: renameRegistryAddress, data: `0x${renameSelector('RENAME_COST()')}` }, 'latest'] }),
  ]);
  if (collection !== MARKET_NFT || token !== MARKET_RARE || admin !== MARKET_ADMIN || BigInt(cost) !== rareUnits(30000)) {
    throw new Error('Rename registry does not match the official collection, $RARE token, administrator, and 30,000 $RARE cost.');
  }
  return true;
}

function resetWalletView(message = 'Wallet disconnected.') {
  marketAccount = '';
  renameReady = false;
  auctionControls.forEach((control) => { control.disabled = true; });
  connectMarket.textContent = 'Connect wallet';
  connectMarket.disabled = false;
  disconnectMarket.hidden = true;
  rareBalance.textContent = '— $RARE';
  ownedCount.textContent = 'Connect wallet to load NFTs';
  ownedGrid.innerHTML = '<div class="owned-empty">Your Ultra Rares will appear here after you connect.</div>';
  closeAuctionModal();
  closeRenameModal();
  marketStatus.textContent = message;
}
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
const withTimeout = (promise, milliseconds = 7000) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('Metadata timed out')), milliseconds)),
]);

async function nftMetadata(tokenId) {
  try {
    const serverMetadata = await withTimeout(fetch(`/api/nft-metadata?tokenId=${tokenId}`).then((response) => {
      if (!response.ok) throw new Error('Server metadata unavailable');
      return response.json();
    }), 15000);
    if (serverMetadata.image) return {
      name: serverMetadata.name || `Ultra Rare #${tokenId}`,
      image: serverMetadata.image,
    };
  } catch {}

  try {
    const result = await withTimeout(window.ethereum.request({ method: 'eth_call', params: [{ to: MARKET_NFT, data: tokenUriData(tokenId) }, 'latest'] }));
    const uri = decodeAbiString(result);
    let metadata;
    if (uri.startsWith('data:application/json;base64,')) metadata = JSON.parse(atob(uri.split(',')[1]));
    else if (uri.startsWith('data:application/json,')) metadata = JSON.parse(decodeURIComponent(uri.split(',').slice(1).join(',')));
    else metadata = await withTimeout(fetch(ipfsUrl(uri)).then((response) => {
      if (!response.ok) throw new Error('Metadata unavailable');
      return response.json();
    }));
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
  auctionFlowStatus.textContent = 'Choose the minimum bid and duration, then press Start auction.';
  marketStatus.textContent = auctionAddress
    ? `Ultra Rare #${tokenId} selected. Set the reserve and auction duration.`
    : `Ultra Rare #${tokenId} selected. Auction creation unlocks after the reviewed contract is deployed.`;
}

function openRenameModal(tokenId) {
  selectedRenameToken = tokenId;
  document.querySelector('[data-selected-rename-id]').textContent = tokenId;
  renameName.value = '';
  renameStatus.textContent = renameReady
    ? 'Enter the new name. Your wallet will first approve exactly 30,000 $RARE, then record the rename request on-chain.'
    : 'Burning remains locked until the verified rename registry is deployed and published. Never send $RARE manually.';
  renameSubmit.disabled = !renameReady;
  renameModal.hidden = false;
  document.body.classList.add('modal-open');
}

function closeRenameModal() {
  renameModal.hidden = true;
  selectedRenameToken = null;
  if (auctionModal.hidden && document.querySelector('[data-bid-modal]')?.hidden) document.body.classList.remove('modal-open');
}

document.querySelector('[data-close-rename]')?.addEventListener('click', closeRenameModal);
renameModal?.addEventListener('click', (event) => { if (event.target === renameModal) closeRenameModal(); });

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
  const cardParts = new Map();
  const cards = owned.map((tokenId) => {
    const card = document.createElement('article');
    card.className = 'owned-rare-card';
    const image = document.createElement('img');
    image.src = 'assets/untitled.png';
    image.alt = `Ultra Rare #${tokenId}`;
    image.onerror = () => { image.onerror = null; image.src = 'assets/untitled.png'; };
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = `Ultra Rare #${tokenId}`;
    const edition = document.createElement('small');
    edition.textContent = `Ultra Rares · #${tokenId}`;
    const actions = document.createElement('span');
    actions.className = 'owned-rare-actions';
    const auctionButton = document.createElement('button');
    auctionButton.type = 'button';
    auctionButton.textContent = 'List for auction ↗';
    auctionButton.addEventListener('click', () => selectOwnedRare(tokenId, card));
    const renameButton = document.createElement('button');
    renameButton.type = 'button';
    renameButton.textContent = 'Burn 30,000 $RARE to change name ↗';
    renameButton.addEventListener('click', () => openRenameModal(tokenId));
    actions.append(auctionButton, renameButton);
    copy.append(name, edition);
    card.append(image, copy, actions);
    cardParts.set(tokenId, { image, name });
    return card;
  });
  ownedGrid.replaceChildren(...cards);
  owned.forEach(async (tokenId) => {
    const metadata = await nftMetadata(tokenId);
    const parts = cardParts.get(tokenId);
    parts.name.textContent = metadata.name;
    parts.image.alt = metadata.name;
    parts.image.src = metadata.image;
  });
}

function closeAuctionModal() {
  auctionModal.hidden = true;
  document.body.classList.remove('modal-open');
}

document.querySelector('[data-close-auction]')?.addEventListener('click', closeAuctionModal);
auctionModal?.addEventListener('click', (event) => { if (event.target === auctionModal) closeAuctionModal(); });
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!confirmModal?.hidden) closeSiteConfirm(false);
  else if (!renameModal?.hidden) closeRenameModal();
  else if (!auctionModal?.hidden) closeAuctionModal();
});

const bidModal = document.querySelector('[data-bid-modal]');
const liveBidStatus = document.querySelector('[data-live-bid-status]');
const rareDisplay = (baseUnits) => {
  const value = BigInt(baseUnits || 0);
  const whole = value / 10n ** 18n;
  const fraction = (value % 10n ** 18n).toString().padStart(18, '0').slice(0, 2).replace(/0+$/, '');
  return `${whole.toLocaleString()}${fraction ? `.${fraction}` : ''}`;
};
const shortAddress = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;

function closeBidModal() {
  bidModal.hidden = true;
  selectedBidAuction = null;
  if (auctionModal.hidden) document.body.classList.remove('modal-open');
}

function openBidModal(auction) {
  selectedBidAuction = auction;
  document.querySelector('[data-selected-bid-id]').textContent = auction.tokenId;
  const minimumBase = BigInt(auction.highestBid) > 0n ? BigInt(auction.highestBid) + 10n ** 18n : BigInt(auction.reserve);
  const minimum = (minimumBase + 10n ** 18n - 1n) / 10n ** 18n;
  document.querySelector('[data-selected-bid-summary]').textContent = `Current bid ${rareDisplay(auction.highestBid)} $RARE · minimum opening bid ${rareDisplay(auction.reserve)} $RARE.`;
  const input = document.querySelector('[data-live-bid-amount]');
  input.min = minimum.toString();
  input.value = minimum.toString();
  liveBidStatus.textContent = marketAccount ? 'Ready. Your wallet will show each required transaction.' : 'Connect your wallet at the top of this page before bidding.';
  bidModal.hidden = false;
  document.body.classList.add('modal-open');
}

document.querySelector('[data-close-bid]')?.addEventListener('click', closeBidModal);
bidModal?.addEventListener('click', (event) => { if (event.target === bidModal) closeBidModal(); });

function updateAuctionTimers() {
  const now = Math.floor(Date.now() / 1000);
  document.querySelectorAll('[data-auction-end]').forEach((element) => {
    const remaining = Number(element.dataset.auctionEnd) - now;
    if (remaining <= 0) { element.textContent = 'ENDED · READY TO SETTLE'; return; }
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    const seconds = remaining % 60;
    element.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} LEFT`;
  });
}

async function hydrateAuctionImage(tokenId, image) {
  try {
    const metadata = await fetch(`/api/nft-metadata?tokenId=${tokenId}`).then((response) => {
      if (!response.ok) throw new Error('Artwork lookup failed');
      return response.json();
    });
    if (!metadata.image || String(metadata.tokenId) !== String(tokenId)) return false;
    image.src = metadata.image;
    image.hidden = false;
    return true;
  } catch {
    return false;
  }
}

function renderLiveAuctions(payload) {
  const grid = document.querySelector('[data-live-auction-grid]');
  const status = document.querySelector('[data-live-auctions-status]');
  status.textContent = `${payload.activeAuctions.length} ON-CHAIN AUCTION${payload.activeAuctions.length === 1 ? '' : 'S'} · AUTO-UPDATING`;
  if (!payload.activeAuctions.length) grid.innerHTML = '<div class="owned-empty">No Ultra Rares are currently in auction.</div>';
  else {
    const cards = payload.activeAuctions.map((auction) => {
      const card = document.createElement('article');
      card.className = 'live-auction-card';
      const artwork = document.createElement('div');
      artwork.className = 'live-auction-art';
      const image = document.createElement('img');
      image.alt = `Ultra Rare #${auction.tokenId}`;
      image.hidden = !auction.image;
      if (auction.image) image.src = auction.image;
      const imageId = document.createElement('span');
      imageId.textContent = `#${auction.tokenId}`;
      image.onerror = () => {
        image.onerror = null;
        image.hidden = true;
        hydrateAuctionImage(auction.tokenId, image);
      };
      artwork.append(image, imageId);
      const content = document.createElement('div');
      const title = document.createElement('h3');
      title.textContent = `Ultra Rare #${auction.tokenId}`;
      const timer = document.createElement('strong');
      timer.dataset.auctionEnd = auction.endTime;
      const stats = document.createElement('p');
      stats.textContent = `HIGH BID ${rareDisplay(auction.highestBid)} $RARE · RESERVE ${rareDisplay(auction.reserve)} $RARE`;
      const seller = document.createElement('small');
      seller.textContent = `SELLER ${shortAddress(auction.seller)}`;
      const button = document.createElement('button');
      button.type = 'button';
      const isSeller = marketAccount && auction.seller.toLowerCase() === marketAccount.toLowerCase();
      const hasBid = BigInt(auction.highestBid) > 0n || auction.highestBidder !== '0x0000000000000000000000000000000000000000';
      const hasEnded = auction.endTime <= Date.now() / 1000;

      if (!hasEnded) {
        button.textContent = 'VIEW / PLACE BID ↗';
        button.addEventListener('click', () => openBidModal(auction));
      } else if (!hasBid && isSeller) {
        button.className = 'return-expired-auction';
        button.textContent = 'RETURN NFT TO MY WALLET';
        button.addEventListener('click', async () => {
          const confirmed = await siteConfirm({
            eyebrow: 'Ended auction · no bids',
            title: 'Return #'+auction.tokenId+'?',
            copy: 'This sends Ultra Rare #'+auction.tokenId+' from the auction contract back to your connected seller wallet and removes the ended auction.',
            confirmLabel: 'Return NFT to my wallet',
          });
          if (!confirmed) return;
          button.disabled = true;
          button.textContent = 'CONFIRM RETURN IN WALLET…';
          try {
            await marketSend(auctionAddress, auctionCall('settle(uint256)', [marketWord(auction.tokenId)]), 'Return NFT from ended auction');
            button.textContent = 'NFT RETURNED ✓';
            await loadLiveAuctions();
            await loadOwnedRares();
          } catch (error) {
            button.disabled = false;
            button.textContent = 'RETURN NFT TO MY WALLET';
            marketStatus.textContent = error?.code === 4001 ? 'Return dismissed. The NFT remains safely in auction escrow.' : (error.message || 'The NFT could not be returned yet.');
          }
        });
      } else if (!hasBid) {
        button.textContent = marketAccount ? 'ENDED · SELLER CAN RETURN NFT' : 'CONNECT SELLER WALLET TO RETURN NFT';
        button.disabled = true;
      } else {
        button.textContent = marketAccount ? 'SETTLE ENDED AUCTION' : 'CONNECT WALLET TO SETTLE';
        button.disabled = !marketAccount;
        if (marketAccount) {
          button.addEventListener('click', async () => {
            button.disabled = true;
            button.textContent = 'CONFIRM SETTLEMENT IN WALLET…';
            try {
              await marketSend(auctionAddress, auctionCall('settle(uint256)', [marketWord(auction.tokenId)]), 'Settle ended auction');
              await loadLiveAuctions();
              await loadOwnedRares();
            } catch (error) {
              button.disabled = false;
              button.textContent = 'SETTLE ENDED AUCTION';
              marketStatus.textContent = error?.code === 4001 ? 'Settlement dismissed.' : (error.message || 'This auction could not be settled yet.');
            }
          });
        }
      }

      content.append(title, timer, stats, seller, button);
      if (!hasEnded && isSeller && !hasBid) {
        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'cancel-live-auction';
        cancelButton.textContent = 'Cancel listing';
        cancelButton.addEventListener('click', async () => {
          const confirmed = await siteConfirm({
            eyebrow: 'Live auction · no bids',
            title: 'Cancel #'+auction.tokenId+'?',
            copy: 'This cancels the auction and returns Ultra Rare #'+auction.tokenId+' to your connected seller wallet.',
            confirmLabel: 'Cancel listing',
          });
          if (!confirmed) return;
          cancelButton.disabled = true;
          cancelButton.textContent = 'Confirm in wallet…';
          try {
            await marketSend(auctionAddress, auctionCall('cancelAuction(uint256)', [marketWord(auction.tokenId)]), 'Cancel auction');
            cancelButton.textContent = 'Listing cancelled ✓';
            await loadLiveAuctions();
            await loadOwnedRares();
          } catch (error) {
            cancelButton.disabled = false;
            cancelButton.textContent = 'Cancel listing';
            marketStatus.textContent = error?.code === 4001 ? 'Cancellation dismissed. The auction is still live.' : (error.message || 'This auction could not be cancelled.');
          }
        });
        content.append(cancelButton);
      } else if (!hasEnded && isSeller && hasBid) {
        const lockNotice = document.createElement('small');
        lockNotice.className = 'auction-cancel-locked';
        lockNotice.textContent = 'Cancellation locked · a bid has been placed';
        content.append(lockNotice);
      }
      card.append(artwork, content);
      if (!auction.image) hydrateAuctionImage(auction.tokenId, image);
      return card;
    });
    grid.replaceChildren(...cards);
  }

  const activityRoot = document.querySelector('[data-auction-activity]');
  if (!payload.activity.length) activityRoot.innerHTML = '<p>No auction activity yet.</p>';
  else {
    const rows = payload.activity.map((event) => {
      const row = document.createElement('a');
      row.href = `https://robinhoodchain.blockscout.com/tx/${event.transactionHash}`;
      row.target = '_blank';
      row.rel = 'noopener noreferrer';
      const label = event.type === 'bid' ? `${rareDisplay(event.amount)} $RARE BID` : event.type.toUpperCase();
      const time = new Date(event.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const headline = document.createElement('strong');
      headline.textContent = `#${event.tokenId} · ${label}`;
      const detail = document.createElement('span');
      detail.textContent = `${event.account ? shortAddress(event.account) : ''} · ${time}`;
      row.append(headline, detail);
      return row;
    });
    activityRoot.replaceChildren(...rows);
  }
  updateAuctionTimers();
}

async function loadLiveAuctions() {
  try {
    const payload = await fetch(`/api/live-auctions?t=${Math.floor(Date.now() / 10000)}`).then((response) => {
      if (!response.ok) throw new Error('Auction feed unavailable');
      return response.json();
    });
    renderLiveAuctions(payload);
  } catch {
    document.querySelector('[data-live-auctions-status]').textContent = 'LIVE FEED RETRYING…';
  }
}

async function marketNetwork() {
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: MARKET_CHAIN_ID }] });
  } catch (error) {
    if (error.code !== 4902) throw error;
    await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: MARKET_CHAIN_ID, chainName: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://rpc.mainnet.chain.robinhood.com/'], blockExplorerUrls: ['https://robinhoodchain.blockscout.com/'] }] });
  }
}

async function marketSend(to, data, label) {
  if (!marketAccount) throw new Error('Connect your wallet first.');
  const chainId = await window.ethereum.request({ method: 'eth_chainId' });
  if (chainId !== MARKET_CHAIN_ID) throw new Error('Switch to Robinhood Chain before continuing.');
  marketStatus.textContent = `${label}: confirm in wallet…`;
  if (!auctionModal.hidden) auctionFlowStatus.textContent = `${label}: confirm in your wallet…`;
  const hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: marketAccount, to, data, value: '0x0' }] });
  if (!auctionModal.hidden) auctionFlowStatus.textContent = `${label}: submitted. Waiting for confirmation…`;
  let receipt;
  for (;;) {
    receipt = await window.ethereum.request({ method: 'eth_getTransactionReceipt', params: [hash] });
    if (receipt) break;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  if (receipt.status !== '0x1') throw new Error(`${label} reverted on-chain.`);
  marketStatus.replaceChildren();
  const link = document.createElement('a');
  link.href = `https://robinhoodchain.blockscout.com/tx/${hash}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = `${label} confirmed · View transaction ↗`;
  marketStatus.append(link);
  if (!auctionModal.hidden) auctionFlowStatus.textContent = `${label} confirmed.`;
  return { hash, receipt };
}

connectMarket?.addEventListener('click', async () => {
  connectMarket.disabled = true;
  try {
    if (!window.ethereum) throw new Error('Open in Robinhood Wallet or another EVM wallet browser.');
    marketArtifact = await fetch('assets/RareMarketplace.json').then((response) => response.json());
    auctionArtifact = await fetch('assets/RareAuctionHouse.json').then((response) => response.json());
    feeVaultArtifact = await fetch('assets/RareFeeVault.json').then((response) => response.json());
    renameArtifact = await fetch('assets/RareRenameRegistry.json').then((response) => response.json());
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    await marketNetwork();
    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    if (chainId !== MARKET_CHAIN_ID) throw new Error('Robinhood Chain connection could not be verified.');
    if (!isAddress(accounts[0])) throw new Error('The wallet returned an invalid account address.');
    marketAccount = accounts[0];
    connectMarket.textContent = `${marketAccount.slice(0, 6)}…${marketAccount.slice(-4)}`;
    connectMarket.disabled = true;
    disconnectMarket.hidden = false;
    await loadRareBalance();
    if (await verifyAuctionDeployment()) auctionControls.forEach((control) => { control.disabled = false; });
    renameReady = await verifyRenameDeployment();
    marketStatus.textContent = 'Wallet connected. Loading your Ultra Rares…';
    await loadOwnedRares();
    await loadLiveAuctions();
    marketStatus.textContent = auctionAddress
      ? 'Choose one of your Ultra Rares to create an auction.'
      : 'Your collection is loaded. Auction transactions unlock after contract review and deployment.';
  } catch (error) {
    if (!marketAccount) connectMarket.disabled = false;
    marketStatus.textContent = error.message || 'Wallet connection failed.';
  }
});

function encodeRenameRequest(tokenId, requestedName) {
  const bytes = new TextEncoder().encode(requestedName);
  const nameHex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const paddedName = nameHex.padEnd(Math.ceil(bytes.length / 32) * 64, '0');
  return renameCall('requestRename(uint256,string)', [marketWord(tokenId), marketWord(64), marketWord(bytes.length), paddedName]);
}

renameSubmit?.addEventListener('click', async () => {
  const requestedName = renameName.value.trim();
  const nameBytes = new TextEncoder().encode(requestedName);
  if (!marketAccount || !renameReady || !selectedRenameToken) {
    renameStatus.textContent = 'Connect the holder wallet after the verified rename registry is deployed.';
    return;
  }
  if (!requestedName || nameBytes.length > 24 || [...nameBytes].some((byte) => byte < 0x20 || byte > 0x7e)) {
    renameStatus.textContent = 'Use 1–24 standard letters, numbers, spaces, or punctuation.';
    return;
  }
  renameSubmit.disabled = true;
  renameSubmit.textContent = 'Preparing rename…';
  try {
    const ownerResult = await window.ethereum.request({ method: 'eth_call', params: [{ to: MARKET_NFT, data: ownerOfData(selectedRenameToken) }, 'latest'] });
    if (`0x${ownerResult.slice(-40)}`.toLowerCase() !== marketAccount.toLowerCase()) throw new Error('This wallet no longer owns the selected Ultra Rare.');
    const requestResult = await window.ethereum.request({ method: 'eth_call', params: [{ to: renameRegistryAddress, data: renameCall('requests(uint256)', [marketWord(selectedRenameToken)]) }, 'latest'] });
    const requestWords = requestResult.slice(2).match(/.{64}/g) || [];
    const pendingRequester = `0x${requestWords[0]?.slice(24) || '0'.repeat(40)}`.toLowerCase();
    const requestPending = BigInt(`0x${requestWords[2] || '0'}`) === 1n;
    if (requestPending && pendingRequester === marketAccount.toLowerCase()) throw new Error('This Ultra Rare already has a pending rename request. It must be completed before another request.');
    const cost = rareUnits(30000);
    const allowanceData = `0xdd62ed3e${marketAddressWord(marketAccount)}${marketAddressWord(renameRegistryAddress)}`;
    const allowance = BigInt(await window.ethereum.request({ method: 'eth_call', params: [{ to: MARKET_RARE, data: allowanceData }, 'latest'] }));
    if (allowance < cost) {
      renameStatus.textContent = 'Step 1 of 2: approve exactly 30,000 $RARE in your wallet.';
      await marketSend(MARKET_RARE, `0x095ea7b3${marketAddressWord(renameRegistryAddress)}${marketWord(cost)}`, 'Approve 30,000 $RARE for rename');
    }
    renameStatus.textContent = 'Step 2 of 2: confirm the on-chain rename request and burn.';
    const { hash } = await marketSend(renameRegistryAddress, encodeRenameRequest(selectedRenameToken, requestedName), 'Submit rename request');
    renameStatus.replaceChildren();
    const link = document.createElement('a');
    link.href = `https://robinhoodchain.blockscout.com/tx/${hash}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `Rename requested: “${requestedName}” · View transaction ↗`;
    renameStatus.append(link);
    renameSubmit.textContent = 'Rename request submitted ✓';
    await loadRareBalance();
  } catch (error) {
    renameSubmit.disabled = false;
    renameSubmit.textContent = 'Burn 30,000 $RARE to change name';
    renameStatus.textContent = error?.code === 4001 ? 'Transaction cancelled. No $RARE was burned.' : (error.message || 'Rename request failed. No completed transaction means no rename was recorded.');
  }
});

disconnectMarket?.addEventListener('click', () => resetWalletView('Wallet view cleared. Your wallet remains secure and no permissions were changed.'));

window.ethereum?.on?.('accountsChanged', () => resetWalletView('Wallet account changed. Reconnect to load the correct collection.'));
window.ethereum?.on?.('chainChanged', (chainId) => {
  if (chainId !== MARKET_CHAIN_ID) resetWalletView('Network changed. Reconnect on Robinhood Chain.');
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

document.querySelector('[data-create-auction]')?.addEventListener('click', async () => {
  const startButton = document.querySelector('[data-create-auction]');
  const tokenId = document.querySelector('[data-auction-token]').value;
  const reserve = document.querySelector('[data-auction-reserve]').value;
  const duration = document.querySelector('[data-auction-duration]').value;
  if (!tokenId || !reserve || !Number.isSafeInteger(Number(reserve)) || Number(reserve) < 1) {
    auctionFlowStatus.textContent = 'Enter a whole-number minimum bid of at least 1 $RARE.';
    return;
  }
  if (!['3600', '86400'].includes(duration)) {
    auctionFlowStatus.textContent = 'Choose a 1-hour or 1-day auction.';
    return;
  }
  startButton.disabled = true;
  startButton.textContent = 'Starting auction…';
  try {
    const approvalData = `0x081812fc${marketWord(tokenId)}`;
    const approvalResult = await window.ethereum.request({ method: 'eth_call', params: [{ to: MARKET_NFT, data: approvalData }, 'latest'] });
    const approvedAddress = `0x${approvalResult.slice(-40)}`.toLowerCase();
    if (approvedAddress !== auctionAddress.toLowerCase()) {
      await marketSend(MARKET_NFT, `0x095ea7b3${marketAddressWord(auctionAddress)}${marketWord(tokenId)}`, 'Approve NFT');
    } else {
      auctionFlowStatus.textContent = 'NFT approval already confirmed. Creating auction…';
    }
    await marketSend(auctionAddress, auctionCall('createAuction(uint256,uint256,uint256)', [marketWord(tokenId), marketWord(rareUnits(reserve)), marketWord(duration)]), 'Create auction');
    auctionFlowStatus.textContent = `Ultra Rare #${tokenId} is now live for auction.`;
    startButton.textContent = 'Auction live ✓';
  } catch (error) {
    auctionFlowStatus.textContent = error?.code === 4001 ? 'Transaction cancelled. Nothing changed.' : (error.message || 'Auction could not be started.');
    startButton.disabled = false;
    startButton.textContent = 'Start auction';
  }
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

document.querySelector('[data-submit-live-bid]')?.addEventListener('click', async () => {
  const button = document.querySelector('[data-submit-live-bid]');
  if (!marketAccount) { liveBidStatus.textContent = 'Connect your wallet at the top of the page first.'; return; }
  if (!selectedBidAuction) return;
  const amount = document.querySelector('[data-live-bid-amount]').value;
  if (!amount || !Number.isSafeInteger(Number(amount)) || Number(amount) < 1) {
    liveBidStatus.textContent = 'Enter a valid whole-number $RARE bid.';
    return;
  }
  const amountUnits = rareUnits(amount);
  if (amountUnits < BigInt(selectedBidAuction.reserve) || amountUnits <= BigInt(selectedBidAuction.highestBid)) {
    liveBidStatus.textContent = 'Bid must meet the reserve and exceed the current highest bid.';
    return;
  }
  button.disabled = true;
  button.textContent = 'Placing bid…';
  try {
    const allowanceData = `0xdd62ed3e${marketAddressWord(marketAccount)}${marketAddressWord(auctionAddress)}`;
    const allowance = await window.ethereum.request({ method: 'eth_call', params: [{ to: MARKET_RARE, data: allowanceData }, 'latest'] });
    if (BigInt(allowance) < amountUnits) {
      liveBidStatus.textContent = 'Approve the exact bid amount in your wallet…';
      await marketSend(MARKET_RARE, `0x095ea7b3${marketAddressWord(auctionAddress)}${marketWord(amountUnits)}`, 'Approve $RARE bid');
    }
    liveBidStatus.textContent = 'Confirm the bid in your wallet…';
    await marketSend(auctionAddress, auctionCall('bid(uint256,uint256)', [marketWord(selectedBidAuction.tokenId), marketWord(amountUnits)]), 'Place bid');
    liveBidStatus.textContent = `Bid of ${amount} $RARE confirmed for #${selectedBidAuction.tokenId}.`;
    button.textContent = 'Bid confirmed ✓';
    await loadLiveAuctions();
  } catch (error) {
    liveBidStatus.textContent = error?.code === 4001 ? 'Transaction cancelled. No bid was placed.' : (error.message || 'Bid could not be placed.');
    button.disabled = false;
    button.textContent = 'Approve and place bid';
  }
});

loadLiveAuctions();
liveAuctionRefresh = window.setInterval(loadLiveAuctions, 15000);
window.setInterval(updateAuctionTimers, 1000);
