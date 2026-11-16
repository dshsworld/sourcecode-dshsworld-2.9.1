import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = name => readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
class Element extends EventTarget {
  children = []; style = {}; dataset = {}; attributes = {}; value = ''; hidden = false;
  classList = { add() {}, remove() {}, toggle() {} };
  constructor() {
    super();
    const fields = {};
    this.elements = new Proxy(fields, { get: (target, name) => target[name] ||= new Element() });
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelector() { return new Element(); }
  querySelectorAll() { return []; }
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
}

test('actual app handlers preview photo correction, place an anchored arrow, and keep A-to-B navigation', async () => {
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const document = Object.assign(new EventTarget(), { body: new Element(), querySelector: get, querySelectorAll: () => [], getElementById: id => get('#' + id), createElement: () => new Element() });
  const window = new EventTarget();
  const context = vm.createContext({ window, document, EventTarget, Event, CustomEvent, FormData, URLSearchParams, console, localStorage: { getItem() {}, removeItem() {} },
    requestAnimationFrame() {}, setTimeout() {}, history: { replaceState() {} }, location: { hash: '' },
    fetch: async (url, config) => {
      if (url === '/api/visits') return { ok: true, json: async () => ({ count: 1 }) };
      requests.push({ url, method: config.method, headers: config.headers, body: JSON.parse(config.body) });
      return { ok: true, json: async () => ({ ...JSON.parse(config.body), positioned: 2 }) };
    },
  });
  vm.runInContext(read('viewer.js'), context);
  const ActualViewer = window.PanoramaViewer;
  let imageLoads = 0;
  let view = { yaw: 155, pitch: -12, hfov: 68 };
  class Viewer extends EventTarget {
    static pointToAngles = ActualViewer.pointToAngles;
    static pickNavigationLink = ActualViewer.pickNavigationLink;
    static arrivalView = ActualViewer.arrivalView;
    imageOrientation={yaw:0,pitch:0};
    setImageOrientation(yaw,pitch) { this.imageOrientation={yaw,pitch}; }
    imageToWorldAngles(point) { return ActualViewer.rotateAngles(point,this.imageOrientation); }
    worldToImageAngles(point) { return ActualViewer.rotateAngles(point,this.imageOrientation,true); }
    getView() { return { ...view }; }
    setView(yaw, pitch, hfov) { view = { yaw, pitch, hfov }; }
    setHotspots(links) { this.hotspots = links; }
    setPlaceholderHue() {}
    async load() { imageLoads++; }
  }
  window.PanoramaViewer = Viewer;
  vm.runInContext(read('arrow-editor.js'), context);
  const requests = [];
  vm.runInContext(read('app.js').replace('  boot();', '  window.testApp = { state, viewer, openArrowEditor, arrowEditor, setViewerLinks, openEdit, arrowNodeLabel };'), context);
  const app = window.testApp;
  assert.equal(app.arrowNodeLabel({ id:'M4-07',title:'긴 장소 이름',building:'본관',floor:'4F' }), '본관 4층 7번');
  assert.equal(app.arrowNodeLabel({ id:'G3-S2',title:'계단 앞',building:'궁리관',floor:'3F' }), '궁리관 3층 S2');
  assert.equal(app.arrowNodeLabel({ id:'O-08',title:'정문',building:'야외',floor:'OUT' }), '야외 8번');
  const scenes = ['A','B','C'].map(id => ({ id, title: id, building: '본관', floor: '1F', nodeType: 'hall', image4k: id + '.jpg', initialYaw: 0, initialPitch: 0 }));
  Object.assign(scenes[0], { imageYaw: 60, imagePitch: 24 });
  const links = [{ id: 7, fromScene: 'A', toScene: 'B', label: 'B', yaw: 35, pitch: -20, positioned: 1, kind: 'walk' }, { id: 8, fromScene: 'B', toScene: 'A', label: 'A', yaw: -140, pitch: -18, positioned: 1, kind: 'walk' }];
  Object.assign(app.state, { admin: true, csrf: 'test-csrf', currentSceneId: 'A', tour: { scenes, links }, scenes: new Map(scenes.map(s => [s.id,s])) });
  app.viewer.setImageOrientation(60,24);
  app.openEdit();
  get('#edit-image-yaw').value = '110';
  get('#edit-image-pitch').value = '-35';
  get('#edit-image-pitch').dispatchEvent(new Event('input'));
  const preview = ActualViewer.rotateAngles(links[0], { yaw:110,pitch:-35 });
  assert.ok(Math.abs(app.viewer.hotspots[0].yaw-preview.yaw)<1e-9);
  assert.ok(Math.abs(app.viewer.hotspots[0].pitch-preview.pitch)<1e-9);
  assert.equal(links[0].yaw,35,'preview must not mutate stored arrow anchors');
  get('#edit-dialog').close();
  assert.equal(app.viewer.imageOrientation.yaw,60,'cancel restores persisted photo correction');
  assert.equal(app.viewer.imageOrientation.pitch,24);
  app.openArrowEditor(7);
  assert.equal(app.viewer.hotspots[0].displayLabel,'본관 1층 B');
  assert.equal(get('#arrow-edit-target').children[1].textContent,'본관 1층 B');
  const focused = ActualViewer.rotateAngles(links[0], { yaw:60,pitch:24 });
  assert.ok(Math.abs(view.yaw-focused.yaw)<1e-9,'the editor focuses the rotated arrow');
  assert.equal(get('#arrow-editor').hidden, false);
  app.viewer.hotspots[0].onClick();
  assert.equal(app.arrowEditor.selected.toScene, 'B');
  assert.equal(app.state.currentSceneId, 'A', 'selecting an arrow must not navigate');
  const beforeView = { ...view };
  const point = ActualViewer.pointToAngles(view, 260, 460, 390, 844);
  const anchor = ActualViewer.rotateAngles(point, { yaw:60,pitch:24 }, true);
  app.viewer.dispatchEvent(new CustomEvent('panorama-click', { detail: { ...point, x: 260, y: 460, width: 390, height: 844, pointerType: 'touch' } }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/admin/links/7');
  assert.equal(requests[0].method, 'PATCH');
  assert.equal(requests[0].headers['X-CSRF-Token'], 'test-csrf');
  assert.deepEqual(Object.keys(requests[0].body).sort(), ['pitch', 'yaw']);
  assert.ok(Math.abs(links[0].yaw-anchor.yaw)<1e-9);
  assert.ok(Math.abs(links[0].pitch-anchor.pitch)<1e-9);
  assert.ok(Math.abs(app.viewer.hotspots[0].yaw-point.yaw)<1e-9,'rendered arrow follows the clicked photo point');
  assert.ok(Math.abs(app.viewer.hotspots[0].pitch-point.pitch)<1e-9);
  assert.equal(links[0].toScene, 'B');
  assert.equal(links[1].yaw, -140, 'reverse arrow is untouched');
  assert.equal(app.viewer.hotspots[0].pinned, true);
  assert.equal(imageLoads, 0, 'saving must not reload the panorama');
  assert.deepEqual(view, beforeView, 'saving must not reset the camera');
  assert.equal(app.arrowEditor.phase, 'select');
  get('#arrow-edit-done').dispatchEvent(new Event('click'));
  assert.equal(get('#arrow-editor').hidden, true);
  app.viewer.hotspots[0].onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.state.currentSceneId, 'B', 'the edited arrow still leads to B');
  assert.equal(app.viewer.imageOrientation.yaw,0,'the next photo uses its own correction');
  assert.equal(app.viewer.imageOrientation.pitch,0);
  assert.equal(imageLoads, 1);
});
