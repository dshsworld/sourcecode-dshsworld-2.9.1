import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');

class Element extends EventTarget {
 children=[];style={};dataset={};attributes={};value='';hidden=false;open=false;className='';
 constructor(){super();const fields={};this.elements=new Proxy(fields,{get:(o,k)=>o[k]||=(new Element())});}
 classList={
  contains:name=>this.className.split(' ').includes(name),
  toggle:(name,force)=>{const classes=new Set(this.className.split(' ').filter(Boolean));const enabled=force??!classes.has(name);enabled?classes.add(name):classes.delete(name);this.className=[...classes].join(' ');return enabled;},
  add:(...names)=>names.forEach(n=>this.classList.toggle(n,true)),remove:(...names)=>names.forEach(n=>this.classList.toggle(n,false)),
 };
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 setAttribute(k,v){this.attributes[k]=v;}
 removeAttribute(k){delete this.attributes[k];}
 querySelector(){return new Element();}
 querySelectorAll(selector){const all=this.children.flatMap(child=>[child,...child.querySelectorAll('*')]);return selector==='[data-scene-id]'?all.filter(n=>n.dataset.sceneId):all;}
 showModal(){this.open=true;}
 close(){this.open=false;this.dispatchEvent(new Event('close'));}
 focus(){}
}

test('one header button marks and unmarks nodes without navigating, persists successful state, and keeps ordinary navigation',async()=>{
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 const document=Object.assign(new EventTarget(),{body:new Element(),querySelector:get,querySelectorAll:()=>[],getElementById:id=>get('#'+id),createElement:()=>new Element(),createElementNS:()=>new Element()});
 const window=new EventTarget(),calls=[],pending=[],tourReplies=[];
 const context=vm.createContext({window,document,EventTarget,Event,CustomEvent,FormData,URLSearchParams,console,
  requestAnimationFrame:fn=>fn(),setTimeout(){},history:{replaceState(){}},location:{hash:''},localStorage:{getItem(){},removeItem(){}},
  fetch:async(url,config)=>{
   if(url==='/api/visits')return {ok:true,json:async()=>({count:1})};
   if(url==='/api/tour')return new Promise(resolve=>tourReplies.push(resolve));
   const body=JSON.parse(config.body);calls.push({url,body,headers:config.headers});
   return new Promise(resolve=>pending.push({resolve,body}));
  },
 });
 vm.runInContext(read('viewer.js'),context);const Actual=window.PanoramaViewer;
 let loads=0;
 class Viewer extends EventTarget {
  static arrivalView=Actual.arrivalView;
  imageOrientation={yaw:0,pitch:0};
  getView(){return {yaw:90,pitch:0,hfov:84};}
  setImageOrientation(yaw,pitch){this.imageOrientation={yaw,pitch};}
  imageToWorldAngles(p){return Actual.rotateAngles(p,this.imageOrientation);}
  setPlaceholderHue(){} setHotspots(){} preload(){return Promise.resolve();}
  async load(){loads++;}
 }
 window.PanoramaViewer=Viewer;vm.runInContext(read('arrow-editor.js'),context);
 vm.runInContext(read('app.js').replace('  boot();','  window.testApp={state,openNodeGraph,setAdminMode,loadTour};'),context);
 const app=window.testApp;
 const scenes=[['M1-02','본관','1F'],['M1-03','본관','1F'],['G3-01','궁리관','3F']].map(([id,building,floor])=>({id,building,floor,title:id,nodeType:'hall',mapX:350,mapY:80,image4k:id+'.jpg',initialYaw:90,initialPitch:0,locationConfirmed:0}));
 Object.assign(app.state,{admin:true,csrf:'confirm-csrf',currentSceneId:'M1-02',tour:{scenes,links:[]},scenes:new Map(scenes.map(s=>[s.id,s]))});
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 const respond=async(error)=>{const {resolve,body}=pending.shift();resolve({ok:!error,json:async()=>error?{error}:({ok:true,...body})});await flush();};
 const click=element=>element.dispatchEvent(new Event('click'));
 const mapNode=id=>get('#node-graph-canvas').querySelectorAll('[data-scene-id]').find(n=>n.dataset.sceneId===id);
 await app.openNodeGraph();
 const toggle=get('#graph-mark-mode');
 assert.equal(toggle.hidden,false);assert.equal(toggle.attributes['aria-pressed'],'false');
 click(toggle);assert.equal(toggle.attributes['aria-pressed'],'true');
 click(mapNode('M1-02'));click(mapNode('M1-02'));
 assert.equal(calls.length,1,'double taps cannot submit contradictory writes');
 assert.equal(calls[0].url,'/api/admin/scenes/M1-02/confirmation');assert.equal(calls[0].body.confirmed,true);assert.equal(calls[0].headers['X-CSRF-Token'],'confirm-csrf');
 assert.equal(loads,0);assert.equal(get('#node-graph-dialog').open,true);
 assert.equal(mapNode('M1-02').classList.contains('is-location-confirmed'),false,'red appears only after durable saving succeeds');
 assert.equal(mapNode('M1-02').disabled,true);
 get('#node-graph-stage').scrollTop=200;
 get('#graph-building').value='궁리관';get('#graph-building').dispatchEvent(new Event('change'));
 const staleTour=app.loadTour();
 const refreshed=app.state.tour.scenes.map(s=>({...s,image4k:s.id==='M1-02'?'new-upload.jpg':s.image4k}));
 app.state.tour.scenes=refreshed;app.state.scenes=new Map(refreshed.map(s=>[s.id,s]));
 await respond();
 tourReplies.shift()({ok:true,json:async()=>({scenes:refreshed.map(s=>({...s,locationConfirmed:0})),links:[]})});await staleTour;
 assert.equal(get('#graph-building').value,'궁리관','a background save cannot reset the selected building');
 assert.equal(get('#node-graph-stage').scrollTop,200);assert.equal(loads,0);
 assert.equal(app.state.scenes.get('M1-02').image4k,'new-upload.jpg','confirmation cannot replace a newer uploaded photograph');
 assert.equal(app.state.scenes.get('M1-02').locationConfirmed,1);assert.equal(mapNode('G3-01').classList.contains('is-location-confirmed'),false);
 get('#graph-building').value='본관';get('#graph-building').dispatchEvent(new Event('change'));
 assert.equal(mapNode('M1-02').classList.contains('is-location-confirmed'),true,'red survives rebuilding and reopening the map');
 click(mapNode('M1-02'));assert.equal(calls.at(-1).body.confirmed,false);await respond();
 assert.equal(mapNode('M1-02').classList.contains('is-location-confirmed'),false);
 click(mapNode('M1-02'));await respond('저장 실패');
 assert.equal(mapNode('M1-02').classList.contains('is-location-confirmed'),false);assert.equal(mapNode('M1-02').disabled,false);
 click(toggle);assert.equal(toggle.attributes['aria-pressed'],'false');
 const count=calls.length;
 click(mapNode('M1-03'));await flush();
 assert.equal(app.state.currentSceneId,'M1-03');assert.equal(loads,1);assert.equal(get('#node-graph-dialog').open,false);assert.equal(calls.length,count);
 app.setAdminMode(false);await app.openNodeGraph();
 assert.equal(toggle.hidden,true);click(toggle);assert.equal(app.state.markingLocations,false);
 click(mapNode('M1-02'));await flush();assert.equal(app.state.currentSceneId,'M1-02');assert.equal(calls.length,count,'visitors can navigate but cannot change confirmations');
});
