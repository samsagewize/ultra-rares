(() => {
  const button = document.querySelector('[data-scene-toggle]');
  const scene = document.querySelector('.rare-street');
  if (!button || !scene) return;

  let city = false;
  try { city = localStorage.getItem('ultra-rares-scene') === 'city'; } catch (_) {}

  const render = () => {
    scene.classList.toggle('rare-museum', !city);
    button.textContent = city ? 'Switch to museum' : 'Switch to city';
    button.setAttribute('aria-pressed', String(city));
  };

  button.addEventListener('click', () => {
    city = !city;
    try { localStorage.setItem('ultra-rares-scene', city ? 'city' : 'museum'); } catch (_) {}
    render();
  });

  render();
})();
