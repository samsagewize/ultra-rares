(() => {
  const root = document.body;
  const target = Number(root.dataset.milestoneGate || 100000);
  if (!Number.isFinite(target) || target <= 0) return;

  const statusNodes = [...document.querySelectorAll('[data-milestone-status]')];
  const progressNodes = [...document.querySelectorAll('[data-milestone-progress]')];
  const gatedContent = [...document.querySelectorAll('[data-milestone-content]')];
  const openButton = document.querySelector('[data-milestone-open]');
  const label = document.querySelector('[data-milestone-label]');
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function render(marketCap) {
    const unlocked = marketCap >= target;
    const percent = Math.min(100, Math.max(0, marketCap / target * 100));
    root.classList.toggle('milestone-locked', !unlocked);
    root.classList.toggle('milestone-unlocked', unlocked);
    progressNodes.forEach((node) => { node.style.width = `${percent.toFixed(2)}%`; });
    statusNodes.forEach((node) => {
      node.textContent = unlocked
        ? `${money.format(marketCap)} market cap · milestone reached`
        : `${money.format(marketCap)} live · ${money.format(target - marketCap)} to unlock`;
    });
    gatedContent.forEach((node) => {
      if (unlocked) node.removeAttribute('inert');
      else node.setAttribute('inert', '');
    });
    if (openButton) {
      openButton.disabled = !unlocked;
      openButton.setAttribute('aria-disabled', String(!unlocked));
      openButton.textContent = unlocked ? 'Open vault' : 'Open vault — locked';
    }
    if (label) label.textContent = unlocked ? 'Vault unlocked' : 'Vault locked';
  }

  async function refresh() {
    try {
      const response = await fetch('/api/rare-market', { cache: 'no-store' });
      if (!response.ok) throw new Error('market feed unavailable');
      const payload = await response.json();
      const marketCap = Number(payload.marketCap);
      if (!Number.isFinite(marketCap)) throw new Error('market cap unavailable');
      render(marketCap);
    } catch {
      statusNodes.forEach((node) => { node.textContent = 'Live market feed retrying · remains locked'; });
      gatedContent.forEach((node) => node.setAttribute('inert', ''));
    }
  }

  refresh();
  window.setInterval(refresh, 30000);

  openButton?.addEventListener('click', () => {
    if (root.classList.contains('milestone-unlocked')) root.classList.toggle('vault-open');
  });
})();
