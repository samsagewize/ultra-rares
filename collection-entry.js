(() => {
  const entry = document.querySelector('[data-collection-entry]');
  const button = document.querySelector('[data-enter-district]');
  if (!entry || !button) return;

  const enter = () => {
    entry.classList.add('is-leaving');
    document.body.classList.remove('entry-gated');
    window.setTimeout(() => entry.remove(), 700);
  };

  button.addEventListener('click', enter);
  entry.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target === entry) enter();
  });
})();
