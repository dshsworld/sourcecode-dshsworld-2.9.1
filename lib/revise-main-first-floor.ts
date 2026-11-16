import { getRuntimeEnv } from './runtime';

// Remove only former 06; connect former 05 ↔ 07, then shift 07–10 down by one.
// Media and photo-relative arrow anchors stay attached to the retained scenes.
export async function reviseMainFirstFloor() {
  const { DB } = getRuntimeEnv();
  const marker='main_1f_remove_only_06_v2_8_2';
  if (await DB.prepare('SELECT 1 FROM settings WHERE key=?').bind(marker).first()) return;
  const guard=`NOT EXISTS (SELECT 1 FROM settings WHERE key='${marker}')`;
  const q: ReturnType<typeof DB.prepare>[]=[];
  const add=(sql:string,...args:(string|number)[])=>q.push(DB.prepare(sql).bind(...args));
  const sceneColumns=['id','title','floor','building','node_type','map_x','map_y','elevator_group','annotation','image_8k','image_4k','thumb','original_key','initial_yaw','initial_pitch','image_yaw','image_pitch','created_at','updated_at'];
  const linkColumns=['id','from_scene','to_scene','yaw','pitch','label','kind','positioned','created_at'];
  const object=(columns:string[])=>`json_object(${columns.map(key=>`'${key}',${key}`).join(',')})`;
  add(`INSERT OR IGNORE INTO settings(key,value) SELECT 'backup_before_remove_only_M1_06',json_object(
    'scenes',(SELECT json_group_array(${object(sceneColumns)}) FROM scenes WHERE id LIKE 'M1-%'),
    'links',(SELECT json_group_array(${object(linkColumns)}) FROM links WHERE from_scene LIKE 'M1-%' OR to_scene LIKE 'M1-%'),
    'start',(SELECT value FROM settings WHERE key='start_scene'),
    'pending',(SELECT json_group_array(json_object('key',key,'value',value)) FROM settings WHERE key LIKE 'pending_insp_M1-%')) WHERE ${guard}`);
  // Reuse the surviving endpoints' arrows so their manual floor positions survive.
  for(const [from,to] of [['M1-05','M1-07'],['M1-07','M1-05']]) {
    add(`UPDATE links SET to_scene=?,label=(SELECT title FROM scenes WHERE id=?)
      WHERE from_scene=? AND to_scene='M1-06' AND kind='walk' AND ${guard}
      AND EXISTS(SELECT 1 FROM scenes WHERE id=?)
      AND NOT EXISTS(SELECT 1 FROM links WHERE from_scene=? AND to_scene=?)`,to,to,from,to,from,to);
    add(`INSERT INTO links(from_scene,to_scene,yaw,pitch,label,kind,positioned)
      SELECT a.id,b.id,CASE WHEN b.map_x>a.map_x THEN 90 WHEN b.map_x<a.map_x THEN -90 WHEN b.map_y<a.map_y THEN 0 ELSE 180 END,-25,b.title,'walk',1
      FROM scenes a,scenes b WHERE a.id=? AND b.id=? AND ${guard}
      AND NOT EXISTS(SELECT 1 FROM links WHERE from_scene=a.id AND to_scene=b.id)`,from,to);
  }
  add(`DELETE FROM links WHERE (from_scene='M1-06' OR to_scene='M1-06') AND ${guard}`);
  add(`DELETE FROM scenes WHERE id='M1-06' AND ${guard}`);
  add(`DELETE FROM settings WHERE key='pending_insp_M1-06' AND ${guard}`);
  add(`UPDATE settings SET value='M1-02' WHERE key='start_scene' AND value='M1-06' AND ${guard}`);
  for(let old=7;old<=10;old++) {
    const before=String(old).padStart(2,'0'),after=String(old-1).padStart(2,'0');
    const from=`M1-${before}`,to=`M1-${after}`;
    add(`UPDATE scenes SET id=?,title=CASE WHEN title IN (?,?) THEN ? ELSE title END WHERE id=? AND ${guard}`,
      to,`본관 1층 복도 ${before}`,`본관 1층 복도${before}`,`본관 1층 복도 ${after}`,from);
    add(`UPDATE links SET from_scene=? WHERE from_scene=? AND ${guard}`,to,from);
    add(`UPDATE links SET to_scene=?,label=CASE WHEN label IN (?,?) THEN (SELECT title FROM scenes WHERE id=?) ELSE label END WHERE to_scene=? AND ${guard}`,
      to,`본관 1층 복도 ${before}`,`본관 1층 복도${before}`,to,from);
    add(`UPDATE settings SET value=? WHERE key='start_scene' AND value=? AND ${guard}`,to,from);
    add(`UPDATE settings SET key=? WHERE key=? AND ${guard}`,`pending_insp_${to}`,`pending_insp_${from}`);
  }
  add('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)',marker,'done');
  await DB.batch(q);
}
