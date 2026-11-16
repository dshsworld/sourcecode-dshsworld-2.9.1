import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root=fileURLToPath(new URL('..',import.meta.url));
function fixture() {
  const sqlite=new DatabaseSync(':memory:');
  for(const file of readdirSync(path.join(root,'drizzle')).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(path.join(root,'drizzle',file),'utf8'));
  let failBatchAt=-1;
  const DB={prepare(sql){return {args:[],bind(...args){this.args=args;return this;},async first(){return sqlite.prepare(sql).get(...this.args)||null;},async all(){return {results:sqlite.prepare(sql).all(...this.args)};},async run(){const r=sqlite.prepare(sql).run(...this.args);return {meta:{changes:r.changes,last_row_id:r.lastInsertRowid}};}};},async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(let i=0;i<statements.length;i++){if(i===failBatchAt)throw new Error('injected failure');out.push(await statements[i].run());}sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  const env={DB,SESSION_SECRET:'test-secret-at-least-thirty-two-characters-long'};
  const cache=new Map();
  function load(file){
    file=path.resolve(root,file);if(!file.endsWith('.ts'))file+='.ts';
    if(file===path.join(root,'lib/runtime.ts'))return {getRuntimeEnv:()=>env};
    if(cache.has(file))return cache.get(file).exports;
    const module={exports:{}};cache.set(file,module);
    const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    new Function('require','module','exports',code)(name=>load(name.startsWith('@/')?name.slice(2):path.resolve(path.dirname(file),name)),module,module.exports);
    return module.exports;
  }
  return {sqlite,env,load,failBatch:(at=8)=>{failBatchAt=at;}};
}

test('position-only edits persist without altering either endpoint, reverse links or photos',async()=>{
 const f=fixture();await f.load('lib/tour-data').getTour();
 const route=f.load('app/api/admin/links/[id]/route');
 assert.equal(typeof route.PATCH,'function');
 const before=f.sqlite.prepare('SELECT * FROM links ORDER BY id').all();
 const link=before.find(l=>l.kind==='walk');
 const photos=f.sqlite.prepare('SELECT id,image_8k,image_4k FROM scenes ORDER BY id').all();
 const params={params:Promise.resolve({id:String(link.id)})};
 const {signSession}=f.load('lib/admin-auth');
 const token=await signSession({role:'admin',csrf:'arrow-csrf',exp:Date.now()+3600000},f.env.SESSION_SECRET);
 const auth={cookie:'dshs_session='+token,'x-csrf-token':'arrow-csrf',origin:'https://example.test'};
 const request=(body,headers=auth)=>new Request('https://example.test/api/admin/links/'+link.id,{method:'PATCH',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
 assert.equal((await route.PATCH(request({yaw:32,pitch:-44},{}),params)).status,401);
 assert.equal((await route.PATCH(request({yaw:32,pitch:-44},{cookie:auth.cookie}),params)).status,403);
 for(const body of [{pitch:20},{yaw:20},{yaw:null,pitch:0},{yaw:0,pitch:91},{yaw:361,pitch:0}])assert.equal((await route.PATCH(request(body),params)).status,400);
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM links ORDER BY id').all(),before);
 const response=await route.PATCH(request({yaw:132.12567,pitch:-87.12345,fromScene:'OTHER',toScene:'ELSE',label:'do not change',kind:'elevator'}),params);
 assert.equal(response.status,200);
 const saved=await response.json();assert.equal(saved.positioned,2);
 const after=f.sqlite.prepare('SELECT * FROM links ORDER BY id').all();
 for(let i=0;i<before.length;i++) {
  if(before[i].id!==link.id)assert.deepEqual(after[i],before[i],'all other arrows, including the reverse, remain unchanged');
  else assert.deepEqual({...after[i]},{...before[i],yaw:132.12567,pitch:-87.12345,positioned:2});
 }
 const tour=await f.load('lib/tour-data').getTour();
 const reloaded=tour.links.find(l=>l.id===link.id);
 assert.equal(reloaded.toScene,link.to_scene);assert.equal(reloaded.yaw,132.12567);assert.equal(reloaded.pitch,-87.12345);assert.equal(reloaded.positioned,2);
 assert.deepEqual(f.sqlite.prepare('SELECT id,image_8k,image_4k FROM scenes ORDER BY id').all(),photos);
 assert.equal((await route.PATCH(request({yaw:20,pitch:-20}),{params:Promise.resolve({id:'9999999'})})).status,404);
 f.sqlite.close();
});

test('image direction correction persists while every arrow keeps its image-space anchor and destination',async()=>{
 const f=fixture();await f.load('lib/initialize-main-plan').initializeMainPlan();
 const scene=f.sqlite.prepare("SELECT * FROM scenes WHERE id='M1-02'").get();
 const arrows=f.sqlite.prepare('SELECT * FROM links ORDER BY id').all();
 const {signSession}=f.load('lib/admin-auth');
 const token=await signSession({role:'admin',csrf:'rotation-csrf',exp:Date.now()+3600000},f.env.SESSION_SECRET);
 const headers={cookie:'dshs_session='+token,'x-csrf-token':'rotation-csrf',origin:'https://example.test','content-type':'application/json'};
 const route=f.load('app/api/admin/scenes/[id]/route');
 const body={title:scene.title,floor:scene.floor,building:scene.building,nodeType:scene.node_type,imageYaw:135,imagePitch:-22};
 const request=(data,auth=headers)=>new Request('https://example.test/api/admin/scenes/M1-02',{method:'PUT',headers:auth,body:JSON.stringify(data)});
 const context={params:Promise.resolve({id:'M1-02'})};
 assert.equal((await route.PUT(request(body,{'content-type':'application/json'}),context)).status,401);
 assert.equal((await route.PUT(request(body,{...headers,'x-csrf-token':'wrong'}),context)).status,403);
 assert.equal((await route.PUT(request(body),context)).status,200);
 const saved=(await f.load('lib/tour-data').getTour()).scenes.find(s=>s.id==='M1-02');
 assert.equal(saved.imageYaw,135);assert.equal(saved.imagePitch,-22);
 assert.equal(saved.initialYaw,scene.initial_yaw);assert.equal(saved.initialPitch,scene.initial_pitch);
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM links ORDER BY id').all(),arrows,'photo-relative anchors, reverse arrows and graph endpoints stay intact');
 assert.equal((await route.PUT(request({...body,imagePitch:91}),context)).status,400);
 assert.equal(f.sqlite.prepare("SELECT image_pitch FROM scenes WHERE id='M1-02'").get().image_pitch,-22);
 f.sqlite.close();
});

test('only former main 1F 06 is removed; 05 connects to former 07 and retained photos move with renumbering',async()=>{
 const f=fixture(),marker='main_1f_remove_only_06_v2_8_2';
 f.sqlite.prepare("INSERT INTO settings(key,value) VALUES('main_remove_S1_S2_v2_8_2','done')").run();
 f.sqlite.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run(marker,'done');
 await f.load('lib/initialize-main-plan').initializeMainPlan();
 f.sqlite.prepare('DELETE FROM settings WHERE key=?').run(marker);
 for(let n=5;n<=10;n++)f.sqlite.prepare('UPDATE scenes SET image_8k=?,image_4k=?,annotation=? WHERE id=?').run(`photo-${n}.jpg`,`photo-${n}.jpg`,`note-${n}`,`M1-${String(n).padStart(2,'0')}`);
 f.sqlite.exec("UPDATE scenes SET image_yaw=70,image_pitch=-15,title='사진 있는 위치' WHERE id='M1-07'; UPDATE settings SET value='M1-07' WHERE key='start_scene'; INSERT INTO settings VALUES('pending_insp_M1-06','{\"key\":\"originals/deleted.insp\"}'),('pending_insp_M1-07','{\"key\":\"originals/retained.insp\"}'); UPDATE links SET yaw=111,pitch=-29,positioned=2 WHERE from_scene='M1-05' AND to_scene='M1-06'; UPDATE links SET yaw=-100,pitch=-13,positioned=2 WHERE from_scene='M1-07' AND to_scene='M1-06';");
 const originalFive=f.sqlite.prepare("SELECT * FROM scenes WHERE id='M1-05'").get();
 const otherScenes=f.sqlite.prepare("SELECT * FROM scenes WHERE id NOT IN ('M1-06','M1-07','M1-08','M1-09','M1-10') ORDER BY id").all();
 const unaffectedLinks=f.sqlite.prepare("SELECT * FROM links WHERE from_scene NOT IN ('M1-06','M1-07','M1-08','M1-09','M1-10') AND to_scene NOT IN ('M1-06','M1-07','M1-08','M1-09','M1-10') ORDER BY id").all();
 const revise=f.load('lib/revise-main-first-floor').reviseMainFirstFloor;
 await revise();
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM scenes').get().n,270);
 assert.deepEqual(f.sqlite.prepare("SELECT * FROM scenes WHERE id='M1-05'").get(),originalFive);
 for(let old=7;old<=10;old++){
  const s=f.sqlite.prepare('SELECT * FROM scenes WHERE id=?').get(`M1-${String(old-1).padStart(2,'0')}`);
  assert.equal(s.image_8k,`photo-${old}.jpg`);assert.equal(s.annotation,`note-${old}`);
 }
 assert.equal(f.sqlite.prepare("SELECT title FROM scenes WHERE id='M1-06'").get().title,'사진 있는 위치');
 assert.equal(f.sqlite.prepare("SELECT image_yaw FROM scenes WHERE id='M1-06'").get().image_yaw,70);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM scenes WHERE image_8k='photo-6.jpg'").get().n,0);
 for(const s of otherScenes)assert.deepEqual(f.sqlite.prepare('SELECT * FROM scenes WHERE id=?').get(s.id),s);
 for(const l of unaffectedLinks)assert.deepEqual(f.sqlite.prepare('SELECT * FROM links WHERE id=?').get(l.id),l);
 const bridge=f.sqlite.prepare("SELECT * FROM links WHERE from_scene='M1-05' AND to_scene='M1-06'").get();
 assert.equal(bridge.yaw,111);assert.equal(bridge.pitch,-29);assert.equal(bridge.positioned,2);
 assert.equal(f.sqlite.prepare("SELECT yaw FROM links WHERE from_scene='M1-06' AND to_scene='M1-05'").get().yaw,-100);
 assert(f.sqlite.prepare("SELECT 1 FROM links WHERE from_scene='O-24' AND to_scene='M1-09'").get());
 assert.equal(f.sqlite.prepare("SELECT value FROM settings WHERE key='start_scene'").get().value,'M1-06');
 assert.match(f.sqlite.prepare("SELECT value FROM settings WHERE key='pending_insp_M1-06'").get().value,/retained/);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM links l LEFT JOIN scenes a ON a.id=l.from_scene LEFT JOIN scenes b ON b.id=l.to_scene WHERE a.id IS NULL OR b.id IS NULL').get().n,0);
 const backup=JSON.parse(f.sqlite.prepare("SELECT value FROM settings WHERE key='backup_before_remove_only_M1_06'").get().value);
 assert.equal(backup.scenes.find(s=>s.id==='M1-06').image_8k,'photo-6.jpg');
 const before=JSON.stringify({scenes:f.sqlite.prepare('SELECT * FROM scenes ORDER BY id').all(),links:f.sqlite.prepare('SELECT * FROM links ORDER BY id').all()});
 const prepare=f.env.DB.prepare.bind(f.env.DB);
 f.env.DB.prepare=sql=>{const statement=prepare(sql),first=statement.first;statement.first=async function(){return this.args[0]===marker?null:first.call(this);};return statement;};
 await revise();await f.load('lib/initialize-main-plan').initializeMainPlan();
 assert.equal(JSON.stringify({scenes:f.sqlite.prepare('SELECT * FROM scenes ORDER BY id').all(),links:f.sqlite.prepare('SELECT * FROM links ORDER BY id').all()}),before,'a stale concurrent check must not delete the newly renumbered 06');
 f.sqlite.close();
});

test('failed single-node deletion rolls back the bridge, deletion and numbering together',async()=>{
 const f=fixture(),marker='main_1f_remove_only_06_v2_8_2';
 f.sqlite.prepare("INSERT INTO settings(key,value) VALUES('main_remove_S1_S2_v2_8_2','done')").run();
 f.sqlite.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run(marker,'done');
 await f.load('lib/initialize-main-plan').initializeMainPlan();f.sqlite.prepare('DELETE FROM settings WHERE key=?').run(marker);
 const scenes=f.sqlite.prepare('SELECT * FROM scenes ORDER BY id').all(),links=f.sqlite.prepare('SELECT * FROM links ORDER BY id').all();
 f.failBatch(7);await assert.rejects(f.load('lib/revise-main-first-floor').reviseMainFirstFloor());
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM scenes ORDER BY id').all(),scenes);
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM links ORDER BY id').all(),links);
 assert.equal(f.sqlite.prepare('SELECT value FROM settings WHERE key=?').get(marker),undefined);f.sqlite.close();
});

test('main S1/S2 are removed while corridors connect through their half-floor nodes',async()=>{
 const f=fixture(),marker='main_remove_S1_S2_v2_8_2';
 f.sqlite.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run(marker,'done');
 await f.load('lib/initialize-main-plan').initializeMainPlan();
 f.sqlite.prepare('DELETE FROM settings WHERE key=?').run(marker);
 f.sqlite.exec("UPDATE scenes SET image_8k='landing.jpg',annotation='recoverable' WHERE id='M1-S1'; UPDATE scenes SET image_8k='corridor.jpg',annotation='keep',image_yaw=72,image_pitch=-14 WHERE id='M1-04'; INSERT INTO links(from_scene,to_scene,yaw,pitch,label,positioned) VALUES('M1-04','M1-S1',130,-33,'계단',2); UPDATE links SET yaw=-63,pitch=-20,positioned=2 WHERE from_scene='M1-M1' AND to_scene='M1-S1'; UPDATE settings SET value='M1-S1' WHERE key='start_scene';");
 const retained=f.sqlite.prepare("SELECT * FROM scenes WHERE id NOT GLOB 'M[1-7]-S[12]' ORDER BY id").all();
 const unaffected=f.sqlite.prepare("SELECT * FROM links WHERE from_scene NOT GLOB 'M[1-7]-S[12]' AND to_scene NOT GLOB 'M[1-7]-S[12]' ORDER BY id").all();
 const remove=f.load('lib/remove-main-stair-landings').removeMainStairLandings;
 await remove();
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM scenes').get().n,256);
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM scenes ORDER BY id').all(),retained,'all retained photos, annotations, IDs and orientation corrections stay intact');
 for(const l of unaffected)assert.deepEqual(f.sqlite.prepare('SELECT * FROM links WHERE id=?').get(l.id),l);
 const edge=(a,b)=>f.sqlite.prepare('SELECT * FROM links WHERE from_scene=? AND to_scene=?').get(a,b);
 assert(edge('M1-04','M1-M1')&&edge('M1-M1','M2-03'));
 assert(edge('M2-03','M1-M1')&&edge('M1-M1','M1-04'));
 assert.equal(edge('M1-04','M1-M1').yaw,130);assert.equal(edge('M1-04','M1-M1').pitch,-33);assert.equal(edge('M1-04','M1-M1').positioned,2);
 assert.equal(edge('M1-M1','M1-04').yaw,-63);assert.equal(edge('M1-M1','M1-04').pitch,-20);
 assert.equal(f.sqlite.prepare("SELECT value FROM settings WHERE key='start_scene'").get().value,'M1-04');
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM scenes WHERE building='본관' AND id GLOB 'M[1-7]-M[12]'").get().n,12);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM links WHERE from_scene GLOB 'M[1-7]-S[12]' OR to_scene GLOB 'M[1-7]-S[12]'").get().n,0);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM links l LEFT JOIN scenes a ON a.id=l.from_scene LEFT JOIN scenes b ON b.id=l.to_scene WHERE a.id IS NULL OR b.id IS NULL').get().n,0);
 const backup=JSON.parse(f.sqlite.prepare("SELECT value FROM settings WHERE key='backup_before_main_remove_S1_S2'").get().value);
 assert.equal(backup.scenes.find(s=>s.id==='M1-S1').image_8k,'landing.jpg');
 const before=JSON.stringify(f.sqlite.prepare('SELECT * FROM links ORDER BY id').all());
 const prepare=f.env.DB.prepare.bind(f.env.DB);
 f.env.DB.prepare=sql=>{const statement=prepare(sql),first=statement.first;statement.first=async function(){return this.args[0]===marker?null:first.call(this);};return statement;};
 await remove();await f.load('lib/initialize-main-plan').initializeMainPlan();
 assert.equal(JSON.stringify(f.sqlite.prepare('SELECT * FROM links ORDER BY id').all()),before);
 f.sqlite.close();
});

test('main stair rewiring rolls back fully if its transaction fails',async()=>{
 const f=fixture(),marker='main_remove_S1_S2_v2_8_2';
 f.sqlite.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run(marker,'done');
 await f.load('lib/initialize-main-plan').initializeMainPlan();f.sqlite.prepare('DELETE FROM settings WHERE key=?').run(marker);
 const scenes=f.sqlite.prepare('SELECT * FROM scenes ORDER BY id').all(),links=f.sqlite.prepare('SELECT * FROM links ORDER BY id').all();
 f.failBatch(7);await assert.rejects(f.load('lib/remove-main-stair-landings').removeMainStairLandings());
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM scenes ORDER BY id').all(),scenes);assert.deepEqual(f.sqlite.prepare('SELECT * FROM links ORDER BY id').all(),links);
 assert.equal(f.sqlite.prepare('SELECT value FROM settings WHERE key=?').get(marker),undefined);f.sqlite.close();
});

test('main 2F follows elevator landing, 02, 01, 03 without altering photos or other routes',async()=>{
 const f=fixture(),marker='main_2f_elevator_02_01_03_v2_8_2';
 f.sqlite.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run(marker,'done');
 await f.load('lib/initialize-main-plan').initializeMainPlan();f.sqlite.prepare('DELETE FROM settings WHERE key=?').run(marker);
 f.sqlite.exec("UPDATE scenes SET image_8k='photo.jpg',annotation='keep',image_yaw=78,image_pitch=-13 WHERE id='M2-03'; UPDATE links SET yaw=-130,pitch=-31,positioned=2 WHERE from_scene='M2-03' AND to_scene='M2-02'; UPDATE links SET yaw=55,pitch=-26,positioned=2 WHERE from_scene='M2-02' AND to_scene='M-ELV';");
 const scenes=f.sqlite.prepare('SELECT * FROM scenes ORDER BY id').all();
 const before=f.sqlite.prepare('SELECT * FROM links ORDER BY id').all();
 const originalCorridor=before.find(l=>l.from_scene==='M2-03'&&l.to_scene==='M2-02');
 const originalElevator=before.find(l=>l.from_scene==='M2-02'&&l.to_scene==='M-ELV');
 const revise=f.load('lib/revise-main-second-floor').reviseMainSecondFloor;
 await revise();
 const edge=(a,b)=>f.sqlite.prepare('SELECT * FROM links WHERE from_scene=? AND to_scene=?').get(a,b);
 for(const [a,b] of [['M2-E','M2-02'],['M2-02','M2-01'],['M2-01','M2-03']])assert(edge(a,b)&&edge(b,a),`${a} ↔ ${b}`);
 for(const [a,b] of [['M2-03','M2-02'],['M2-03','M-ELV'],['M2-02','M-ELV']])assert(!edge(a,b)&&!edge(b,a));
 assert.equal(edge('M2-03','M2-01').id,originalCorridor.id);assert.equal(edge('M2-03','M2-01').yaw,-130);assert.equal(edge('M2-03','M2-01').pitch,-31);assert.equal(edge('M2-03','M2-01').positioned,2);
 assert.equal(edge('M2-02','M2-E').id,originalElevator.id);assert.equal(edge('M2-02','M2-E').yaw,55);assert.equal(edge('M2-02','M2-E').pitch,-26);
 assert.equal(edge('M2-E','M-ELV').kind,'elevator');assert.equal(edge('M-ELV','M2-E').kind,'elevator');
 assert(edge('M2-03','M1-M1')&&edge('M1-M1','M2-03'),'the corrected stair route is retained');
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM scenes ORDER BY id').all(),scenes);
 const changed=new Set(['M2-03|M2-02','M2-02|M2-03','M2-03|M-ELV','M-ELV|M2-03','M2-02|M-ELV','M-ELV|M2-02']);
 for(const link of before)if(!changed.has(`${link.from_scene}|${link.to_scene}`))assert.deepEqual(f.sqlite.prepare('SELECT * FROM links WHERE id=?').get(link.id),link);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM links l LEFT JOIN scenes a ON a.id=l.from_scene LEFT JOIN scenes b ON b.id=l.to_scene WHERE a.id IS NULL OR b.id IS NULL').get().n,0);
 const saved=JSON.stringify(f.sqlite.prepare('SELECT * FROM links ORDER BY id').all());
 const prepare=f.env.DB.prepare.bind(f.env.DB);
 f.env.DB.prepare=sql=>{const statement=prepare(sql),first=statement.first;statement.first=async function(){return this.args[0]===marker?null:first.call(this);};return statement;};
 await revise();await f.load('lib/initialize-main-plan').initializeMainPlan();
 assert.equal(JSON.stringify(f.sqlite.prepare('SELECT * FROM links ORDER BY id').all()),saved);
 f.sqlite.close();
});

test('main 2F route edit rolls back all endpoint changes if saving fails',async()=>{
 const f=fixture(),marker='main_2f_elevator_02_01_03_v2_8_2';
 f.sqlite.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run(marker,'done');
 await f.load('lib/initialize-main-plan').initializeMainPlan();f.sqlite.prepare('DELETE FROM settings WHERE key=?').run(marker);
 const before=f.sqlite.prepare('SELECT * FROM links ORDER BY id').all();
 f.failBatch(5);await assert.rejects(f.load('lib/revise-main-second-floor').reviseMainSecondFloor());
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM links ORDER BY id').all(),before);
 assert.equal(f.sqlite.prepare('SELECT value FROM settings WHERE key=?').get(marker),undefined);f.sqlite.close();
});

test('main 2F removes only 04 and 08, joins 03–05 and 07–09, and keeps surviving node numbers and photos',async()=>{
 const f=fixture(),marker='main_2f_remove_04_08_v2_8_3';
 f.sqlite.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run(marker,'done');
 await f.load('lib/initialize-main-plan').initializeMainPlan();f.sqlite.prepare('DELETE FROM settings WHERE key=?').run(marker);
 for(const n of [3,4,5,7,8,9])f.sqlite.prepare('UPDATE scenes SET image_8k=?,annotation=?,image_yaw=?,image_pitch=-12 WHERE id=?').run(`photo-${n}.jpg`,`note-${n}`,n*10,`M2-${String(n).padStart(2,'0')}`);
 f.sqlite.exec("UPDATE links SET yaw=123,pitch=-32,positioned=2 WHERE from_scene='M2-03' AND to_scene='M2-04'; UPDATE links SET yaw=-119,pitch=-28,positioned=2 WHERE from_scene='M2-05' AND to_scene='M2-04'; UPDATE links SET yaw=95,pitch=-35,positioned=2 WHERE from_scene='M2-07' AND to_scene='M2-08'; UPDATE links SET yaw=-92,pitch=-31,positioned=2 WHERE from_scene='M2-09' AND to_scene='M2-08'; UPDATE settings SET value='M2-08' WHERE key='start_scene'; INSERT INTO settings VALUES('pending_insp_M2-04','original-four.insp'),('pending_insp_M2-08','original-eight.insp');");
 const retained=f.sqlite.prepare("SELECT * FROM scenes WHERE id NOT IN ('M2-04','M2-08') ORDER BY id").all();
 const unaffected=f.sqlite.prepare("SELECT * FROM links WHERE from_scene NOT IN ('M2-04','M2-08') AND to_scene NOT IN ('M2-04','M2-08') ORDER BY id").all();
 const forwardId=f.sqlite.prepare("SELECT id FROM links WHERE from_scene='M2-03' AND to_scene='M2-04'").get().id;
 const remove=f.load('lib/remove-main-second-floor-nodes').removeMainSecondFloorNodes;
 await remove();
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM scenes ORDER BY id').all(),retained,'surviving IDs, numbers, photographs, notes and orientation corrections remain exact');
 const edge=(a,b)=>f.sqlite.prepare('SELECT * FROM links WHERE from_scene=? AND to_scene=?').get(a,b);
 for(const [a,b] of [['M2-03','M2-05'],['M2-07','M2-09']])assert(edge(a,b)&&edge(b,a),`${a} ↔ ${b}`);
 assert.equal(edge('M2-03','M2-05').id,forwardId);assert.equal(edge('M2-03','M2-05').yaw,123);assert.equal(edge('M2-03','M2-05').pitch,-32);assert.equal(edge('M2-03','M2-05').positioned,2);
 assert.equal(edge('M2-05','M2-03').yaw,-119);assert.equal(edge('M2-07','M2-09').yaw,95);assert.equal(edge('M2-09','M2-07').yaw,-92);
 for(const link of unaffected)assert.deepEqual(f.sqlite.prepare('SELECT * FROM links WHERE id=?').get(link.id),link);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM links WHERE from_scene IN ('M2-04','M2-08') OR to_scene IN ('M2-04','M2-08')").get().n,0);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM settings WHERE key IN ('pending_insp_M2-04','pending_insp_M2-08')").get().n,0);
 assert.equal(f.sqlite.prepare("SELECT value FROM settings WHERE key='start_scene'").get().value,'M2-07');
 const backup=JSON.parse(f.sqlite.prepare("SELECT value FROM settings WHERE key='backup_before_main_2f_remove_04_08'").get().value);
 assert.equal(backup.scenes.find(s=>s.id==='M2-04').image_8k,'photo-4.jpg');assert.equal(backup.scenes.find(s=>s.id==='M2-08').annotation,'note-8');
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM links l LEFT JOIN scenes a ON a.id=l.from_scene LEFT JOIN scenes b ON b.id=l.to_scene WHERE a.id IS NULL OR b.id IS NULL').get().n,0);
 const before=JSON.stringify({scenes:retained,links:f.sqlite.prepare('SELECT * FROM links ORDER BY id').all()});
 const prepare=f.env.DB.prepare.bind(f.env.DB);
 f.env.DB.prepare=sql=>{const statement=prepare(sql),first=statement.first;statement.first=async function(){return this.args[0]===marker?null:first.call(this);};return statement;};
 await remove();await f.load('lib/initialize-main-plan').initializeMainPlan();
 assert.equal(JSON.stringify({scenes:f.sqlite.prepare('SELECT * FROM scenes ORDER BY id').all(),links:f.sqlite.prepare('SELECT * FROM links ORDER BY id').all()}),before);
 f.sqlite.close();
});

test('main 2F node removal rolls back both cuts if a database write fails',async()=>{
 const f=fixture(),marker='main_2f_remove_04_08_v2_8_3';
 f.sqlite.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run(marker,'done');
 await f.load('lib/initialize-main-plan').initializeMainPlan();f.sqlite.prepare('DELETE FROM settings WHERE key=?').run(marker);
 const scenes=f.sqlite.prepare('SELECT * FROM scenes ORDER BY id').all(),links=f.sqlite.prepare('SELECT * FROM links ORDER BY id').all();
 f.failBatch(7);await assert.rejects(f.load('lib/remove-main-second-floor-nodes').removeMainSecondFloorNodes());
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM scenes ORDER BY id').all(),scenes);assert.deepEqual(f.sqlite.prepare('SELECT * FROM links ORDER BY id').all(),links);
 assert.equal(f.sqlite.prepare('SELECT value FROM settings WHERE key=?').get(marker),undefined);f.sqlite.close();
});

test('location confirmation requires creator authentication, persists per node, and never replaces photo or graph data',async()=>{
 const f=fixture();await f.load('lib/tour-data').getTour();
 const route=f.load('app/api/admin/scenes/[id]/confirmation/route');
 const {signSession}=f.load('lib/admin-auth');
 const token=await signSession({role:'admin',csrf:'confirm-csrf',exp:Date.now()+3600000},f.env.SESSION_SECRET);
 const auth={cookie:'dshs_session='+token,'x-csrf-token':'confirm-csrf',origin:'https://example.test','content-type':'application/json'};
 const request=(body,headers=auth)=>new Request('https://example.test/api/admin/scenes/M2-03/confirmation',{method:'PUT',headers,body:JSON.stringify(body)});
 const context={params:Promise.resolve({id:'M2-03'})};
 const links=f.sqlite.prepare('SELECT * FROM links ORDER BY id').all();
 const original=f.sqlite.prepare("SELECT * FROM scenes WHERE id='M2-03'").get();
 assert.equal((await route.PUT(request({confirmed:true},{}),context)).status,401);
 assert.equal((await route.PUT(request({confirmed:true},{...auth,'x-csrf-token':'wrong'}),context)).status,403);
 for(const body of [null,{},{confirmed:'true'},{confirmed:1},{confirmed:null}])assert.equal((await route.PUT(request(body),context)).status,400);
 assert.equal((await route.PUT(request({confirmed:true,annotation:'do not overwrite',image4k:'wrong.jpg'}),context)).status,200);
 assert.equal((await f.load('lib/tour-data').getTour()).scenes.find(s=>s.id==='M2-03').locationConfirmed,1);
 const marked=f.sqlite.prepare("SELECT * FROM scenes WHERE id='M2-03'").get();
 assert.deepEqual({...marked,location_confirmed:original.location_confirmed,updated_at:original.updated_at},{...original});
 f.sqlite.prepare("UPDATE scenes SET image_4k='new-upload.jpg',annotation='new note' WHERE id='M2-03'").run();
 assert.equal((await route.PUT(request({confirmed:true}),context)).status,200,'retrying an explicit value cannot toggle it off');
 assert.equal((await route.PUT(request({confirmed:false}),context)).status,200);
 const reloaded=(await f.load('lib/tour-data').getTour()).scenes;
 assert.equal(reloaded.find(s=>s.id==='M2-03').locationConfirmed,0);
 assert.equal(reloaded.find(s=>s.id==='M2-03').image4k,'new-upload.jpg');assert.equal(reloaded.find(s=>s.id==='M2-03').annotation,'new note');
 assert(reloaded.filter(s=>s.id!=='M2-03').every(s=>s.locationConfirmed===0));
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM links ORDER BY id').all(),links);
 assert.equal((await route.PUT(request({confirmed:true}),{params:Promise.resolve({id:'M2-04'})})).status,404);
 f.sqlite.close();
});

test('main 6F deletes only 01 and 09, joins 08–10, and preserves photographs and confirmation marks',async()=>{
 const f=fixture(),marker='main_6f_remove_01_09_v2_9_1';
 f.sqlite.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run(marker,'done');
 await f.load('lib/initialize-main-plan').initializeMainPlan();f.sqlite.prepare('DELETE FROM settings WHERE key=?').run(marker);
 for(const n of [1,8,9,10])f.sqlite.prepare('UPDATE scenes SET image_8k=?,annotation=?,location_confirmed=1,image_yaw=55,image_pitch=-18 WHERE id=?').run(`sixth-${n}.jpg`,`note-${n}`,`M6-${String(n).padStart(2,'0')}`);
 f.sqlite.exec("UPDATE links SET yaw=118,pitch=-29,positioned=2 WHERE from_scene='M6-08' AND to_scene='M6-09'; UPDATE links SET yaw=-124,pitch=-32,positioned=2 WHERE from_scene='M6-10' AND to_scene='M6-09'; UPDATE settings SET value='M6-09' WHERE key='start_scene'; INSERT INTO settings VALUES('pending_insp_M6-01','original-one.insp'),('pending_insp_M6-09','original-nine.insp');");
 const retained=f.sqlite.prepare("SELECT * FROM scenes WHERE id NOT IN ('M6-01','M6-09') ORDER BY id").all();
 const unaffected=f.sqlite.prepare("SELECT * FROM links WHERE from_scene NOT IN ('M6-01','M6-09') AND to_scene NOT IN ('M6-01','M6-09') ORDER BY id").all();
 const old=f.sqlite.prepare("SELECT * FROM links WHERE from_scene='M6-08' AND to_scene='M6-09'").get();
 const revise=f.load('lib/revise-main-sixth-floor').reviseMainSixthFloor;await revise();
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM scenes ORDER BY id').all(),retained,'all surviving node numbers, photos, notes, corrections and red marks are untouched');
 const forward=f.sqlite.prepare("SELECT * FROM links WHERE from_scene='M6-08' AND to_scene='M6-10'").get();
 assert.equal(forward.id,old.id);assert.equal(forward.yaw,118);assert.equal(forward.pitch,-29);assert.equal(forward.positioned,2);
 assert.equal(f.sqlite.prepare("SELECT yaw FROM links WHERE from_scene='M6-10' AND to_scene='M6-08'").get().yaw,-124);
 for(const link of unaffected)assert.deepEqual(f.sqlite.prepare('SELECT * FROM links WHERE id=?').get(link.id),link);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM links WHERE from_scene IN ('M6-01','M6-09') OR to_scene IN ('M6-01','M6-09')").get().n,0);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM settings WHERE key IN ('pending_insp_M6-01','pending_insp_M6-09')").get().n,0);
 assert.equal(f.sqlite.prepare("SELECT value FROM settings WHERE key='start_scene'").get().value,'M6-08');
 const backup=JSON.parse(f.sqlite.prepare("SELECT value FROM settings WHERE key='backup_before_main_6f_remove_01_09'").get().value);
 assert.equal(backup.scenes.find(s=>s.id==='M6-01').image_8k,'sixth-1.jpg');assert.equal(backup.scenes.find(s=>s.id==='M6-09').location_confirmed,1);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM links l LEFT JOIN scenes a ON a.id=l.from_scene LEFT JOIN scenes b ON b.id=l.to_scene WHERE a.id IS NULL OR b.id IS NULL').get().n,0);
 const before=JSON.stringify({scenes:retained,links:f.sqlite.prepare('SELECT * FROM links ORDER BY id').all()});
 const prepare=f.env.DB.prepare.bind(f.env.DB);
 f.env.DB.prepare=sql=>{const statement=prepare(sql),first=statement.first;statement.first=async function(){return this.args[0]===marker?null:first.call(this);};return statement;};
 await revise();await f.load('lib/initialize-main-plan').initializeMainPlan();
 assert.equal(JSON.stringify({scenes:f.sqlite.prepare('SELECT * FROM scenes ORDER BY id').all(),links:f.sqlite.prepare('SELECT * FROM links ORDER BY id').all()}),before);f.sqlite.close();
});

test('main 6F deletion and bridge are rolled back together on failure',async()=>{
 const f=fixture(),marker='main_6f_remove_01_09_v2_9_1';
 f.sqlite.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run(marker,'done');
 await f.load('lib/initialize-main-plan').initializeMainPlan();f.sqlite.prepare('DELETE FROM settings WHERE key=?').run(marker);
 const scenes=f.sqlite.prepare('SELECT * FROM scenes ORDER BY id').all(),links=f.sqlite.prepare('SELECT * FROM links ORDER BY id').all();
 f.failBatch(7);await assert.rejects(f.load('lib/revise-main-sixth-floor').reviseMainSixthFloor());
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM scenes ORDER BY id').all(),scenes);assert.deepEqual(f.sqlite.prepare('SELECT * FROM links ORDER BY id').all(),links);
 assert.equal(f.sqlite.prepare('SELECT value FROM settings WHERE key=?').get(marker),undefined);f.sqlite.close();
});

test('main plan is a connected 85-node graph; stairs remain same-floor ordinary links',()=>{
  const f=fixture();const {MAIN_SCENES,MAIN_LINKS}=f.load('lib/main-plan');
  assert.equal(MAIN_SCENES.length,85);
  const ids=new Set(MAIN_SCENES.map(s=>s.id));assert.equal(ids.size,85);
  assert.equal(MAIN_SCENES.filter(s=>s.nodeType==='elevator-landing').length,7);
  const byId=new Map(MAIN_SCENES.map(s=>[s.id,s]));
  for(const l of MAIN_LINKS){assert(ids.has(l.fromScene)&&ids.has(l.toScene));if(l.kind!=='elevator')assert.equal(byId.get(l.fromScene).floor,byId.get(l.toScene).floor);}
  const seen=new Set(['M1-02']);for(let i=0;i<85;i++)for(const l of MAIN_LINKS)if(seen.has(l.fromScene))seen.add(l.toScene);
  assert.equal(seen.size,85);assert(MAIN_SCENES.every(s=>!s.image8k&&!s.image4k));f.sqlite.close();
});

test('replacement archives old data, preserves visits, and never resets subsequent edits',async()=>{
  const f=fixture();
  f.sqlite.exec("INSERT INTO scenes(id,title,floor,node_type,image_8k,image_4k)VALUES('OLD','old','1F','hall','old.jpg','old.jpg'); INSERT INTO settings VALUES('page_visits','73');");
  const {initializeMainPlan}=f.load('lib/initialize-main-plan');await initializeMainPlan();
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM scenes').get().n,256);
  const backup=JSON.parse(f.sqlite.prepare("SELECT value FROM settings WHERE key='backup_before_1_1_1'").get().value);
  assert.equal(backup.scenes[0].id,'OLD');assert.equal(f.sqlite.prepare("SELECT value FROM settings WHERE key='page_visits'").get().value,'73');
  const before=f.sqlite.prepare('SELECT count(*) n FROM links').get().n;
  f.sqlite.exec("UPDATE scenes SET annotation='retained' WHERE id='M1-02'; DELETE FROM links WHERE id=(SELECT min(id) FROM links)");
  await initializeMainPlan();assert.equal(f.sqlite.prepare("SELECT annotation FROM scenes WHERE id='M1-02'").get().annotation,'retained');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM links').get().n,before-1);f.sqlite.close();
});

test('failed replacement rolls back without deleting old nodes',async()=>{
  const f=fixture();f.sqlite.exec("INSERT INTO scenes(id,title,floor,node_type,image_8k,image_4k)VALUES('OLD','old','1F','hall','','')");f.failBatch();
  await assert.rejects(f.load('lib/initialize-main-plan').initializeMainPlan());assert.equal(f.sqlite.prepare('SELECT id FROM scenes').get().id,'OLD');assert.equal(f.sqlite.prepare("SELECT count(*) n FROM settings WHERE key='main_plan_1_1_1'").get().n,0);f.sqlite.close();
});

test('annotations require authentication and CSRF; nodes remain independent; cross-building links persist',async()=>{
  const f=fixture();await f.load('lib/initialize-main-plan').initializeMainPlan();
  const route=f.load('app/api/admin/scenes/[id]/annotation/route');const context={params:Promise.resolve({id:'M1-02'})};
  const request=(text,headers={})=>new Request('https://example.test/api/admin/scenes/M1-02/annotation',{method:'PUT',headers:{'content-type':'application/json',...headers},body:JSON.stringify({text})});
  assert.equal((await route.PUT(request('blocked'),context)).status,401);
  const {signSession}=f.load('lib/admin-auth');const token=await signSession({role:'admin',csrf:'test-csrf',exp:Date.now()+3600000},f.env.SESSION_SECRET);
  const auth={cookie:'dshs_session='+token,'x-csrf-token':'test-csrf',origin:'https://example.test'};
  assert.equal((await route.PUT(request('blocked',{cookie:auth.cookie}),context)).status,403);
  assert.equal((await route.PUT(request('x'.repeat(5001),auth),context)).status,400);
  const text='<script>plain text</script>\n두 번째 줄';assert.equal((await route.PUT(request(text,auth),context)).status,200);
  let tour=await f.load('lib/tour-data').getTour();assert.equal(tour.scenes.find(s=>s.id==='M1-02').annotation,text);assert.equal(tour.scenes.find(s=>s.id==='M1-01').annotation,'');
  assert.equal((await route.PUT(request('',auth),context)).status,200);
  f.sqlite.exec("INSERT INTO scenes(id,title,floor,building,node_type,image_8k,image_4k)VALUES('G2','궁리','2F','궁리관','hall','',''),('K3','거경','3F','거경관','hall','','')");
  const pair=f.load('app/api/admin/links/pair/route');
  const response=await pair.POST(new Request('https://example.test/api/admin/links/pair',{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({fromScene:'G2',toScene:'K3',fromYaw:90,fromPitch:-25,toYaw:-90,toPitch:-25,fromLabel:'거경관 3층',toLabel:'궁리관 2층',kind:'walk'})}));assert.equal(response.status,201);
  tour=await f.load('lib/tour-data').getTour();assert(tour.links.some(l=>l.fromScene==='G2'&&l.toScene==='K3'));assert(tour.links.some(l=>l.fromScene==='K3'&&l.toScene==='G2'));
  const forward=tour.links.find(l=>l.fromScene==='G2'&&l.toScene==='K3');
  const reverse=tour.links.find(l=>l.fromScene==='K3'&&l.toScene==='G2');
  assert.equal(forward.positioned,2);
  assert.equal(reverse.positioned,0,'automatically created reverse arrow awaits placement in its own photo');
  const edit=f.load('app/api/admin/links/[id]/route');
  const edited=await edit.PUT(new Request('https://example.test/api/admin/links/'+reverse.id,{method:'PUT',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({yaw:22,pitch:-32,label:'궁리관 2층'})}),{params:Promise.resolve({id:String(reverse.id)})});
  assert.equal(edited.status,200);
  tour=await f.load('lib/tour-data').getTour();
  assert.equal(tour.links.find(l=>l.id===reverse.id).positioned,2);
  f.sqlite.close();
});

 test('revision preserves uploads and annotations, repairs branches and inserts stair landings once',async()=>{
 const f=fixture();
 // Seed the previous production layout, including an intentionally missing 3F edge.
 const {MAIN_SCENES,MAIN_LINKS}=f.load('lib/main-plan');
 for(const s of MAIN_SCENES)f.sqlite.prepare('INSERT INTO scenes(id,title,floor,building,node_type,map_x,map_y,image_8k,image_4k)VALUES(?,?,?,?,?,?,?,?,?)').run(s.id,s.title,s.floor,s.building,s.nodeType,s.mapX,s.mapY,s.image8k,s.image4k);
 for(const l of MAIN_LINKS)if(![l.fromScene,l.toScene].every(id=>['M3-04','M3-05'].includes(id)))f.sqlite.prepare('INSERT INTO links(from_scene,to_scene,yaw,pitch,label,kind)VALUES(?,?,?,?,?,?)').run(l.fromScene,l.toScene,l.yaw,l.pitch,l.label,l.kind);
 f.sqlite.exec("INSERT INTO settings VALUES('main_plan_1_1_1','done'); UPDATE scenes SET image_8k='photo.jpg',annotation='keep' WHERE id='M4-05'");
 await f.load('lib/initialize-main-plan').initializeMainPlan();
 const moved=f.sqlite.prepare("SELECT * FROM scenes WHERE id='M4-10'").get();assert.equal(moved.image_8k,'photo.jpg');assert.equal(moved.annotation,'keep');
 const linked=(a,b)=>!!f.sqlite.prepare('SELECT 1 FROM links WHERE from_scene=? AND to_scene=?').get(a,b);
 for(const [a,b] of [[4,5],[4,6],[5,7],[6,7],[5,8],[6,9],[8,9],[9,10]]) {const x=`M4-${String(a).padStart(2,'0')}`,y=`M4-${String(b).padStart(2,'0')}`;assert(linked(x,y)&&linked(y,x));}
 assert(!linked('M4-04','M4-10'));assert(!linked('M3-04','M3-05')&&!linked('M3-05','M3-04'));
 const anchors=[['04','09'],['03','09'],['03','05'],['03','10'],['04','10'],['04','10'],['03','09']];
 for(let n=1;n<7;n++)for(let side=1;side<=2;side++){const mid=`M${n}-M${side}`,below=`M${n}-${anchors[n-1][side-1]}`,above=`M${n+1}-${anchors[n][side-1]}`;assert(linked(below,mid)&&linked(mid,below));assert(linked(mid,above)&&linked(above,mid));}
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM scenes WHERE building='본관' AND id GLOB 'M[1-7]-S[12]'").get().n,0);
 const count=f.sqlite.prepare('SELECT count(*) n FROM links').get().n;
 await f.load('lib/initialize-main-plan').initializeMainPlan();assert.equal(f.sqlite.prepare('SELECT count(*) n FROM links').get().n,count);
 f.sqlite.close();
 });

test('Gungri has five floors, three stair shafts only up to 4F, and isolated elevator service',async()=>{
 const f=fixture();await f.load('lib/initialize-main-plan').initializeMainPlan();
 const scenes=f.sqlite.prepare("SELECT * FROM scenes WHERE building='궁리관'").all();assert.equal(scenes.length,60);
 assert.equal(scenes.filter(s=>s.node_type==='stairs-mid').length,11);assert(!scenes.some(s=>s.id==='G5-S2'||s.id==='G4-M2'));
 const links=f.sqlite.prepare('SELECT * FROM links').all();const seen=new Set(['G1-S1']);for(let i=0;i<275;i++)for(const l of links)if(seen.has(l.from_scene))seen.add(l.to_scene);assert.equal(seen.size,256);
 assert(links.some(l=>l.from_scene==='M4-07'&&l.to_scene==='M4-08'));assert(links.some(l=>l.from_scene==='M4-08'&&l.to_scene==='M4-07'));
 assert.equal(links.filter(l=>l.from_scene==='G-ELV').length,5);assert(links.filter(l=>l.from_scene==='G-ELV').every(l=>l.to_scene.startsWith('G')));
 f.sqlite.close();
});

test('former connection-passage pseudo-building is completely removed',async()=>{
 const f=fixture();await f.load('lib/initialize-main-plan').initializeMainPlan();
 const linked=(a,b)=>!!f.sqlite.prepare('SELECT 1 FROM links WHERE from_scene=? AND to_scene=?').get(a,b);
 assert(linked('M4-08','M4-10')&&linked('M4-10','M4-08'));
 assert(!linked('M3-04','M3-05')&&!linked('M3-05','M3-04'));
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM scenes WHERE building='연결통로' OR id LIKE 'C2-%' OR id LIKE 'C3-%'").get().n,0);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM links WHERE from_scene LIKE 'C2-%' OR from_scene LIKE 'C3-%' OR to_scene LIKE 'C2-%' OR to_scene LIKE 'C3-%'").get().n,0);
 const count=f.sqlite.prepare('SELECT count(*) n FROM links').get().n;await f.load('lib/initialize-main-plan').initializeMainPlan();assert.equal(f.sqlite.prepare('SELECT count(*) n FROM links').get().n,count);f.sqlite.close();
});

test('2.3.0 retains the surveyed Geogyeong floors and unified outdoor campus map',async()=>{
 const f=fixture();await f.load('lib/initialize-main-plan').initializeMainPlan();
 const geogyeong=f.sqlite.prepare("SELECT * FROM scenes WHERE building='거경관'").all();
 const outdoor=f.sqlite.prepare("SELECT * FROM scenes WHERE building='야외'").all();
 assert.equal(geogyeong.length,44);assert.equal(geogyeong.filter(s=>s.node_type==='stairs-mid').length,4);
 assert.equal(outdoor.length,68);assert.equal(outdoor.filter(s=>s.node_type==='entrance').length,11);
 const linked=(a,b)=>!!f.sqlite.prepare('SELECT 1 FROM links WHERE from_scene=? AND to_scene=?').get(a,b);
 for(const [a,b] of [['O-11','M1-03'],['O-08','M1-01'],['O-24','M1-09'],['O-31','G1-02'],['O-35','G1-03'],['O-58','K1-05']])assert(linked(a,b)&&linked(b,a));
 for(const [a,b] of [['K1-S1','K1-M1'],['K1-M1','K2-S1'],['K2-S1','K2-M1'],['K2-M1','K3-S1'],['K1-S2','K1-M2'],['K2-M2','K3-S2']])assert(linked(a,b)&&linked(b,a));
 const {OUTDOOR_EDGES}=f.load('lib/outdoor-plan');assert.equal(OUTDOOR_EDGES.length,89);
 for(const [a,b] of OUTDOOR_EDGES){
   if(a===60||b===60)continue;
   const x=`O-${String(a>60?a-1:a).padStart(2,'0')}`,y=`O-${String(b>60?b-1:b).padStart(2,'0')}`;
   assert(linked(x,y)&&linked(y,x),`${x} ↔ ${y}`);
 }
 const links=f.sqlite.prepare('SELECT from_scene,to_scene FROM links').all();
 const seen=new Set(['M1-02']);for(let i=0;i<275;i++)for(const l of links)if(seen.has(l.from_scene))seen.add(l.to_scene);
 assert.equal(seen.size,256);
 const count=f.sqlite.prepare('SELECT count(*) n FROM links').get().n;await f.load('lib/initialize-main-plan').initializeMainPlan();assert.equal(f.sqlite.prepare('SELECT count(*) n FROM links').get().n,count);
 f.sqlite.close();
});

test('corrected exits have only the requested indoor endpoint, without stale guessed shortcuts',async()=>{
 const f=fixture();await f.load('lib/initialize-main-plan').initializeMainPlan();
 const indoorsFor=id=>f.sqlite.prepare("SELECT l.to_scene FROM links l JOIN scenes s ON s.id=l.to_scene WHERE l.from_scene=? AND s.building!='야외' ORDER BY l.to_scene").all(id).map(r=>r.to_scene);
 for(const [outside,inside] of [['O-11','M1-03'],['O-08','M1-01'],['O-24','M1-09'],['O-31','G1-02'],['O-35','G1-03'],['O-58','K1-05']])assert.deepEqual(indoorsFor(outside),[inside],outside);
 assert.deepEqual(indoorsFor('O-57'),[]);
 f.sqlite.close();
});

test('surveyed Gungri central corridors preserve the direct straight branch on 3F and 4F',async()=>{
 const f=fixture();await f.load('lib/initialize-main-plan').initializeMainPlan();
 for(const n of [3,4])for(const [a,b] of [[`G${n}-S2`,`G${n}-04`],[`G${n}-04`,`G${n}-S2`]])assert(f.sqlite.prepare('SELECT 1 FROM links WHERE from_scene=? AND to_scene=?').get(a,b),`${a} → ${b}`);
 f.sqlite.close();
});

test('2.3.0 graph removes mistaken nodes, then renumbers without losing media',async()=>{
 const f=fixture();await f.load('lib/initialize-main-plan').initializeMainPlan();
 const s=f.sqlite,edge=(a,b)=>Boolean(s.prepare('SELECT 1 FROM links WHERE from_scene=? AND to_scene=?').get(a,b));
 assert.equal(s.prepare('SELECT count(*) n FROM scenes').get().n,256);
 assert.equal(s.prepare("SELECT count(*) n FROM scenes WHERE building='궁리관'").get().n,60);
 assert.equal(s.prepare("SELECT count(*) n FROM scenes WHERE building='야외'").get().n,68);
 assert.equal(s.prepare("SELECT id FROM scenes WHERE id='G2-08'").get(),undefined);
 assert.equal(s.prepare("SELECT id FROM scenes WHERE id='O-69'").get(),undefined);
 assert.equal(s.prepare("SELECT node_type FROM scenes WHERE id='O-58'").get().node_type,'entrance');
 assert.equal(s.prepare('SELECT count(*) n FROM links l LEFT JOIN scenes a ON l.from_scene=a.id LEFT JOIN scenes b ON l.to_scene=b.id WHERE a.id IS NULL OR b.id IS NULL').get().n,0);
 for(const [a,b] of [['O-08','M1-01'],['O-24','M1-09'],['O-58','K1-05'],['K2-03','K2-04'],['G2-07','G2-S1'],['G2-07','K3-01'],['M2-10','G2-01'],['G2-01','G2-S2'],['G2-S2','G2-02'],['G3-01','M3-06']])assert(edge(a,b)&&edge(b,a),`${a} ↔ ${b}`);
 for(const [a,b] of [['O-08','M1-02'],['O-08','M1-09'],['K2-02','K2-03'],['G2-07','G2-01'],['G2-07','M2-10']])assert(!edge(a,b)&&!edge(b,a),`${a} ↔ ${b} should be absent`);
 assert.deepEqual(s.prepare("SELECT to_scene FROM links WHERE from_scene='G2-07' ORDER BY to_scene").all().map(r=>r.to_scene),['G2-S1','K3-01']);
 assert(edge('M2-02','M2-E')&&edge('M2-E','M2-02'));
 assert.equal(s.prepare("SELECT kind FROM links WHERE from_scene='M2-E' AND to_scene='M-ELV'").get().kind,'elevator');
 assert(!edge('M2-03','M-ELV')&&!edge('M2-02','M-ELV'));
 assert(edge('M2-01','M2-03')&&edge('M2-03','M2-01'));
 assert(!edge('M2-02','M2-03')&&!edge('M2-03','M2-02'));
 const tally=s.prepare('SELECT count(*) n FROM links').get().n;
 await f.load('lib/initialize-main-plan').initializeMainPlan();assert.equal(s.prepare('SELECT count(*) n FROM links').get().n,tally);
 f.sqlite.close();
});

test('2.3.1 Gungri third floor follows 01, S2, 04, 05, S3 without shortcuts',async()=>{
 const f=fixture();await f.load('lib/initialize-main-plan').initializeMainPlan();
 const s=f.sqlite,edge=(a,b)=>Boolean(s.prepare('SELECT 1 FROM links WHERE from_scene=? AND to_scene=?').get(a,b));
 s.prepare("UPDATE scenes SET image_8k='existing-photo.jpg',annotation='existing note' WHERE id='G3-05'").run();
 for(const [a,b] of [['G3-01','G3-S2'],['G3-S2','G3-04'],['G3-04','G3-05'],['G3-05','G3-S3']])assert(edge(a,b)&&edge(b,a),`${a} ↔ ${b}`);
 for(const [a,b] of [['G3-01','G3-05'],['G3-S2','G3-05'],['G3-04','G3-S3']])assert(!edge(a,b)&&!edge(b,a),`${a} ↔ ${b} absent`);
 const x=['G3-01','G3-S2','G3-04','G3-05','G3-S3'].map(id=>s.prepare('SELECT map_x FROM scenes WHERE id=?').get(id).map_x);
 assert(x.every((n,i)=>i===0||n>x[i-1]),'map order must be strictly left to right');
 const before=s.prepare('SELECT count(*) n FROM links').get().n;
 await f.load('lib/initialize-main-plan').initializeMainPlan();assert.equal(s.prepare('SELECT count(*) n FROM links').get().n,before);
 assert.deepEqual({...s.prepare("SELECT image_8k,annotation FROM scenes WHERE id='G3-05'").get()},{image_8k:'existing-photo.jpg',annotation:'existing note'});
 f.sqlite.close();
});

test('Gungri third floor 02 connects to 05 instead of 04',async()=>{
 const f=fixture();await f.load('lib/initialize-main-plan').initializeMainPlan();
 const s=f.sqlite,has=(a,b)=>Boolean(s.prepare('SELECT 1 FROM links WHERE from_scene=? AND to_scene=?').get(a,b));
 assert(has('G3-02','G3-05')&&has('G3-05','G3-02'));
 assert(!has('G3-02','G3-04')&&!has('G3-04','G3-02'));
 assert(has('G3-S2','G3-02')&&has('G3-02','G3-S2'));
 const [[x1,y1],[x2,y2],[px,py]]=['G3-02','G3-05','G3-04'].map(id=>{
   const row=s.prepare('SELECT map_x,map_y FROM scenes WHERE id=?').get(id);return [row.map_x,row.map_y];
 });
 const t=Math.max(0,Math.min(1,((px-x1)*(x2-x1)+(py-y1)*(y2-y1))/((x2-x1)**2+(y2-y1)**2)));
 assert(Math.hypot(px-(x1+t*(x2-x1)),py-(y1+t*(y2-y1)))>30,'02–05 line must not appear to meet 04');
 const n=s.prepare('SELECT count(*) AS n FROM links').get().n;
 await f.load('lib/initialize-main-plan').initializeMainPlan();assert.equal(s.prepare('SELECT count(*) AS n FROM links').get().n,n);
 f.sqlite.close();
});
