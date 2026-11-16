import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const motionSource = await readFile(new URL('../public/opening-motion.js', import.meta.url), 'utf8');
const source = await readFile(new URL('../public/opening.js', import.meta.url), 'utf8').catch(() => '');

function runOpening({ seen = false, reduced = false, canvasAvailable = true } = {}) {
  const classes = new Set();
  const listeners = new Map();
  const frames = new Map();
  const timers = new Map();
  let id = 0;
  const center = { inert: false };
  const creators = { inert: false };
  const app = { inert: false };
  const context = new Proxy({}, { get: (_, key) => ['createRadialGradient', 'createLinearGradient'].includes(key) ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
  const canvas = { getContext: () => canvasAvailable ? context : null, style: {} };
  const welcome = { hidden: false, classList: { add: (x) => classes.add(x), remove: (x) => classes.delete(x) }, querySelector: (s) => s === '.welcome-center' ? center : creators };
  const storage = new Map(seen ? [['dshs-opening-2.7.3-seen', '1']] : []);
  const window = { innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, matchMedia: () => ({ matches: reduced }), addEventListener: (n, f) => listeners.set(n, f), removeEventListener: (n) => listeners.delete(n), sessionStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) } };
  vm.runInNewContext(motionSource, { window, Math });
  vm.runInNewContext(source, { window, document: { hidden: false, querySelector: (s) => ({ '#welcome': welcome, '#opening-canvas': canvas, '#app': app })[s], addEventListener: (n, f) => listeners.set(n, f), removeEventListener: (n) => listeners.delete(n) }, performance: { now: () => 0 }, requestAnimationFrame: (f) => { frames.set(++id, f); return id; }, cancelAnimationFrame: (n) => frames.delete(n), setTimeout: (f) => { timers.set(++id, f); return id; }, clearTimeout: (n) => timers.delete(n), Math });
  return { window, classes, center, creators, app, frames, timers, storage, listeners };
}

test('opening finishes without waiting for panorama or trapping the start controls', () => {
  const run = runOpening();
  assert.ok(run.window.DSHSOpening, 'opening controller is installed');
  assert.ok(run.classes.has('is-opening'));
  assert.equal(run.center.inert, true);
  assert.equal(run.app.inert, true);
  for (const [id, callback] of [...run.timers]) { run.timers.delete(id); callback(); }
  assert.equal(run.classes.has('is-opening'), false);
  assert.equal(run.center.inert, false);
  assert.equal(run.creators.inert, false);
  assert.equal(run.storage.get('dshs-opening-2.7.3-seen'), '1');
  run.window.DSHSOpening.release();
  assert.equal(run.app.inert, false);
  assert.equal(run.frames.size, 0);
  assert.equal(run.listeners.size, 0);
});

test('return visits, reduced motion and unavailable canvas immediately expose the title', () => {
  for (const options of [{ seen: true }, { reduced: true }, { canvasAvailable: false }]) {
    const run = runOpening(options);
    assert.ok(run.window.DSHSOpening);
    assert.equal(run.classes.has('is-opening'), false);
    assert.equal(run.center.inert, false);
    assert.equal(run.frames.size, 0);
  }
});
