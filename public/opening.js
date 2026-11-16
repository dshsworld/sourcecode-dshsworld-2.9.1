"use strict";

// A short, local animation; no video request competes with panorama loading.
(() => {
  const welcome = document.querySelector("#welcome");
  const canvas = document.querySelector("#opening-canvas");
  if (!welcome || !canvas) return;
  const center = welcome.querySelector(".welcome-center");
  const creators = welcome.querySelector(".welcome-creators");
  const app = document.querySelector("#app");
  const context = canvas.getContext("2d", { alpha: true });
  const motion = window.DSHSOpeningMotion;
  const duration = motion?.duration || 7200;
  let frame = 0;
  let timer = 0;
  let stopped = false;
  let canDraw = false;
  let width = 1;
  let height = 1;
  let ratio = 1;
  let seen = false;
  try { seen = window.sessionStorage.getItem("dshs-opening-2.7.3-seen") === "1"; } catch { /* Storage may be disabled. */ }

  const resize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  const cleanup = () => {
    stopped = true;
    window.DSHSIntroSound?.stop();
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    window.removeEventListener("resize", resize);
    window.removeEventListener("pagehide", cleanup);
    document.removeEventListener("visibilitychange", visibilityChanged);
  };
  const finish = () => {
    if (!stopped && canDraw) draw(duration / 1000);
    cleanup();
    welcome.classList.remove("is-opening");
    center.inert = false;
    creators.inert = false;
    try { window.sessionStorage.setItem("dshs-opening-2.7.3-seen", "1"); } catch { /* Optional session preference. */ }
  };
  const release = () => {
    cleanup();
    app.inert = false;
  };
  const visibilityChanged = () => {
    // Returning from a hidden tab must never leave a half-finished intro.
    if (document.hidden) finish();
  };
  window.DSHSOpening = { release };
  app.inert = true;
  if (seen || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !context || !motion) {
    finish();
    return;
  }

  const smooth = motion.ease;
  const hash = (n) => { const value = Math.sin(n * 127.1 + 311.7) * 43758.5453; return value - Math.floor(value); };
  const stars = Array.from({ length: 230 }, (_, i) => [(hash(i + 1) - .5) * 90, (hash(i + 302) - .5) * 54, hash(i + 622) * 120 - 20]);
  const glow = (x, y, radius, alpha) => {
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(242,226,255,${alpha})`);
    gradient.addColorStop(.08, `rgba(206,156,255,${alpha * .8})`);
    gradient.addColorStop(.3, `rgba(147,77,255,${alpha * .24})`);
    gradient.addColorStop(1, "rgba(109,38,235,0)");
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  };
  function draw(time) {
    context.clearRect(0, 0, width, height);
    const scale = Math.min(width, height);
    const shot = motion.sample(time);
    const shutter = motion.sample(Math.max(0, time - 1 / 90));
    const project = point => motion.project(shot, point, width, height);
    const flight = smooth((time - .1) / .55) * (1 - smooth((time - motion.bloomAt + .06) / .42));
    const centerX = width * .5;
    const centerY = height * .35;
    const fieldOpacity = 1 - smooth((time - motion.bloomAt) / 1.4) * .85;
    context.globalCompositeOperation = "source-over";
    // Short exposure trails use the actual camera displacement, including
    // its bank around the bend; they never radiate in an unrelated direction.
    for (const star of stars) {
      const current = project(star);
      if (!current) continue;
      const [x, y, depth] = current;
      if (x < -40 || x > width + 40 || y < -40 || y > height + 40) continue;
      const previous = motion.project(shutter, star, width, height) || current;
      const dx = previous[0] - x;
      const dy = previous[1] - y;
      const length = Math.hypot(dx, dy);
      const exposure = Math.min(1, 30 / (length || 1));
      const near = 1 - Math.min(1, depth / 95);
      context.strokeStyle = `rgba(209,190,246,${(.06 + near * .19) * fieldOpacity * smooth((depth - 1) / 5)})`;
      context.lineWidth = .55 + near * .6;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + dx * exposure + .25, y + dy * exposure);
      context.stroke();
    }
    context.globalCompositeOperation = "lighter";
    glow(centerX, height * .4, scale * .65, .08);
    if (flight > .001) {
      const trailLength = 13 + shot.pullback * 24;
      const points = [];
      for (let i = 0; i <= 90; i++) {
        const distance = Math.max(0, shot.distance - trailLength * (1 - i / 90));
        points.push(project(motion.point(distance)));
      }
      const head = project(shot.target);
      const first = points.find(point => point);
      const [headX, headY, headDepth] = head;
      // A single tapered luminous ribbon, with a diffuse halo instead of
      // several oscillating wires. The curve itself supplies all the motion.
      if (first) {
        for (const [lineWidth, opacity] of [[24, .04], [7, .18], [1.7, .9]]) {
          const gradient = context.createLinearGradient(first[0], first[1], headX + .01, headY);
          gradient.addColorStop(0, "rgba(143,73,241,0)");
          gradient.addColorStop(.3, `rgba(154,89,245,${flight * opacity * .35})`);
          gradient.addColorStop(.8, `rgba(201,155,255,${flight * opacity * .8})`);
          gradient.addColorStop(1, `rgba(255,244,255,${flight * opacity})`);
          context.strokeStyle = gradient;
          context.lineWidth = lineWidth * (1 + shot.pursuit * .3 - shot.pullback * .35);
          context.lineCap = "round";
          context.lineJoin = "round";
          context.beginPath();
          let drawing = false;
          for (const point of points) {
            if (!point) { drawing = false; continue; }
            if (!drawing) context.moveTo(point[0], point[1]);
            else context.lineTo(point[0], point[1]);
            drawing = true;
          }
          context.stroke();
        }
      }
      const apparentSize = scale * shot.focal / headDepth;
      glow(headX, headY, scale * .045 + apparentSize * .38, flight * .8);
      context.fillStyle = `rgba(255,249,255,${flight})`;
      context.beginPath();
      context.ellipse(headX, headY, 1.5 + apparentSize * .016, 1.2 + apparentSize * .009, -.3, 0, Math.PI * 2);
      context.fill();
      for (let i = 0; i < 42; i++) {
        const age = hash(i + 11);
        const point = motion.point(Math.max(0, shot.distance - age * 15));
        point[0] += (hash(i + 130) - .5) * age * 1.4;
        point[1] += (hash(i + 240) - .5) * age * 1.4;
        const projected = project(point);
        if (!projected) continue;
        const [x, y, depth] = projected;
        const opacity = flight * (1 - age) * .6 * smooth((depth - 1) / 5);
        context.fillStyle = `rgba(211,169,255,${opacity})`;
        context.beginPath();
        context.arc(x, y, .5 + hash(i) * .9, 0, Math.PI * 2);
        context.fill();
      }
    }
    // The settled camera and the light share the same final composition.
    // The ribbon releases into a broad, soft wave before the wing afterimage.
    const age = time - motion.bloomAt;
    if (age > 0 && age < 3) {
      const bloom = smooth(age / .18) * Math.exp(-age * 2.5);
      const radius = scale * (.15 + Math.pow(age, .7) * 3.1);
      const veil = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
      veil.addColorStop(0, `rgba(234,214,255,${bloom * .48})`);
      veil.addColorStop(.28, `rgba(190,139,255,${bloom * .33})`);
      veil.addColorStop(.65, `rgba(128,63,226,${bloom * .17})`);
      veil.addColorStop(1, "rgba(93,34,181,0)");
      context.fillStyle = veil;
      context.fillRect(0, 0, width, height);
      glow(centerX, centerY, radius, bloom * .8);
      for (let i = 0; i < 64; i++) {
        const angle = hash(i + 703) * Math.PI * 2;
        const distance = scale * (.12 + hash(i + 902) * .85) * Math.pow(age, .8);
        const x = centerX + Math.cos(angle) * distance * 1.5;
        const y = centerY + Math.sin(angle) * distance * .6;
        const opacity = smooth(age / .22) * Math.exp(-age * (1.4 + hash(i) * 2)) * .4;
        context.strokeStyle = `rgba(211,172,255,${opacity})`;
        context.lineWidth = .6 + hash(i + 1001) * .8;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + Math.cos(angle) * (5 + 18 * Math.exp(-age * 2)), y + Math.sin(angle) * 4);
        context.stroke();
      }
    }
    context.globalCompositeOperation = "source-over";
  }

  center.inert = true;
  creators.inert = true;
  welcome.classList.add("is-opening");
  resize();
  canDraw = true;
  const started = performance.now();
  window.DSHSIntroSound?.start(started, duration);
  const render = (now) => {
    if (stopped) return;
    const elapsed = now - started;
    draw(elapsed / 1000);
    if (elapsed >= duration) finish();
    else frame = requestAnimationFrame(render);
  };
  window.addEventListener("resize", resize);
  window.addEventListener("pagehide", cleanup);
  document.addEventListener("visibilitychange", visibilityChanged);
  frame = requestAnimationFrame(render);
  // A separate clock also reveals controls if frames are throttled.
  timer = setTimeout(finish, duration + 100);
})();
