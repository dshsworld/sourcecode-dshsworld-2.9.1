"use strict";

// One uninterrupted camera shot. Distance along the curve, rather than equal
// time per waypoint, controls the flight. There are no tangent discontinuities.
(() => {
  const clamp = n => Math.max(0, Math.min(1, n));
  const ease = n => { const t = clamp(n); return t * t * t * (t * (t * 6 - 15) + 10); };
  const subtract = (a, b) => a.map((n, i) => n - b[i]);
  const dot = (a, b) => a.reduce((n, value, i) => n + value * b[i], 0);
  const unit = v => { const length = Math.hypot(...v) || 1; return v.map(n => n / length); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const curve = t => {
    const u = 1 - t;
    return [
      -15 * u ** 3 - 9 * u * u * t + 66 * u * t * t,
      -4 * u ** 3 + 24 * u * u * t + 6 * u * t * t,
      60 * u * u * t + 117 * u * t * t + 60 * t ** 3,
    ];
  };
  // Extend the same polynomial behind the starting point so that the camera
  // rail does not acquire a corner when it catches up with the light.
  const lengths = [0];
  let last = curve(-.5);
  for (let i = 1; i <= 2000; i++) {
    const point = curve((i - 500) / 1000);
    lengths.push(lengths[i - 1] + Math.hypot(...subtract(point, last)));
    last = point;
  }
  const length = lengths[1500] - lengths[500];
  const point = distance => {
    const target = Math.max(0, Math.min(lengths[2000], distance + lengths[500]));
    let lo = 0;
    let hi = 2000;
    while (hi - lo > 1) {
      const mid = (hi + lo) >>> 1;
      if (lengths[mid] < target) lo = mid;
      else hi = mid;
    }
    const fraction = (target - lengths[lo]) / (lengths[hi] - lengths[lo]);
    return curve((lo + fraction - 500) / 1000);
  };
  const bloomAt = 3.85;
  const sample = time => {
    const travel = ease((time - .1) / 3.75);
    const pursuit = ease((time - .2) / 1.7);
    const pullback = ease((time - 2.4) / 1.45);
    const distance = travel * length;
    const target = point(distance);
    // The camera occupies an earlier point on the rail, instead of being
    // rigidly attached to the head's instantaneous tangent. It anticipates
    // the bend gently, then recedes into the final wide composition.
    const camera = point(distance - (10 - pursuit * 6 + pullback * 15));
    camera[0] += 2.7 * (1 - pursuit * .55) + pullback * 5;
    camera[1] += .7 + pullback * 3.5;
    camera[2] -= pullback * 8;
    const aim = point(distance + 4.8 * (1 - pullback));
    const forward = unit(subtract(aim, camera));
    const right = unit(cross([0, 1, 0], forward));
    const up = cross(forward, right);
    return { target, camera, forward, right, up, distance, pursuit, pullback,
      focal: .92 + pursuit * .25 - pullback * .34 };
  };
  const project = (shot, world, width, height) => {
    const relative = subtract(world, shot.camera);
    const depth = dot(relative, shot.forward);
    if (depth < 1) return null;
    const focal = Math.min(width, height) * shot.focal;
    return [width * .5 + dot(relative, shot.right) * focal / depth,
      height * .35 - dot(relative, shot.up) * focal / depth, depth];
  };
  window.DSHSOpeningMotion = { sample, point, project, ease, bloomAt, duration: 7200 };
})();
