import { getRuntimeEnv } from './runtime';

// Remove main 6F 01/09 and bridge 08 ↔ 10 without renumbering other nodes.
export async function reviseMainSixthFloor() {
  const { DB } = getRuntimeEnv();
  const marker='main_6f_remove_01_09_v2_9_1';
  if(await DB.prepare('SELECT 1 FROM settings WHERE key=?').bind(marker).first())return;
  const guard=`NOT EXISTS(SELECT 1 FROM settings WHERE key='${marker}')`;
  const q:ReturnType<typeof DB.prepare>[]=[];
  const add=(sql:string,...args:(string|number)[])=>q.push(DB.prepare(sql).bind(...args));
  const sceneColumns=['id','title','floor','building','node_type','map_x','map_y','elevator_group','annotation','image_8k','image_4k','thumb','original_key','initial_yaw','initial_pitch','image_yaw','image_pitch','location_confirmed','created_at','updated_at'];
  const linkColumns=['id','from_scene','to_scene','yaw','pitch','label','kind','positioned','created_at'];
  const object=(columns:string[])=>`json_object(${columns.map(k=>`'${k}',${k}`).join(',')})`;
  add(`INSERT OR IGNORE INTO settings(key,value) SELECT 'backup_before_main_6f_remove_01_09',json_object(
    'scenes',(SELECT json_group_array(${object(sceneColumns)}) FROM scenes WHERE id IN ('M6-01','M6-09')),
    'links',(SELECT json_group_array(${object(linkColumns)}) FROM links WHERE from_scene IN ('M6-01','M6-09') OR to_scene IN ('M6-01','M6-09')),
    'start',(SELECT value FROM settings WHERE key='start_scene'),
    'pending',(SELECT json_group_array(json_object('key',key,'value',value)) FROM settings WHERE key IN ('pending_insp_M6-01','pending_insp_M6-09'))) WHERE ${guard}`);
  for(const [from,to] of [['M6-08','M6-10'],['M6-10','M6-08']]) {
    // Keep the surviving photographs' manually placed arrows at the same spots.
    add(`UPDATE links SET to_scene=?,label=(SELECT title FROM scenes WHERE id=?)
      WHERE from_scene=? AND to_scene='M6-09' AND kind='walk' AND ${guard}
      AND EXISTS(SELECT 1 FROM scenes WHERE id=?)
      AND NOT EXISTS(SELECT 1 FROM links WHERE from_scene=? AND to_scene=?)`,to,to,from,to,from,to);
  }
  for(const [from,to] of [['M6-08','M6-10'],['M6-10','M6-08']]) {
    add(`INSERT INTO links(from_scene,to_scene,yaw,pitch,label,kind,positioned)
      SELECT a.id,b.id,CASE WHEN b.map_x>=a.map_x THEN 90 ELSE -90 END,-25,b.title,'walk',1
      FROM scenes a,scenes b WHERE a.id=? AND b.id=? AND ${guard}
      AND NOT EXISTS(SELECT 1 FROM links WHERE from_scene=a.id AND to_scene=b.id)`,from,to);
  }
  add(`DELETE FROM links WHERE (from_scene IN ('M6-01','M6-09') OR to_scene IN ('M6-01','M6-09')) AND ${guard}`);
  add(`DELETE FROM scenes WHERE id IN ('M6-01','M6-09') AND ${guard}`);
  add(`DELETE FROM settings WHERE key IN ('pending_insp_M6-01','pending_insp_M6-09') AND ${guard}`);
  add(`UPDATE settings SET value=CASE value WHEN 'M6-01' THEN 'M6-02' ELSE 'M6-08' END WHERE key='start_scene' AND value IN ('M6-01','M6-09') AND ${guard}`);
  // Preserve original media objects so the private snapshot remains recoverable.
  add('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)',marker,'done');
  await DB.batch(q);
}
