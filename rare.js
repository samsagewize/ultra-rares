const requestForm = document.querySelector('[data-rare-request]');
const result = document.querySelector('[data-request-result]');
const walletInput = document.querySelector('#wallet-address');
const copyContractButton = document.querySelector('[data-copy-contract]');
const contractAddress = '0x1d522a4c3e1f3d97b585903474b2544cf9feeffb';
const addressPattern = /^0x[a-fA-F0-9]{40}$/;

copyContractButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(contractAddress);
  copyContractButton.textContent = 'Copied!';
  window.setTimeout(() => { copyContractButton.textContent = 'Copy contract'; }, 1600);
});

requestForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const wallet = walletInput.value.trim();
  result.className = 'request-result';

  if (!addressPattern.test(wallet)) {
    result.textContent = 'Enter a complete Ethereum-style wallet address beginning with 0x.';
    result.classList.add('is-error');
    walletInput.focus();
    return;
  }

  const submitButton = requestForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = 'Checking holder…';
  result.textContent = 'Checking this wallet on Robinhood Chain…';

  try {
    const response = await fetch('/api/rare-request', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ wallet }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Request could not be submitted');

    result.innerHTML = '';
    const heading = document.createElement('strong');
    heading.textContent = 'Request received.';
    const details = document.createElement('span');
    details.textContent = ` ${payload.nftBalance} Ultra Rare${payload.nftBalance === 1 ? '' : 's'} verified · Request ${payload.requestId}`;
    result.append(heading, details);
    result.classList.add('is-success');
    requestForm.reset();
  } catch (error) {
    result.textContent = error.message;
    result.classList.add('is-error');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Request RARE ↗';
  }
});
