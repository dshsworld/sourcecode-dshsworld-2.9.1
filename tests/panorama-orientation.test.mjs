import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const context={window:{},EventTarget};
vm.runInNewContext(readFileSync(new URL('../public/viewer.js',import.meta.url),'utf8'),context);
const Viewer=context.window.PanoramaViewer;
const vector=({yaw,pitch})=>{const y=yaw*Math.PI/180,p=pitch*Math.PI/180;return [Math.cos(p)*Math.sin(y),Math.sin(p),Math.cos(p)*Math.cos(y)];};
const distance=(a,b)=>Math.hypot(...a.map((n,i)=>n-b[i]));

test('photo objects and arrow anchors retain their relationship through combined yaw and pitch rotation',()=>{
 assert.equal(typeof Viewer.rotateDirection,'function');
 assert.equal(typeof Viewer.rotateAngles,'function');
 const apple={yaw:23,pitch:-14},arrow={yaw:25,pitch:-17};
 for(const rotation of [{yaw:90,pitch:0},{yaw:90,pitch:40},{yaw:-165,pitch:78},{yaw:350,pitch:-82}]){
  const a=Viewer.rotateAngles(apple,rotation),b=Viewer.rotateAngles(arrow,rotation);
  assert.ok(Math.abs(distance(vector(a),vector(b))-distance(vector(apple),vector(arrow)))<1e-10);
  const ray=Viewer.pointToAngles({...a,hfov:80},600,400,1200,800);
  const sampled=Viewer.rotateDirection(vector(ray),rotation,true);
  assert.ok(distance(sampled,vector(apple))<1e-10,'the texture still samples the apple at the same world direction as its anchor');
  const stored=Viewer.rotateAngles(b,rotation,true);
  assert.ok(distance(vector(stored),vector(arrow))<1e-10,'placing arrows in a corrected photo converts clicks back to image coordinates');
 }
});

test('arrival orientation uses the rotated return arrow when entering a corrected panorama',()=>{
 const scene={initialYaw:90,initialPitch:0,imageYaw:80,imagePitch:25};
 const link={yaw:35,pitch:-25};
 const angle=Viewer.rotateAngles(link,{yaw:scene.imageYaw,pitch:scene.imagePitch});
 const arrival=Viewer.arrivalView(scene,link);
 const expected=((angle.yaw+180+180)%360+360)%360-180;
 assert.ok(Math.abs(arrival.yaw-expected)<1e-9);assert.equal(arrival.pitch,0);
});
