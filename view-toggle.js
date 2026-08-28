(() => {
  const button = document.querySelector('[data-version-toggle]');
  if (!button) return;

  const render = () => {
    const normal = document.documentElement.classList.contains('normal-version');
    button.textContent = normal ? 'Switch to pixel version' : 'Switch to normal version';
    button.setAttribute('aria-pressed', String(normal));
  };

  button.addEventListener('click', () => {
    const normal = document.documentElement.classList.toggle('normal-version');
    try { localStorage.setItem('ultra-rares-view', normal ? 'normal' : 'pixel'); } catch (_) {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
    render();
  });

  render();
})();
