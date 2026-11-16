import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/opening-motion.js', import.meta.url), 'utf8').catch(() => '');
const window = {};
vm.runInNewContext(source, { window, Math });
const motion = window.DSHSOpeningMotion;
const distance = (a, b) => Math.hypot(...a.map((n, i) => n - b[i]));

test('camera and light move continuously through the whole shot, including the pullback', () => {
  assert.ok(motion, 'shared flight model must be available');
  let previous = motion.sample(0);
  let previousVelocity = [0, 0, 0];
  for (let i = 1; i <= 720; i++) {
    const frame = motion.sample(i / 120);
    const dot = frame.forward.reduce((n, value, axis) => n + value * previous.forward[axis], 0);
    const turn = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
    assert.ok(turn < 1, `camera changes direction by ${turn}° at ${i / 120}s`);
    const velocity = frame.camera.map((n, axis) => (n - previous.camera[axis]) * 120);
    assert.ok(distance(velocity, previousVelocity) < 2, `camera velocity jumps at ${i / 120}s`);
    assert.ok(distance(frame.target, previous.target) < 0.5, 'light must not jump between paths');
    previous = frame;
    previousVelocity = velocity;
  }
});

test('the shot closes in, pulls back, and comes to rest before the afterimage', () => {
  assert.ok(motion);
  const start = motion.sample(0);
  const close = motion.sample(2);
  const wide = motion.sample(motion.bloomAt);
  assert.ok(distance(close.camera, close.target) < distance(start.camera, start.target) * 0.7);
  assert.ok(distance(wide.camera, wide.target) > distance(close.camera, close.target) * 3);
  const settled = motion.sample(motion.bloomAt + 1);
  assert.ok(distance(wide.camera, settled.camera) < 1e-8, 'no drifting camera behind the title');
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    for (let time = 0; time <= motion.bloomAt; time += 1 / 60) {
      const frame = motion.sample(time);
      const head = motion.project(frame, frame.target, width, height);
      assert.ok(head && head.every(Number.isFinite));
      assert.ok(head[0] > width * .1 && head[0] < width * .9, 'light stays inside the frame');
      assert.ok(head[1] > height * .05 && head[1] < height * .8);
    }
  }
});
