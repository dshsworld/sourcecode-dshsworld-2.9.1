import { getRuntimeEnv } from './runtime';

// Replace main-building S1/S2 landing nodes with the actual corridor photo.
// Half-floor M1/M2 nodes and the other buildings' stairs remain in place.
export async function removeMainStairLandings() {
  const { DB } = getRuntimeEnv();
  const marker='main_remove_S1_S2_v2_8_2';
  if(await DB.prepare('SELECT 1 FROM settings WHERE key=?').bind(marker).first()) return;
  const guard=`NOT EXISTS(SELECT 1 FROM settings WHERE key='${marker}')`;
  const candidates=await DB.prepare(`SELECT s.id AS stair,n.id AS corridor,
    abs(coalesce(s.map_x,0)-coalesce(n.map_x,0))+abs(coalesce(s.map_y,0)-coalesce(n.map_y,0)) AS distance
    FROM scenes s JOIN links l ON l.from_scene=s.id JOIN scenes n ON n.id=l.to_scene
    WHERE s.building='본관' AND s.id GLOB 'M[1-7]-S[12]' AND n.building=s.building
    AND n.floor=s.floor AND n.id NOT GLOB 'M[1-7]-S[12]' AND l.kind='walk'
    ORDER BY distance,n.id`).all<{stair:string;corridor:string;distance:number}>();
  const anchors=new Map<string,string>();
  for(const row of candidates.results||[])if(!anchors.has(row.stair))anchors.set(row.stair,row.corridor);
  // The owner's explicit first-floor replacement, where an old landing edge
  // had already been removed, takes precedence over schematic defaults.
  anchors.set('M1-S1','M1-04');
  const defaults=[['04','09'],['03','09'],['03','05'],['03','10'],['04','10'],['04','10'],['03','09']];
  const q:ReturnType<typeof DB.prepare>[]=[];
  const add=(sql:string,...args:(string|number)[])=>q.push(DB.prepare(sql).bind(...args));
  const sceneColumns=['id','title','floor','building','node_type','map_x','map_y','elevator_group','annotation','image_8k','image_4k','thumb','original_key','initial_yaw','initial_pitch','image_yaw','image_pitch','created_at','updated_at'];
  const linkColumns=['id','from_scene','to_scene','yaw','pitch','label','kind','positioned','created_at'];
  const object=(columns:string[])=>`json_object(${columns.map(k=>`'${k}',${k}`).join(',')})`;
  add(`INSERT OR IGNORE INTO settings(key,value) SELECT 'backup_before_main_remove_S1_S2',json_object(
    'scenes',(SELECT json_group_array(${object(sceneColumns)}) FROM scenes WHERE building='본관' AND id GLOB 'M[1-7]-S[12]'),
    'links',(SELECT json_group_array(${object(linkColumns)}) FROM links WHERE from_scene GLOB 'M[1-7]-S[12]' OR to_scene GLOB 'M[1-7]-S[12]'),
    'start',(SELECT value FROM settings WHERE key='start_scene'),
    'pending',(SELECT json_group_array(json_object('key',key,'value',value)) FROM settings WHERE key GLOB 'pending_insp_M[1-7]-S[12]')) WHERE ${guard}`);
  for(let floor=1;floor<=7;floor++)for(let side=1;side<=2;side++){
    const stair=`M${floor}-S${side}`,anchor=anchors.get(stair)||`M${floor}-${defaults[floor-1][side-1]}`;
    // Duplicate the corridor's existing stairs-facing arrow for each retained
    // destination. Unlike a landing photograph, its anchor belongs to this photo.
    add(`INSERT INTO links(from_scene,to_scene,yaw,pitch,positioned,label,kind)
      SELECT a.id,b.id,
        coalesce((SELECT yaw FROM links WHERE from_scene=a.id AND to_scene=? ORDER BY positioned DESC,id LIMIT 1),
          CASE WHEN abs(b.map_x-a.map_x)>=abs(b.map_y-a.map_y) THEN CASE WHEN b.map_x>=a.map_x THEN 90 ELSE -90 END ELSE CASE WHEN b.map_y<a.map_y THEN 0 ELSE 180 END END),
        coalesce((SELECT pitch FROM links WHERE from_scene=a.id AND to_scene=? ORDER BY positioned DESC,id LIMIT 1),-25),
        coalesce((SELECT positioned FROM links WHERE from_scene=a.id AND to_scene=? ORDER BY positioned DESC,id LIMIT 1),1),b.title,l.kind
      FROM links l JOIN scenes b ON b.id=l.to_scene JOIN scenes a ON a.id=?
      WHERE l.from_scene=? AND b.id!=a.id AND b.id NOT GLOB 'M[1-7]-S[12]' AND ${guard}
      AND NOT EXISTS(SELECT 1 FROM links WHERE from_scene=a.id AND to_scene=b.id)
      GROUP BY b.id`,stair,stair,stair,anchor,stair);
    // Incoming arrows remain anchored to their original photographs.
    add(`UPDATE links SET to_scene=?,label=(SELECT title FROM scenes WHERE id=?)
      WHERE to_scene=? AND from_scene!=? AND from_scene NOT GLOB 'M[1-7]-S[12]' AND ${guard}
      AND EXISTS(SELECT 1 FROM scenes WHERE id=?)
      AND NOT EXISTS(SELECT 1 FROM links existing WHERE existing.from_scene=links.from_scene AND existing.to_scene=?)`,anchor,anchor,stair,anchor,anchor,anchor);
    add(`UPDATE settings SET value=? WHERE key='start_scene' AND value=? AND ${guard}`,anchor,stair);
  }
  add(`DELETE FROM links WHERE (from_scene GLOB 'M[1-7]-S[12]' OR to_scene GLOB 'M[1-7]-S[12]') AND ${guard}`);
  add(`DELETE FROM scenes WHERE building='본관' AND id GLOB 'M[1-7]-S[12]' AND ${guard}`);
  add(`DELETE FROM settings WHERE key GLOB 'pending_insp_M[1-7]-S[12]' AND ${guard}`);
  add('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)',marker,'done');
  await DB.batch(q);
}
