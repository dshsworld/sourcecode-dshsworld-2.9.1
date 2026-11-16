import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context={window:{},EventTarget};
vm.runInNewContext(readFileSync(new URL('../public/viewer.js',import.meta.url),'utf8'),context);
const Viewer=context.window.PanoramaViewer;
test('manually placed arrows stay at the clicked pixel, even near edges or another arrow', () => {
 for (const [width,height] of [[1280,720],[390,844]]) {
  const points=[{index:0,x:20,y:25,pinned:false},{index:1,x:20,y:25,pinned:true},{index:2,x:width-10,y:height-12,pinned:true}];
  const placed=Viewer.layoutHotspots(points,width,height);
  assert.equal(placed[1].x,20);assert.equal(placed[1].y,25);
  assert.equal(placed[2].x,width-10);assert.equal(placed[2].y,height-12);
  assert.ok(Math.hypot(placed[0].x-20,placed[0].y-25)>60,'only the estimated arrow yields');
 }
});
test('overlapping arrows remain individually selectable on desktop and mobile',()=>{
 assert.equal(typeof Viewer.layoutHotspots,'function','viewer must separate overlapping click targets');
 for(const [w,h] of [[1200,800],[360,640]]){
  const points=Array.from({length:6},(_,index)=>({index,x:w-12,y:h-20}));
  const before=JSON.stringify(points), placed=Viewer.layoutHotspots(points,w,h);
  assert.equal(JSON.stringify(points),before,'do not change photo headings or input coordinates');
  assert.equal(placed.length,6);
  for(let i=0;i<placed.length;i++){
   assert(placed[i].x>=42&&placed[i].x<=w-42&&placed[i].y>=42&&placed[i].y<=h-42);
   for(let j=0;j<i;j++)assert(Math.abs(placed[i].x-placed[j].x)>=82||Math.abs(placed[i].y-placed[j].y)>=82);
  }
 }
});

test('node map separates cross-building exits from corridor lines and keeps destinations clickable',()=>{
 class Element {
  children=[];style={};attributes={};events={};dataset={};
  classList={add(){},toggle(){}};
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  setAttribute(key,value){this.attributes[key]=value;}
  removeAttribute(key){delete this.attributes[key];}
  querySelectorAll(){return [];}
  addEventListener(key,fn){this.events[key]=fn;}
 }
 const canvas=new Element(), select={value:'본관'},markButton=new Element(),description=new Element();
 const scenes=[{id:'M1-09',building:'본관',floor:'1F',mapX:847,mapY:87,nodeType:'hall'}, {id:'M1-10',building:'본관',floor:'1F',mapX:944,mapY:87,nodeType:'hall'}, {id:'O-24',building:'야외',floor:'OUT',mapX:211,mapY:635,nodeType:'entrance'}];
 const links=[['M1-09','M1-10'],['M1-10','O-24'],['O-24','M1-10']].map(([fromScene,toScene])=>({fromScene,toScene,kind:'walk'}));
 let destination;
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const source=app.slice(app.indexOf('  function renderNodeGraph()'),app.indexOf('  async function openNodeGraph()'));
 vm.runInNewContext(source+'\nrenderNodeGraph();',{
  elements:{graphCanvas:canvas},$:id=>id==='#graph-building'?select:id==='#graph-mark-mode'?markButton:description,$$:(selector,root)=>root.querySelectorAll(selector),
  state:{tour:{scenes,links},scenes:new Map(scenes.map(s=>[s.id,s])),currentSceneId:'M1-10'},
  document:{createElement:tag=>Object.assign(new Element(),{tag}),createElementNS:(ns,tag)=>Object.assign(new Element(),{tag})},
  floorRank:()=>1,sceneLabel:s=>s.id,arrowNodeLabel:s=>s.id,closeDialog(){},navigate:id=>destination=id,
 });
 const svg=canvas.children.find(e=>e.tag==='svg');
 assert.equal(svg.children.filter(e=>e.tag==='line').length,1,'only the indoor corridor edge may cross the floor diagram');
 const rail=canvas.children.find(e=>e.tag==='aside');
 assert(rail,'outside connection needs a separate labelled route');
 const target=rail.children.find(e=>e.tag==='button');
 assert.match(target.textContent,/본관 1F 10 → 야외 OUT 24/);target.events.click();assert.equal(destination,'O-24');
});
