import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function setup(width, height) {
  const decodes = [], canvases = [], encodes = [];
  const header = new Uint8Array(64);
  header.set([255,216,255,192,0,17,8,height>>8,height&255,width>>8,width&255]);
  const source = new File([header], 'panorama.jpg', { type: 'image/jpeg' });
  const window = {};
  vm.runInNewContext(readFileSync(new URL('../public/upload.js', import.meta.url), 'utf8'), {
    window, File, Blob, FormData, Uint8Array, DataView, Promise,
    document: { createElement: () => {
      const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toBlob(callback, type, quality) {
        encodes.push({ width: this.width, height: this.height, quality });
        const dimensions = [this.width,this.height];
        queueMicrotask(() => callback(new Blob([new Uint8Array(dimensions[0] / 4)], { type })));
      } };
      canvases.push(canvas); return canvas;
    } },
    createImageBitmap: async (blob, options) => { decodes.push(options); return { width: options?.resizeWidth || width, height: options?.resizeHeight || height, close() {} }; },
  });
  const body = () => { const data = new FormData(); data.set('panorama',source); data.set('id','M1-02'); return data; };
  return { window, source, body, decodes, canvases, encodes };
}

test('large JPEGs decode directly at 8K and do not allocate a second full-size copy', async () => {
  const run = setup(16384,8192);
  const data = run.body();
  await run.window.preparePanoramaUpload(data, () => {});
  assert.equal(run.decodes[0]?.resizeWidth,8192);
  assert.equal(run.decodes[0]?.resizeHeight,4096);
  assert.equal(run.encodes.filter(x=>x.width===8192).length,1);
  assert.equal(run.encodes.length,3);
  assert.equal(data.get('panorama'),run.source,'original file is retained');
  assert.ok(data.get('image8k') instanceof File);
});

test('4K-and-smaller panoramas encode and send their full-resolution display image only once', async () => {
  const run = setup(2048,1024);
  const data = run.body();
  await run.window.preparePanoramaUpload(data, () => {});
  assert.equal(run.encodes.length,2,'one display image and one thumbnail');
  assert.equal(data.get('image8k'),null);
  assert.equal(data.get('image8kRef'),'image4k');
  assert.ok(data.get('image4k') instanceof File);
  assert.equal(data.get('panorama'),run.source);
});

test('retrying the same selected file reuses prepared images without mixing node metadata', async () => {
  const run=setup(8192,4096);
  const first=run.body();
  await run.window.preparePanoramaUpload(first,()=>{});
  const before=run.encodes.length;
  const retry=run.body();retry.set('id','M2-03');
  await run.window.preparePanoramaUpload(retry,()=>{});
  assert.equal(run.encodes.length,before);
  assert.equal(retry.get('id'),'M2-03');
  assert.equal(retry.get('image8k').size,first.get('image8k').size);
});

test('upload dialog always starts at yaw 90 and pitch 0, independent of the current view', () => {
  const app = readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const source = app.slice(app.indexOf('  function openUpload()'),app.indexOf('  function openConnect()'));
  const fields = Object.fromEntries(['id','replace','title','floor','building','nodeType','initialYaw','initialPitch'].map(name=>[name,{value:''}]));
  const form={elements:fields,reset(){}};
  const nodes=new Map([['#upload-form',form]]);
  const $=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};
  vm.runInNewContext(source+'\nopenUpload();',{$,state:{currentSceneId:'M1-02',scenes:new Map([['M1-02',{id:'M1-02',title:'본관',floor:'1F',building:'본관',nodeType:'hall'}]])},openDialog(){},api:async()=>({pending:false}),viewer:{getView(){throw new Error('must not capture the current camera direction');}}});
  assert.equal(fields.initialYaw.value,'90');assert.equal(fields.initialPitch.value,'0');
});
