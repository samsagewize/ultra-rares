(() => {
  const wheel = document.querySelector('[data-yolo-wheel]');
  if (!wheel) return;
  const clock = document.querySelector('[data-yolo-clock]');
  const pot = document.querySelector('[data-yolo-pot]');
  const gross = document.querySelector('[data-yolo-gross]');
  const vaultCut = document.querySelector('[data-yolo-vault]');
  const winnerShare = document.querySelector('[data-yolo-winner-share]');
  const online = document.querySelector('[data-yolo-online]');
  const roundLabel = document.querySelector('[data-yolo-round]');
  const roundsElement = document.querySelector('[data-yolo-rounds]');
  const winsElement = document.querySelector('[data-yolo-wins]');
  const amountInput = document.querySelector('[data-yolo-amount]');
  const walletInput = document.querySelector('[data-yolo-wallet]');
  const enter = document.querySelector('[data-yolo-enter]');
  const odds = document.querySelector('[data-yolo-odds]');
  const message = document.querySelector('[data-yolo-message]');
  const playerList = document.querySelector('[data-yolo-players]');
  const colors = ['#b6ff00', '#754cff', '#36d6ff', '#ff4c72', '#f4f1e9'];
  let entries = [
    { wallet: 'DEMO-01', amount: 72000 },
    { wallet: 'DEMO-02', amount: 48000 },
    { wallet: 'DEMO-03', amount: 35000 },
    { wallet: 'DEMO-04', amount: 25000 },
  ];
  let seconds = 300;
  let rotation = 0;
  let roundNumber = 0;
  const wins = [];

  const number = (value) => Math.round(value).toLocaleString('en-US');
  const addressPattern = /^0x[a-fA-F0-9]{40}$/;
  const shortAddress = (value) => addressPattern.test(value) ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
  function render() {
    const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
    let cursor = 0;
    const slices = entries.map((entry, index) => {
      const start = cursor;
      cursor += entry.amount / total * 360;
      return `${colors[index % colors.length]} ${start}deg ${cursor}deg`;
    });
    wheel.style.background = `conic-gradient(${slices.join(',')})`;
    const vaultAmount = total * 0.02;
    const winnerAmount = total - vaultAmount;
    pot.textContent = `${number(winnerAmount)} $RARE`;
    gross.textContent = `${number(total)} $RARE entered`;
    vaultCut.textContent = `${number(vaultAmount)} $RARE`;
    winnerShare.textContent = `${number(winnerAmount)} $RARE`;
    online.textContent = `${entries.length} simulated players`;
    roundLabel.textContent = entries.length >= 3 ? `Round ${roundNumber} · next spin` : `Round ${roundNumber} · waiting`;
    roundsElement.textContent = `${wins.length} ${wins.length === 1 ? 'round' : 'rounds'}`;
    const selectedWallet = walletInput.value.trim().toLowerCase();
    const mine = entries.find((entry) => entry.wallet.toLowerCase() === selectedWallet);
    odds.textContent = mine ? `${(mine.amount / total * 100).toFixed(1)}%` : '0%';
    playerList.innerHTML = entries.map((entry, index) => `<div title="${entry.wallet}"><i style="background:${colors[index % colors.length]}"></i><span>${shortAddress(entry.wallet)}</span><strong>${number(entry.amount)} $RARE</strong><small>${(entry.amount / total * 100).toFixed(1)}%</small></div>`).join('');
    winsElement.innerHTML = wins.length ? wins.map((win) => `<div><span>Round ${win.round}</span><strong title="${win.wallet}">${shortAddress(win.wallet)}</strong><small>${number(win.prize)} $RARE</small></div>`).join('') : `<p>No completed rounds yet. Round ${roundNumber} is ${entries.length >= 3 ? 'active' : 'waiting for 3 wallets'}.</p>`;
  }

  function spin() {
    if (entries.length < 3) return;
    const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
    let ticket = Math.random() * total;
    const winner = entries.find((entry) => ((ticket -= entry.amount) <= 0)) || entries[entries.length - 1];
    const completedRound = roundNumber;
    rotation += 1440 + Math.floor(Math.random() * 360);
    wheel.style.transform = `rotate(${rotation}deg)`;
    message.textContent = 'Simulated spin only — no winner or tokens are created.';
    window.setTimeout(() => {
      wins.unshift({ round: completedRound, wallet: winner.wallet, prize: total * 0.98 });
      roundNumber += 1;
      message.textContent = `Round ${completedRound}: ${shortAddress(winner.wallet)} wins the simulated bag. Round ${roundNumber} started.`;
      render();
    }, 4200);
  }

  enter.addEventListener('click', () => {
    const wallet = walletInput.value.trim();
    if (!addressPattern.test(wallet)) {
      message.textContent = 'Paste a valid public 0x wallet address. Never enter a seed phrase or private key.';
      walletInput.focus();
      return;
    }
    const amount = Math.max(1, Math.floor(Number(amountInput.value) || 0));
    const mine = entries.find((entry) => entry.wallet.toLowerCase() === wallet.toLowerCase());
    if (mine) mine.amount += amount;
    else entries.push({ wallet, amount });
    message.textContent = `${shortAddress(wallet)} added ${number(amount)} simulated $RARE. No wallet transaction occurred.`;
    render();
  });
  document.querySelectorAll('[data-yolo-chip]').forEach((button) => button.addEventListener('click', () => { amountInput.value = button.dataset.yoloChip; }));
  window.setInterval(() => {
    if (entries.length < 3) {
      clock.textContent = 'WAITING';
      roundLabel.textContent = `Round ${roundNumber} · needs 3 wallets`;
      return;
    }
    seconds -= 1;
    if (seconds <= 0) { seconds = 300; spin(); }
    clock.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }, 1000);
  render();
})();
