import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const file = new URL('../public/arrow-editor.js', import.meta.url);
const window = {};
vm.runInNewContext(existsSync(file) ? readFileSync(file, 'utf8') : '', { window, Number });
function fixture(save) {
  assert.equal(typeof window.ArrowPositionEditor, 'function');
  const links = [
    { id: 11, fromScene: 'A', toScene: 'B', yaw: 20, pitch: -15, positioned: 1 },
    { id: 12, fromScene: 'B', toScene: 'A', yaw: -160, pitch: -20, positioned: 1 },
    { id: 13, fromScene: 'A', toScene: 'C', yaw: 45, pitch: -10, positioned: 0 },
  ];
  const writes = [];
  let authorized = true;
  const editor = new window.ArrowPositionEditor({
    canEdit: () => authorized,
    getLinks: id => links.filter(link => link.fromScene === id),
    savePosition: async (id, point) => { writes.push({ id, ...point }); return save?.(id, point); },
    onChange() {},
  });
  return { editor, links, writes, deny: () => { authorized = false; } };
}

test('selecting an existing arrow then clicking the photo saves only that arrow position', async () => {
  const { editor, links, writes } = fixture();
  const before = JSON.stringify(links);
  editor.open('A');
  assert.equal(await editor.place({ yaw: 80, pitch: -30 }), false, 'a target arrow must be selected');
  assert.equal(editor.select(12), false, 'cannot move another scene’s arrow');
  assert.equal(editor.select(11), true);
  assert.equal(editor.selected.toScene, 'B');
  assert.equal(await editor.place({ yaw: 72.34567, pitch: -44.56789 }), true);
  assert.deepEqual(writes, [{ id: 11, yaw: 72.34567, pitch: -44.56789 }]);
  assert.equal(JSON.stringify(links), before, 'controller never replaces destination or reverse links');
  assert.equal(editor.phase, 'select', 'ready to correct the next arrow without reloading the photo');
  assert.equal(editor.preview, null);
  assert.equal(editor.select(13), true, 'unplaced arrows can be selected from the list');
});

test('pending saves prevent double writes, navigation closure and changing targets', async () => {
  let release;
  const { editor, writes } = fixture(() => new Promise(resolve => { release = resolve; }));
  editor.open('A'); editor.select(11);
  const saving = editor.place({ yaw: -38, pitch: 12 });
  assert.equal(editor.phase, 'saving');
  assert.equal(editor.preview.yaw, -38);
  assert.equal(editor.select(13), false);
  assert.equal(editor.close(), false);
  assert.equal(await editor.place({ yaw: 99, pitch: 1 }), false);
  release(); await saving;
  assert.equal(writes.length, 1);
  assert.equal(editor.close(), true);
  assert.equal(editor.phase, 'off');
});

test('failed saves restore the old visual position, keep the target and allow retry', async () => {
  let fail = true;
  const { editor } = fixture(() => { if (fail) throw new Error('연결이 끊겼습니다.'); });
  editor.open('A'); editor.select(11);
  assert.equal(await editor.place({ yaw: 20, pitch: -42 }), false);
  assert.equal(editor.phase, 'place');
  assert.equal(editor.selected.id, 11);
  assert.equal(editor.preview, null);
  assert.match(editor.message, /연결이 끊겼습니다/);
  fail = false;
  assert.equal(await editor.place({ yaw: 20, pitch: -42 }), true);
});

test('leaving edit mode never saves a selection, and signed-out visitors cannot edit', async () => {
  const { editor, writes, deny } = fixture();
  editor.open('A'); editor.select(11); editor.close();
  assert.equal(await editor.place({ yaw: 20, pitch: -42 }), false);
  deny();
  assert.equal(editor.open('A'), false);
  assert.equal(writes.length, 0);
});
