import { getRuntimeEnv } from './runtime';

// An additive, atomic revision: uploaded images, annotations and unrelated links survive.
export async function reviseMainPlan() {
  const { DB } = getRuntimeEnv();
  const marker = 'main_plan_1_2_1';
  if (await DB.prepare('SELECT 1 FROM settings WHERE key=?').bind(marker).first()) return;
  const guard = `NOT EXISTS (SELECT 1 FROM settings WHERE key='${marker}')`;
  const q: ReturnType<typeof DB.prepare>[] = [];
  const add = (sql:string,...args:(string|number)[]) => q.push(DB.prepare(sql).bind(...args));
  add(`INSERT OR IGNORE INTO settings(key,value) SELECT 'backup_before_1_2_1',json_object('scenes',(SELECT json_group_array(json_object('id',id,'title',title,'annotation',annotation,'image_8k',image_8k,'image_4k',image_4k,'map_x',map_x,'map_y',map_y)) FROM scenes),'links',(SELECT json_group_array(json_object('from',from_scene,'to',to_scene,'yaw',yaw,'pitch',pitch,'label',label,'kind',kind)) FROM links)) WHERE ${guard}`);
  const rename=(old:string,id:string,title:string)=>{
    add(`UPDATE scenes SET id=?,title=? WHERE id=? AND ${guard}`,id,title,old);
    add(`UPDATE links SET from_scene=? WHERE from_scene=? AND ${guard}`,id,old);
    add(`UPDATE links SET to_scene=?,label=? WHERE to_scene=? AND ${guard}`,id,title,old);
    add(`UPDATE settings SET value=? WHERE key='start_scene' AND value=? AND ${guard}`,id,old);
  };
  rename('M4-05','M4-10','본관 4층 복도 10');
  rename('M4-06','M4-G','본관 4층 하늘 정원');
  const node=(id:string,title:string,floor:string,x:number,y:number,type='hall')=>add(`INSERT INTO scenes(id,title,floor,building,node_type,map_x,map_y,image_8k,image_4k,initial_yaw,initial_pitch) SELECT ?,?,?,'본관',?,?,?,'','',90,0 WHERE ${guard} AND NOT EXISTS(SELECT 1 FROM scenes WHERE id=?)`,id,title,floor,type,x,y,id);
  for(const [n,x,y] of [[5,620,35],[6,620,145],[7,750,90],[8,830,35],[9,830,145]]) node(`M4-0${n}`,`본관 4층 복도 ${n}`,'4F',x,y);
  const pair=(a:string,b:string)=>{
    for(const [from,to] of [[a,b],[b,a]]) add(`INSERT INTO links(from_scene,to_scene,yaw,pitch,label,kind) SELECT a.id,b.id,CASE WHEN b.map_x>a.map_x THEN 90 WHEN b.map_x<a.map_x THEN -90 WHEN b.map_y<a.map_y THEN 0 ELSE 180 END,-25,b.title,'walk' FROM scenes a,scenes b WHERE a.id=? AND b.id=? AND ${guard} AND NOT EXISTS(SELECT 1 FROM links WHERE from_scene=a.id AND to_scene=b.id)`,from,to);
  };
  add(`DELETE FROM links WHERE ((from_scene='M4-04' AND to_scene='M4-10') OR (from_scene='M4-10' AND to_scene='M4-04')) AND ${guard}`);
  pair('M3-04','M3-05');
  for(const [a,b] of [[4,5],[4,6],[5,7],[6,7],[5,8],[6,9],[8,9],[9,10]]) pair(`M4-${String(a).padStart(2,'0')}`,`M4-${String(b).padStart(2,'0')}`);
  for(let f=1;f<7;f++) for(let side=1;side<=2;side++) {
    const id=`M${f}-M${side}`;
    node(id,`본관 ${f}–${f+1}층 중간층 M${side}`,`${f}.5F`,side===1?424:944,90,'stairs');
    pair(`M${f}-S${side}`,id); pair(id,`M${f+1}-S${side}`);
  }
  add('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)',marker,'done');
  await DB.batch(q);
}
