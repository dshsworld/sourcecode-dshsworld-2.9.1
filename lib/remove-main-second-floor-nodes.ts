import { getRuntimeEnv } from './runtime';

// Remove only main 2F 04/08; bridge each gap without renumbering retained nodes.
export async function removeMainSecondFloorNodes() {
  const { DB } = getRuntimeEnv();
  const marker='main_2f_remove_04_08_v2_8_3';
  if(await DB.prepare('SELECT 1 FROM settings WHERE key=?').bind(marker).first()) return;
  const guard=`NOT EXISTS(SELECT 1 FROM settings WHERE key='${marker}')`;
  const q:ReturnType<typeof DB.prepare>[]=[];
  const add=(sql:string,...args:(string|number)[])=>q.push(DB.prepare(sql).bind(...args));
  const sceneColumns=['id','title','floor','building','node_type','map_x','map_y','elevator_group','annotation','image_8k','image_4k','thumb','original_key','initial_yaw','initial_pitch','image_yaw','image_pitch','created_at','updated_at'];
  const linkColumns=['id','from_scene','to_scene','yaw','pitch','label','kind','positioned','created_at'];
  const object=(columns:string[])=>`json_object(${columns.map(k=>`'${k}',${k}`).join(',')})`;
  add(`INSERT OR IGNORE INTO settings(key,value) SELECT 'backup_before_main_2f_remove_04_08',json_object(
    'scenes',(SELECT json_group_array(${object(sceneColumns)}) FROM scenes WHERE id IN ('M2-04','M2-08')),
    'links',(SELECT json_group_array(${object(linkColumns)}) FROM links WHERE from_scene IN ('M2-04','M2-08') OR to_scene IN ('M2-04','M2-08')),
    'start',(SELECT value FROM settings WHERE key='start_scene'),
    'pending',(SELECT json_group_array(json_object('key',key,'value',value)) FROM settings WHERE key IN ('pending_insp_M2-04','pending_insp_M2-08'))) WHERE ${guard}`);
  for(const [left,removed,right] of [['M2-03','M2-04','M2-05'],['M2-07','M2-08','M2-09']]) {
    // Each retained photograph keeps its existing arrow anchor toward the gap.
    for(const [from,to] of [[left,right],[right,left]]) {
      add(`UPDATE links SET to_scene=?,label=(SELECT title FROM scenes WHERE id=?)
        WHERE from_scene=? AND to_scene=? AND kind='walk' AND ${guard}
        AND EXISTS(SELECT 1 FROM scenes WHERE id=?)
        AND NOT EXISTS(SELECT 1 FROM links WHERE from_scene=? AND to_scene=?)`,to,to,from,removed,to,from,to);
    }
    for(const [from,to] of [[left,right],[right,left]]) {
      add(`INSERT INTO links(from_scene,to_scene,yaw,pitch,label,kind,positioned)
        SELECT a.id,b.id,CASE WHEN abs(b.map_x-a.map_x)>=abs(b.map_y-a.map_y) THEN CASE WHEN b.map_x>=a.map_x THEN 90 ELSE -90 END ELSE CASE WHEN b.map_y<a.map_y THEN 0 ELSE 180 END END,-25,b.title,'walk',1
        FROM scenes a,scenes b WHERE a.id=? AND b.id=? AND ${guard}
        AND NOT EXISTS(SELECT 1 FROM links WHERE from_scene=a.id AND to_scene=b.id)`,from,to);
    }
    add(`DELETE FROM links WHERE (from_scene=? OR to_scene=?) AND ${guard}`,removed,removed);
    add(`DELETE FROM scenes WHERE id=? AND ${guard}`,removed);
    add(`DELETE FROM settings WHERE key=? AND ${guard}`,`pending_insp_${removed}`);
    add(`UPDATE settings SET value=? WHERE key='start_scene' AND value=? AND ${guard}`,left,removed);
  }
  // Original media objects remain available for recovery from the snapshot.
  add('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)',marker,'done');
  await DB.batch(q);
}
