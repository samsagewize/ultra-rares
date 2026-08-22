const WORK_CHAIN_ID = '0x1237';
const WORK_NFT = '0x923aaaa62c12505b1bbb57ed52b730d6462c01c5';
const WORK_RARE = '0x1d522a4c3e1f3d97b585903474b2544cf9feeffb';
const WORK_ADMIN = '0x562f6ac10723ef6af9f077a83cf25135fb369612';
const workConnect = document.querySelector('[data-work-connect]');
const workDisconnect = document.querySelector('[data-work-disconnect]');
const workBalance = document.querySelector('[data-work-rare-balance]');
const workStatus = document.querySelector('[data-work-status]');
const workOwnedCount = document.querySelector('[data-work-owned-count]');
const workOwnedGrid = document.querySelector('[data-work-owned]');
const workSelected = document.querySelector('[data-work-selected]');
const workAgentStatus = document.querySelector('[data-work-agent-status]');
let workAccount = '';
let lastWorkLogId = '';

const workWord = (value) => BigInt(value).toString(16).padStart(64, '0');
const workAddressWord = (address) => address.toLowerCase().replace('0x', '').padStart(64, '0');
const ownerOfData = (tokenId) => `0x6352211e${workWord(tokenId)}`;
const tokenUriData = (tokenId) => `0xc87b56dd${workWord(tokenId)}`;
const ipfsUrl = (value) => value?.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${value.slice(7)}` : value;

function decodeAbiString(result) {
  const hex = result.slice(2);
  const length = Number.parseInt(hex.slice(64, 128), 16);
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) bytes[index] = Number.parseInt(hex.slice(128 + index * 2, 130 + index * 2), 16);
  return new TextDecoder().decode(bytes);
}

async function workMetadata(tokenId) {
  try {
    const response = await fetch(`/api/nft-metadata?tokenId=${tokenId}`);
    if (!response.ok) throw new Error('Metadata unavailable');
    const metadata = await response.json();
    if (metadata.image) return { name: metadata.name || `Ultra Rare #${tokenId}`, image: metadata.image };
  } catch {}

  try {
    const result = await window.ethereum.request({ method: 'eth_call', params: [{ to: WORK_NFT, data: tokenUriData(tokenId) }, 'latest'] });
    const uri = decodeAbiString(result);
    let metadata;
    if (uri.startsWith('data:application/json;base64,')) metadata = JSON.parse(atob(uri.split(',')[1]));
    else if (uri.startsWith('data:application/json,')) metadata = JSON.parse(decodeURIComponent(uri.split(',').slice(1).join(',')));
    else metadata = await fetch(ipfsUrl(uri)).then((item) => item.json());
    return { name: metadata.name || `Ultra Rare #${tokenId}`, image: ipfsUrl(metadata.image) || 'assets/untitled.png' };
  } catch { return { name: `Ultra Rare #${tokenId}`, image: 'assets/untitled.png' }; }
}

function resetWork(message = 'Wallet disconnected. No permissions were changed.') {
  workAccount = '';
  workConnect.disabled = false;
  workConnect.textContent = 'Connect wallet';
  workDisconnect.hidden = true;
  workBalance.textContent = '— $RARE';
  workOwnedCount.textContent = 'Connect wallet to load NFTs';
  workOwnedGrid.innerHTML = '<div class="owned-empty">Your Ultra Rares will appear here after you connect.</div>';
  workSelected.textContent = 'Select one of your Ultra Rares above.';
  workAgentStatus.textContent = 'Not activated';
  workStatus.textContent = message;
}

async function loadWorkBalance() {
  const data = `0x70a08231${workAddressWord(workAccount)}`;
  const result = await window.ethereum.request({ method: 'eth_call', params: [{ to: WORK_RARE, data }, 'latest'] });
  const whole = BigInt(result) / 10n ** 18n;
  workBalance.textContent = `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(whole)} $RARE`;
}

function selectWorker(tokenId, name, card) {
  document.querySelectorAll('.work-owned-grid .owned-rare-card.is-selected').forEach((item) => item.classList.remove('is-selected'));
  card.classList.add('is-selected');
  workSelected.textContent = `${name} · Token ID #${tokenId}`;
  workAgentStatus.textContent = 'Ready for future activation';
  document.querySelector('.work-console').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function workTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' });
}

async function loadPublicWorkLog() {
  const container = document.querySelector('[data-work-public-log]');
  try {
    const response = await fetch('/api/work-log', { cache: 'no-store' });
    if (!response.ok) throw new Error('log unavailable');
    const payload = await response.json();
    document.querySelector('[data-work-test-mode]').textContent = `${payload.mode} TEST LIVE`;
    document.querySelector('[data-work-current-goal]').textContent = payload.currentGoal;
    document.querySelector('[data-work-execution]').textContent = payload.execution;
    document.querySelector('[data-work-log-updated]').textContent = workTime(payload.updatedAt);
    const newest = payload.entries?.[0]?.id || '';
    container.replaceChildren(...(payload.entries || []).map((entry, index) => {
      const row = document.createElement(entry.url ? 'a' : 'article');
      row.className = `work-log-row${index === 0 && newest !== lastWorkLogId ? ' is-new' : ''}`;
      if (entry.url) { row.href = entry.url; row.target = '_blank'; row.rel = 'noopener noreferrer'; }
      const step = document.createElement('strong');
      step.textContent = entry.step;
      const detail = document.createElement('p');
      detail.textContent = entry.detail;
      const goal = document.createElement('span');
      goal.textContent = `GOAL · ${entry.goal}`;
      const time = document.createElement('time');
      time.dateTime = entry.timestamp;
      time.textContent = workTime(entry.timestamp);
      row.append(step, detail, goal, time);
      return row;
    }));
    lastWorkLogId = newest;
  } catch {
    container.innerHTML = '<p class="work-log-loading">Live log reconnecting… no trade will execute while data is unavailable.</p>';
  }
}

async function loadOwnedWorkers() {
  workOwnedCount.textContent = 'Scanning 420 Ultra Rares…';
  workOwnedGrid.innerHTML = '<div class="owned-empty">Reading ownership directly from Robinhood Chain…</div>';
  const owned = [];
  for (let start = 1; start <= 420; start += 20) {
    const ids = Array.from({ length: Math.min(20, 421 - start) }, (_, index) => start + index);
    const owners = await Promise.all(ids.map(async (tokenId) => {
      try {
        const result = await window.ethereum.request({ method: 'eth_call', params: [{ to: WORK_NFT, data: ownerOfData(tokenId) }, 'latest'] });
        return `0x${result.slice(-40)}`.toLowerCase();
      } catch { return ''; }
    }));
    ids.forEach((tokenId, index) => { if (owners[index] === workAccount.toLowerCase()) owned.push(tokenId); });
  }

  workOwnedCount.textContent = `${owned.length} worker${owned.length === 1 ? '' : 's'} available`;
  if (!owned.length) {
    workOwnedGrid.innerHTML = '<div class="owned-empty">No Ultra Rares were found in this wallet.</div>';
    return;
  }

  const parts = new Map();
  const cards = owned.map((tokenId) => {
    const card = document.createElement('article');
    card.className = 'owned-rare-card work-worker-card';
    const image = document.createElement('img');
    image.src = 'assets/untitled.png';
    image.alt = `Ultra Rare #${tokenId}`;
    image.onerror = () => { image.onerror = null; image.src = 'assets/untitled.png'; };
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = `Ultra Rare #${tokenId}`;
    const edition = document.createElement('small');
    edition.textContent = `Agent wallet · not activated`;
    copy.append(name, edition);
    const actions = document.createElement('span');
    actions.className = 'owned-rare-actions';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'View work setup ↗';
    button.addEventListener('click', () => selectWorker(tokenId, name.textContent, card));
    actions.append(button);
    card.append(image, copy, actions);
    parts.set(tokenId, { image, name });
    return card;
  });
  workOwnedGrid.replaceChildren(...cards);

  owned.forEach(async (tokenId) => {
    const metadata = await workMetadata(tokenId);
    const card = parts.get(tokenId);
    card.name.textContent = metadata.name;
    card.image.alt = metadata.name;
    card.image.src = metadata.image;
  });
}

workConnect?.addEventListener('click', async () => {
  if (!window.ethereum) {
    workStatus.textContent = 'No compatible Ethereum wallet was detected.';
    return;
  }
  workConnect.disabled = true;
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    workAccount = accounts[0] || '';
    let chainId = await window.ethereum.request({ method: 'eth_chainId' });
    if (chainId !== WORK_CHAIN_ID) {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: WORK_CHAIN_ID }] });
      chainId = await window.ethereum.request({ method: 'eth_chainId' });
    }
    if (!workAccount || chainId !== WORK_CHAIN_ID) throw new Error('Connect your wallet to Robinhood Chain.');
    workConnect.textContent = `${workAccount.slice(0, 6)}…${workAccount.slice(-4)}`;
    workDisconnect.hidden = false;
    workStatus.textContent = 'Wallet connected. Loading your Ultra Rares without requesting approvals…';
    if (workAccount.toLowerCase() === WORK_ADMIN) workStatus.textContent = 'Admin test wallet connected. Paper mode cannot request approvals or move funds.';
    await Promise.all([loadWorkBalance(), loadOwnedWorkers()]);
    workStatus.textContent = 'Ownership loaded directly from Robinhood Chain. Agent activation remains safely locked.';
  } catch (error) {
    workConnect.disabled = false;
    workStatus.textContent = error.message || 'Wallet connection failed.';
  }
});

workDisconnect?.addEventListener('click', () => resetWork());
window.ethereum?.on?.('accountsChanged', () => resetWork('Wallet account changed. Reconnect to load the correct Ultra Rares.'));
window.ethereum?.on?.('chainChanged', () => resetWork('Network changed. Reconnect on Robinhood Chain.'));

loadPublicWorkLog();
setInterval(loadPublicWorkLog, 4000);
