import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/intro-sound.js', import.meta.url), 'utf8').catch(() => '');
function setup() {
  let clock = 0;
  let rejectPlayback = true;
  const handlers = new Map();
  const audio = { paused: true, currentTime: 0, volume: 1, play: () => rejectPlayback ? Promise.reject(new Error('Autoplay blocked')) : (audio.paused = false, Promise.resolve()), pause: () => { audio.paused = true; }, addEventListener: (n, f) => handlers.set(`audio:${n}`, f) };
  const welcome = { addEventListener: (n, f) => handlers.set(`welcome:${n}`, f), removeEventListener: (n) => handlers.delete(`welcome:${n}`) };
  const window = {};
  vm.runInNewContext(source, {window, performance: {now: () => clock}, document: {querySelector: s => ({'#intro-sound':audio,'#welcome':welcome})[s]}});
  return { window, audio, handlers, advance: t => {clock=t;}, allow: () => {rejectPlayback=false;} };
}

test('blocked intro sound can be enabled at the current animation time', async () => {
  const run = setup();
  assert.ok(run.window.DSHSIntroSound, 'intro sound controller exists');
  run.window.DSHSIntroSound.start(0, 5200);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(run.audio.paused, true);
  run.advance(3100);
  run.allow();
  run.handlers.get('welcome:pointerdown')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(run.audio.currentTime, 3.1);
  assert.equal(run.audio.paused, false);
  run.window.DSHSIntroSound.stop();
  assert.equal(run.audio.paused, true);
  assert.equal(run.handlers.has('welcome:pointerdown'), false);
});

test('a late gesture cannot restart intro sound after the opening ends', () => {
  const run = setup();
  assert.ok(run.window.DSHSIntroSound);
  run.allow();
  run.window.DSHSIntroSound.start(0, 5200);
  run.advance(5500);
  run.handlers.get('welcome:pointerdown')();
  assert.equal(run.audio.paused, true);
});
