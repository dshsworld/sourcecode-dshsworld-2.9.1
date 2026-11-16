"use strict";

(() => {
  const audio = document.querySelector("#intro-sound");
  const welcome = document.querySelector("#welcome");
  if (!audio || !welcome) return;
  let active = false;
  let started = 0;
  let duration = 5200;
  audio.volume = .36;

  const stop = () => {
    active = false;
    audio.pause();
    welcome.removeEventListener("pointerdown", unlock);
  };
  const align = () => {
    const elapsed = performance.now() - started;
    if (!active || elapsed >= duration) { stop(); return false; }
    try { audio.currentTime = Math.max(0, elapsed / 1000); } catch { /* Retry after metadata. */ }
    return true;
  };
  const play = () => {
    if (!align()) return;
    audio.play().then(() => {
      if (!active || performance.now() - started >= duration) audio.pause();
      else align();
    }).catch(() => { /* The first interaction may unlock browser audio. */ });
  };
  const unlock = () => {
    if (performance.now() - started >= duration) { stop(); return; }
    if (audio.paused) play();
  };
  audio.addEventListener("loadedmetadata", () => { if (active && !audio.paused) align(); });
  window.DSHSIntroSound = {
    start(time, length) {
      started = time;
      duration = length;
      active = true;
      welcome.addEventListener("pointerdown", unlock);
      play();
    },
    stop,
  };
})();
