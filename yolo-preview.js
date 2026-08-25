(() => {
  const wheel = document.querySelector('[data-yolo-wheel]');
  if (!wheel) return;
  const clock = document.querySelector('[data-yolo-clock]');
  const pot = document.querySelector('[data-yolo-pot]');
  const online = document.querySelector('[data-yolo-online]');
  const amountInput = document.querySelector('[data-yolo-amount]');
  const enter = document.querySelector('[data-yolo-enter]');
  const odds = document.querySelector('[data-yolo-odds]');
  const message = document.querySelector('[data-yolo-message]');
  const playerList = document.querySelector('[data-yolo-players]');
  const colors = ['#b6ff00', '#754cff', '#36d6ff', '#ff4c72', '#f4f1e9'];
  let entries = [
    { wallet: '0x62F…9612', amount: 72000 },
    { wallet: '0xA91…14C0', amount: 48000 },
    { wallet: '0x8DD…7B21', amount: 35000 },
    { wallet: '0x1F0…A983', amount: 25000 },
  ];
  let seconds = 300;
  let rotation = 0;

  const number = (value) => Math.round(value).toLocaleString('en-US');
  function render() {
    const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
    let cursor = 0;
    const slices = entries.map((entry, index) => {
      const start = cursor;
      cursor += entry.amount / total * 360;
      return `${colors[index % colors.length]} ${start}deg ${cursor}deg`;
    });
    wheel.style.background = `conic-gradient(${slices.join(',')})`;
    pot.textContent = `${number(total)} $RARE`;
    online.textContent = `${entries.length} simulated players`;
    const mine = entries.find((entry) => entry.wallet === 'YOU');
    odds.textContent = mine ? `${(mine.amount / total * 100).toFixed(1)}%` : '0%';
    playerList.innerHTML = entries.map((entry, index) => `<div><i style="background:${colors[index % colors.length]}"></i><span>${entry.wallet}</span><strong>${number(entry.amount)} $RARE</strong><small>${(entry.amount / total * 100).toFixed(1)}%</small></div>`).join('');
  }

  function spin() {
    rotation += 1440 + Math.floor(Math.random() * 360);
    wheel.style.transform = `rotate(${rotation}deg)`;
    message.textContent = 'Simulated spin only — no winner or tokens are created.';
    window.setTimeout(() => { message.textContent = 'New preview round. Wallet deposits remain disabled.'; }, 4200);
  }

  enter.addEventListener('click', () => {
    const amount = Math.max(1, Math.floor(Number(amountInput.value) || 0));
    const mine = entries.find((entry) => entry.wallet === 'YOU');
    if (mine) mine.amount += amount;
    else entries.push({ wallet: 'YOU', amount });
    message.textContent = `${number(amount)} simulated $RARE added. No wallet transaction occurred.`;
    render();
  });
  document.querySelectorAll('[data-yolo-chip]').forEach((button) => button.addEventListener('click', () => { amountInput.value = button.dataset.yoloChip; }));
  window.setInterval(() => {
    seconds -= 1;
    if (seconds <= 0) { seconds = 300; spin(); }
    clock.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }, 1000);
  render();
})();
