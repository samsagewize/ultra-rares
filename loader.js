(() => {
  const loader = document.querySelector('[data-home-loader]');
  if (!loader) return;

  const soundButton = loader.querySelector('[data-loader-sound]');
  const startedAt = performance.now();
  let dismissed = false;
  let audioContext = null;
  let soundPlayed = false;
  let soundEnabled = true;

  try {
    const savedSound = window.localStorage.getItem('rareLoaderSound');
    if (savedSound === 'off') soundEnabled = false;
  } catch {
    // Keep the default when browser storage is unavailable.
  }

  function updateSoundButton() {
    if (!soundButton) return;
    soundButton.textContent = `Sound: ${soundEnabled ? 'on' : 'off'}`;
    soundButton.setAttribute('aria-pressed', String(soundEnabled));
  }

  function playLoadingSound(force = false) {
    if ((!soundEnabled && !force) || soundPlayed) return;
    const AudioApi = window.AudioContext || window.webkitAudioContext;
    if (!AudioApi) return;

    try {
      if (!audioContext) audioContext = new AudioApi();
      const play = () => {
        if (audioContext.state !== 'running' || soundPlayed) return;
        soundPlayed = true;
        const now = audioContext.currentTime;
        [330, 495, 660].forEach((frequency, index) => {
          const oscillator = audioContext.createOscillator();
          const gain = audioContext.createGain();
          const start = now + index * .075;
          oscillator.type = index === 2 ? 'triangle' : 'sine';
          oscillator.frequency.setValueAtTime(frequency, start);
          oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.08, start + .14);
          gain.gain.setValueAtTime(.0001, start);
          gain.gain.exponentialRampToValueAtTime(.075, start + .018);
          gain.gain.exponentialRampToValueAtTime(.0001, start + .18);
          oscillator.connect(gain).connect(audioContext.destination);
          oscillator.start(start);
          oscillator.stop(start + .2);
        });
      };

      if (audioContext.state === 'suspended') audioContext.resume().then(play).catch(() => {});
      else play();
    } catch {
      // Autoplay restrictions must never interrupt navigation.
    }
  }

  function dismissLoader() {
    if (dismissed) return;
    dismissed = true;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const minimumDisplay = reducedMotion ? 150 : 1200;
    const delay = Math.max(0, minimumDisplay - (performance.now() - startedAt));

    window.setTimeout(() => {
      loader.classList.add('is-leaving');
      document.body.classList.remove('home-loading');
      window.setTimeout(() => { loader.hidden = true; }, reducedMotion ? 180 : 600);
    }, delay);
  }

  soundButton?.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    try {
      window.localStorage.setItem('rareLoaderSound', soundEnabled ? 'on' : 'off');
    } catch {
      // The setting still works for the current page.
    }
    updateSoundButton();
    if (soundEnabled) {
      soundPlayed = false;
      playLoadingSound(true);
    }
  });

  loader.addEventListener('pointerdown', () => playLoadingSound(), { once: true });
  updateSoundButton();
  playLoadingSound();

  if (document.readyState === 'complete') dismissLoader();
  else window.addEventListener('load', dismissLoader, { once: true });
  window.setTimeout(dismissLoader, 4000);
})();
