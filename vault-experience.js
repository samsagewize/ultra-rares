(() => {
  const journey = document.querySelector('[data-vault-journey]');
  if (!journey) return;

  let ticking = false;

  function updateVault() {
    ticking = false;
    const rect = journey.getBoundingClientRect();
    const travel = Math.max(1, journey.offsetHeight - window.innerHeight);
    const progress = Math.min(1, Math.max(0, -rect.top / travel));
    const eased = 1 - Math.pow(1 - progress, 3);

    journey.style.setProperty('--vault-progress', progress.toFixed(4));
    journey.style.setProperty('--vault-scale', (0.3 + eased * 2.16).toFixed(4));
    journey.style.setProperty('--vault-copy-opacity', Math.max(0, 1 - progress * 2.6).toFixed(4));
    journey.style.setProperty('--vault-sign-opacity', Math.max(0, Math.min(1, (progress - .86) / .11)).toFixed(4));
    journey.style.setProperty('--vault-meter', `${Math.round(progress * 100)}%`);
  }

  function requestUpdate() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(updateVault);
  }

  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate);
  updateVault();
})();
