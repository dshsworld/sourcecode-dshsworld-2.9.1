import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const context = {window:{},EventTarget};
vm.runInNewContext(readFileSync(new URL('../public/viewer.js', import.meta.url), 'utf8'), context);
const Viewer = context.window.PanoramaViewer;

test('a click on the panorama maps to its direction, including when looking up or zoomed', () => {
  const center = Viewer.pointToAngles({yaw:90,pitch:20,hfov:90}, 500, 250, 1000, 500);
  assert(Math.abs(center.yaw - 90) < .01);
  assert(Math.abs(center.pitch - 20) < .01);
  const right = Viewer.pointToAngles({yaw:0,pitch:0,hfov:90}, 750, 250, 1000, 500);
  assert(Math.abs(right.yaw - 26.565) < .01);
  const down = Viewer.pointToAngles({yaw:0,pitch:0,hfov:90}, 500, 375, 1000, 500);
  assert(Math.abs(down.pitch + 14.036) < .01);
});

test('cursor navigation follows the nearest connected floor direction without guessing at a junction', () => {
  const forward={toScene:'ahead',yaw:0,kind:'walk'};
  const right={toScene:'right',yaw:30,kind:'walk'};
  const view={yaw:0,pitch:0,hfov:90};
  assert.equal(Viewer.pickNavigationLink([forward,right],view,500,380,1000,500)?.toScene,'ahead');
  assert.equal(Viewer.pickNavigationLink([forward,right],view,780,380,1000,500)?.toScene,'right');
  assert.equal(Viewer.pickNavigationLink([forward,right],view,100,380,1000,500),null);
  assert.equal(Viewer.pickNavigationLink([forward,right],view,500,100,1000,500),null);
  assert.equal(Viewer.pickNavigationLink([forward,right],{...view,pitch:65},500,380,1000,500),null);
  assert.equal(Viewer.pickNavigationLink([{toScene:'a',yaw:-3},{toScene:'b',yaw:3}],view,500,380,1000,500),null);
});

test('arrival faces away from the return arrow while retaining the destination pitch', () => {
  const scene = {initialYaw:35,initialPitch:-8};
  assert.equal(Viewer.arrivalView(scene,{yaw:40}).yaw,-140);
  assert.equal(Viewer.arrivalView(scene,{yaw:40}).pitch,-8);
  assert.equal(Viewer.arrivalView(scene,null).yaw,35);
});

test('opening the node map does not reset a later building selection', async () => {
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const source=app.slice(app.indexOf('  async function openNodeGraph()'),app.indexOf('  function bindGraphPanning('));
  const selection={value:'본관'};
  let loads=0;
  const run=vm.runInNewContext(source+'\nopenNodeGraph()',{
    loadTour:async()=>{loads++;await new Promise(resolve=>setTimeout(resolve,10));},
    $:()=>selection,state:{scenes:new Map([['G3-01',{building:'궁리관'}]]),currentSceneId:'G3-01'},
    openDialog(){},requestAnimationFrame:fn=>fn(),renderNodeGraph(){},
  });
  selection.value='거경관';
  await run;
  assert.equal(selection.value,'거경관');
  assert.equal(loads,0);
});

test('nearby panoramas share a bounded decoded-image cache', async () => {
  const started=[];
  class Image {
    naturalWidth=4096;naturalHeight=2048;
    set src(url) { started.push(url); queueMicrotask(()=>this.onload()); }
  }
  const context={window:{},EventTarget,Image};
  vm.runInNewContext(readFileSync(new URL('../public/viewer.js',import.meta.url),'utf8'),context);
  const cache=context.window.PanoramaViewer.createImageCache(2);
  const one=cache.load('/one.jpg');
  const two=cache.load('/one.jpg');
  await Promise.all([one,two]);
  assert.deepEqual(started,['/one.jpg']);
  await cache.load('/two.jpg');
  await cache.load('/three.jpg');
  await cache.load('/one.jpg');
  assert.deepEqual(started,['/one.jpg','/two.jpg','/three.jpg','/one.jpg']);
});

test('an uploaded panorama can seed the cache and display without downloading the same image again', async()=>{
 let requests=0;
 class Image {set src(url){requests++;queueMicrotask(()=>this.onload());}}
 const context={window:{},EventTarget,Image};
 vm.runInNewContext(readFileSync(new URL('../public/viewer.js',import.meta.url),'utf8'),context);
 const cache=context.window.PanoramaViewer.createImageCache(2);
 const image={naturalWidth:4096,naturalHeight:2048};
 assert.equal(typeof cache.prime,'function');
 cache.prime('/saved.jpg',image);
 assert.equal(cache.ready('/saved.jpg'),image);
 assert.equal(await cache.load('/saved.jpg'),image);
 assert.equal(requests,0);
 cache.prime('/two.jpg',{});cache.prime('/three.jpg',{});
 assert.equal(cache.ready('/saved.jpg'),null,'priming keeps the same memory bound');
});

test('dragging empty map space pans without hijacking node clicks', () => {
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const source=app.slice(app.indexOf('  function bindGraphPanning('),app.indexOf('  bindGraphPanning(elements.graphStage)'));
  const handlers={};
  const stage={scrollLeft:80,scrollTop:100,classList:{add(){},remove(){}},addEventListener:(key,fn)=>{handlers[key]=fn;},setPointerCapture(){},releasePointerCapture(){}};
  vm.runInNewContext(source+'\nbindGraphPanning(stage)',{stage});
  handlers.pointerdown({button:0,pointerType:'mouse',pointerId:1,clientX:200,clientY:200,target:{closest:()=>null}});
  handlers.pointermove({pointerId:1,clientX:170,clientY:160});
  assert.equal(stage.scrollLeft,110);
  assert.equal(stage.scrollTop,140);
  handlers.pointerup({pointerId:1});
  handlers.pointerdown({button:0,pointerType:'mouse',pointerId:2,clientX:200,clientY:200,target:{closest:()=>({})}});
  handlers.pointermove({pointerId:2,clientX:150,clientY:150});
  assert.equal(stage.scrollLeft,110);
});
