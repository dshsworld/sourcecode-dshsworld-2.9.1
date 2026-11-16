import { getRuntimeEnv } from './runtime';

// Main 2F: elevator landing ↔ 02 ↔ 01 ↔ 03. Keep all photographs and IDs.
export async function reviseMainSecondFloor() {
  const { DB } = getRuntimeEnv();
  const marker='main_2f_elevator_02_01_03_v2_8_2';
  if(await DB.prepare('SELECT 1 FROM settings WHERE key=?').bind(marker).first()) return;
  const guard=`NOT EXISTS(SELECT 1 FROM settings WHERE key='${marker}')`;
  const q:ReturnType<typeof DB.prepare>[]=[];
  const add=(sql:string,...args:(string|number)[])=>q.push(DB.prepare(sql).bind(...args));
  add(`INSERT OR IGNORE INTO settings(key,value) SELECT 'backup_before_main_2f_02_01_03',
    (SELECT json_group_array(json_object('id',id,'from_scene',from_scene,'to_scene',to_scene,'yaw',yaw,'pitch',pitch,'positioned',positioned,'label',label,'kind',kind,'created_at',created_at))
      FROM links WHERE from_scene IN ('M2-01','M2-02','M2-03','M2-E') OR to_scene IN ('M2-01','M2-02','M2-03','M2-E')) WHERE ${guard}`);
  // Retarget existing stairs/corridor-facing and elevator-facing arrows without
  // discarding their manually placed photo coordinates.
  for(const [from,before,after] of [['M2-03','M2-02','M2-01'],['M2-02','M-ELV','M2-E']]) {
    add(`UPDATE links SET to_scene=?,label=(SELECT title FROM scenes WHERE id=?),kind='walk'
      WHERE from_scene=? AND to_scene=? AND ${guard}
      AND EXISTS(SELECT 1 FROM scenes WHERE id=?)
      AND NOT EXISTS(SELECT 1 FROM links WHERE from_scene=? AND to_scene=?)`,after,after,from,before,after,from,after);
  }
  for(const [a,b] of [['M2-03','M2-02'],['M2-03','M-ELV'],['M2-02','M-ELV']]) {
    add(`DELETE FROM links WHERE ((from_scene=? AND to_scene=?) OR (from_scene=? AND to_scene=?)) AND ${guard}`,a,b,b,a);
  }
  for(const [a,b] of [['M2-E','M2-02'],['M2-02','M2-01'],['M2-01','M2-03']]) {
    for(const [from,to] of [[a,b],[b,a]]) {
      add(`INSERT INTO links(from_scene,to_scene,yaw,pitch,label,kind,positioned)
        SELECT a.id,b.id,CASE WHEN abs(b.map_x-a.map_x)>=abs(b.map_y-a.map_y) THEN CASE WHEN b.map_x>=a.map_x THEN 90 ELSE -90 END ELSE CASE WHEN b.map_y<a.map_y THEN 0 ELSE 180 END END,-25,b.title,'walk',1
        FROM scenes a,scenes b WHERE a.id=? AND b.id=? AND ${guard}
        AND NOT EXISTS(SELECT 1 FROM links WHERE from_scene=a.id AND to_scene=b.id)`,from,to);
    }
  }
  // The landing's existing M2-E ↔ M-ELV service still handles entering/exiting.
  add('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)',marker,'done');
  await DB.batch(q);
}
