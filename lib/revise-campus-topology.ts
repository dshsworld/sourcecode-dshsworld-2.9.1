import { getRuntimeEnv } from './runtime';

const quote = (value: string | number | null) => {
  if (value === null) return 'NULL';
  return typeof value === 'number' ? String(value) : `'${value.replaceAll("'", "''")}'`;
};

const sceneInsertSql = (
  id: string,
  title: string,
  floor: string,
  building: string,
  type: string,
  x: number,
  y: number,
) => `INSERT INTO scenes(id,title,floor,building,node_type,map_x,map_y,image_8k,image_4k,initial_yaw,initial_pitch)
      SELECT ${[id,title,floor,building,type,x,y,'','',90,0].map(quote).join(',')}
      WHERE NOT EXISTS(SELECT 1 FROM scenes WHERE id=${quote(id)})`;

const linkInsertSql = (from: string, to: string, kind = 'walk') =>
  `INSERT INTO links(from_scene,to_scene,yaw,pitch,label,kind)
      SELECT a.id,b.id,
        CASE WHEN b.map_x>a.map_x THEN 90 WHEN b.map_x<a.map_x THEN -90 WHEN b.map_y<a.map_y THEN 0 ELSE 180 END,
        -25,b.title,${quote(kind)}
      FROM scenes a,scenes b
      WHERE a.id=${quote(from)} AND b.id=${quote(to)}
        AND NOT EXISTS(SELECT 1 FROM links WHERE from_scene=${quote(from)} AND to_scene=${quote(to)})`;

const pairInsert = (a: string, b: string, kind = 'walk') => [
  linkInsertSql(a,b,kind),
  linkInsertSql(b,a,kind),
];

const pairDeleteSql = (a: string, b: string) =>
  `DELETE FROM links WHERE (from_scene=${quote(a)} AND to_scene=${quote(b)}) OR (from_scene=${quote(b)} AND to_scene=${quote(a)})`;

// Step 0: remove the former pseudo-building and all links touching its nodes.
export async function removeConnectionPassages() {
  const { DB } = getRuntimeEnv();
  const marker='remove_connection_passages_2_1_1';
  if(await DB.prepare('SELECT 1 FROM settings WHERE key=?').bind(marker).first())return;
  await DB.batch([
    DB.prepare("DELETE FROM links WHERE from_scene IN (SELECT id FROM scenes WHERE building='연결통로') OR to_scene IN (SELECT id FROM scenes WHERE building='연결통로') OR from_scene LIKE 'C2-%' OR from_scene LIKE 'C3-%' OR to_scene LIKE 'C2-%' OR to_scene LIKE 'C3-%'"),
    DB.prepare("DELETE FROM links WHERE (from_scene='G3-01' AND to_scene='K3-01') OR (from_scene='K3-01' AND to_scene='G3-01')"),
    DB.prepare("DELETE FROM scenes WHERE building='연결통로' OR id LIKE 'C2-%' OR id LIKE 'C3-%'"),
    DB.prepare("DELETE FROM settings WHERE key='connecting_passages_1_2_3'"),
    DB.prepare("DELETE FROM links WHERE (from_scene='M3-04' AND to_scene='M3-05') OR (from_scene='M3-05' AND to_scene='M3-04')"),
    DB.prepare("INSERT INTO links(from_scene,to_scene,yaw,pitch,label,kind) SELECT a.id,b.id,90,-25,b.title,'walk' FROM scenes a,scenes b WHERE a.id='M4-08' AND b.id='M4-10' AND NOT EXISTS(SELECT 1 FROM links WHERE from_scene='M4-08' AND to_scene='M4-10')"),
    DB.prepare("INSERT INTO links(from_scene,to_scene,yaw,pitch,label,kind) SELECT a.id,b.id,-90,-25,b.title,'walk' FROM scenes a,scenes b WHERE a.id='M4-10' AND b.id='M4-08' AND NOT EXISTS(SELECT 1 FROM links WHERE from_scene='M4-10' AND to_scene='M4-08')"),
    DB.prepare("UPDATE scenes SET title='본관 2층 동측 복도' WHERE id='M2-10'"),
    DB.prepare("UPDATE scenes SET title='거경관 3층 서측 복도 01' WHERE id='K3-01'"),
    DB.prepare("UPDATE scenes SET title='거경관 3층 서측 복도 02' WHERE id='K3-02'"),
    DB.prepare("UPDATE scenes SET title='거경관 3층 서측 복도 03' WHERE id='K3-03'"),
    DB.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)").bind(marker,'done'),
  ]);
}

// Step 1: add two ordinary Gungri 2F nodes from the creator's sky-blue markup.
export async function addGungriSecondFloorMarkedNodes() {
  const { DB } = getRuntimeEnv();
  const marker='add_gungri_2f_marked_nodes_2_1_1';
  if(await DB.prepare('SELECT 1 FROM settings WHERE key=?').bind(marker).first())return;
  await DB.batch([
    DB.prepare(sceneInsertSql('G2-07','궁리관 2층 연결 후보 07','2F','궁리관','hall',705,92)),
    DB.prepare(sceneInsertSql('G2-08','궁리관 2층 연결 후보 08','2F','궁리관','hall',845,92)),
    DB.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)").bind(marker,'done'),
  ]);
}

// Step 2: add one ordinary Gungri 3F node from the creator's sky-blue markup.
export async function addGungriThirdFloorMarkedNode() {
  const { DB } = getRuntimeEnv();
  const marker='add_gungri_3f_marked_node_2_1_1';
  if(await DB.prepare('SELECT 1 FROM settings WHERE key=?').bind(marker).first())return;
  await DB.batch([
    DB.prepare(sceneInsertSql('G3-05','궁리관 3층 연결 후보 05','3F','궁리관','hall',760,92)),
    DB.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)").bind(marker,'done'),
  ]);
}

// Final v2.2.0 topology cleanup requested by the creator.
export async function applyTopology220() {
  const { DB } = getRuntimeEnv();
  const marker='topology_2_2_0';
  if(await DB.prepare('SELECT 1 FROM settings WHERE key=?').bind(marker).first())return;
  const q = [
    // 3. 본관 3층 sky-blue node and connection to the new Gungri 3F node.
    DB.prepare(sceneInsertSql('M3-06','본관 3층 궁리관 연결 후보 06','3F','본관','hall',825,72)),
    ...pairInsert('M3-06','G3-05').map(sql=>DB.prepare(sql)),
    ...pairInsert('G3-05','G3-01').map(sql=>DB.prepare(sql)),

    // 4-5. Cross-building links without any special passage label.
    ...pairInsert('M2-10','G2-07').map(sql=>DB.prepare(sql)),
    ...pairInsert('G2-07','G2-08').map(sql=>DB.prepare(sql)),
    ...pairInsert('G2-07','G2-01').map(sql=>DB.prepare(sql)),
    ...pairInsert('G2-08','K3-01').map(sql=>DB.prepare(sql)),

    // 6. Insert four ordinary nodes between Geogyeong 3F node 3 and former node 6.
    DB.prepare("UPDATE scenes SET id='K3-T04' WHERE id='K3-04'"),
    DB.prepare("UPDATE scenes SET id='K3-T05' WHERE id='K3-05'"),
    DB.prepare("UPDATE scenes SET id='K3-T06' WHERE id='K3-06'"),
    DB.prepare("UPDATE scenes SET id='K3-T07' WHERE id='K3-07'"),
    DB.prepare("UPDATE scenes SET id='K3-T08' WHERE id='K3-08'"),
    DB.prepare("UPDATE scenes SET id='K3-T09' WHERE id='K3-09'"),
    DB.prepare("UPDATE scenes SET id='K3-T10' WHERE id='K3-10'"),
    DB.prepare("UPDATE scenes SET id='K3-T11' WHERE id='K3-11'"),
    DB.prepare("UPDATE scenes SET id='K3-T12' WHERE id='K3-12'"),
    DB.prepare("UPDATE scenes SET id='K3-T13' WHERE id='K3-13'"),
    DB.prepare("UPDATE links SET from_scene=replace(from_scene,'K3-04','K3-T04'), to_scene=replace(to_scene,'K3-04','K3-T04') WHERE from_scene='K3-04' OR to_scene='K3-04'"),
    DB.prepare("UPDATE links SET from_scene=replace(from_scene,'K3-05','K3-T05'), to_scene=replace(to_scene,'K3-05','K3-T05') WHERE from_scene='K3-05' OR to_scene='K3-05'"),
    DB.prepare("UPDATE links SET from_scene=replace(from_scene,'K3-06','K3-T06'), to_scene=replace(to_scene,'K3-06','K3-T06') WHERE from_scene='K3-06' OR to_scene='K3-06'"),
    DB.prepare("UPDATE links SET from_scene=replace(from_scene,'K3-07','K3-T07'), to_scene=replace(to_scene,'K3-07','K3-T07') WHERE from_scene='K3-07' OR to_scene='K3-07'"),
    DB.prepare("UPDATE links SET from_scene=replace(from_scene,'K3-08','K3-T08'), to_scene=replace(to_scene,'K3-08','K3-T08') WHERE from_scene='K3-08' OR to_scene='K3-08'"),
    DB.prepare("UPDATE links SET from_scene=replace(from_scene,'K3-09','K3-T09'), to_scene=replace(to_scene,'K3-09','K3-T09') WHERE from_scene='K3-09' OR to_scene='K3-09'"),
    DB.prepare("UPDATE links SET from_scene=replace(from_scene,'K3-10','K3-T10'), to_scene=replace(to_scene,'K3-10','K3-T10') WHERE from_scene='K3-10' OR to_scene='K3-10'"),
    DB.prepare("UPDATE links SET from_scene=replace(from_scene,'K3-11','K3-T11'), to_scene=replace(to_scene,'K3-11','K3-T11') WHERE from_scene='K3-11' OR to_scene='K3-11'"),
    DB.prepare("UPDATE links SET from_scene=replace(from_scene,'K3-12','K3-T12'), to_scene=replace(to_scene,'K3-12','K3-T12') WHERE from_scene='K3-12' OR to_scene='K3-12'"),
    DB.prepare("UPDATE links SET from_scene=replace(from_scene,'K3-13','K3-T13'), to_scene=replace(to_scene,'K3-13','K3-T13') WHERE from_scene='K3-13' OR to_scene='K3-13'"),
    DB.prepare("UPDATE scenes SET id='K3-08', title='거경관 3층 배관실 앞' WHERE id='K3-T06'"),
    DB.prepare("UPDATE scenes SET id='K3-09' WHERE id='K3-T04'"),
    DB.prepare("UPDATE scenes SET id='K3-10' WHERE id='K3-T05'"),
    DB.prepare("UPDATE scenes SET id='K3-11' WHERE id='K3-T07'"),
    DB.prepare("UPDATE scenes SET id='K3-12' WHERE id='K3-T08'"),
    DB.prepare("UPDATE scenes SET id='K3-13' WHERE id='K3-T09'"),
    DB.prepare("UPDATE scenes SET id='K3-14' WHERE id='K3-T10'"),
    DB.prepare("UPDATE scenes SET id='K3-15' WHERE id='K3-T11'"),
    DB.prepare("UPDATE scenes SET id='K3-16' WHERE id='K3-T12'"),
    DB.prepare("UPDATE scenes SET id='K3-17' WHERE id='K3-T13'"),
    DB.prepare("UPDATE links SET from_scene='K3-08' WHERE from_scene='K3-T06'"),
    DB.prepare("UPDATE links SET to_scene='K3-08' WHERE to_scene='K3-T06'"),
    DB.prepare("UPDATE links SET from_scene='K3-09' WHERE from_scene='K3-T04'"),
    DB.prepare("UPDATE links SET to_scene='K3-09' WHERE to_scene='K3-T04'"),
    DB.prepare("UPDATE links SET from_scene='K3-10' WHERE from_scene='K3-T05'"),
    DB.prepare("UPDATE links SET to_scene='K3-10' WHERE to_scene='K3-T05'"),
    DB.prepare("UPDATE links SET from_scene='K3-11' WHERE from_scene='K3-T07'"),
    DB.prepare("UPDATE links SET to_scene='K3-11' WHERE to_scene='K3-T07'"),
    DB.prepare("UPDATE links SET from_scene='K3-12' WHERE from_scene='K3-T08'"),
    DB.prepare("UPDATE links SET to_scene='K3-12' WHERE to_scene='K3-T08'"),
    DB.prepare("UPDATE links SET from_scene='K3-13' WHERE from_scene='K3-T09'"),
    DB.prepare("UPDATE links SET to_scene='K3-13' WHERE to_scene='K3-T09'"),
    DB.prepare("UPDATE links SET from_scene='K3-14' WHERE from_scene='K3-T10'"),
    DB.prepare("UPDATE links SET to_scene='K3-14' WHERE to_scene='K3-T10'"),
    DB.prepare("UPDATE links SET from_scene='K3-15' WHERE from_scene='K3-T11'"),
    DB.prepare("UPDATE links SET to_scene='K3-15' WHERE to_scene='K3-T11'"),
    DB.prepare("UPDATE links SET from_scene='K3-16' WHERE from_scene='K3-T12'"),
    DB.prepare("UPDATE links SET to_scene='K3-16' WHERE to_scene='K3-T12'"),
    DB.prepare("UPDATE links SET from_scene='K3-17' WHERE from_scene='K3-T13'"),
    DB.prepare("UPDATE links SET to_scene='K3-17' WHERE to_scene='K3-T13'"),
    DB.prepare(sceneInsertSql('K3-04','거경관 3층 연결 복도 04','3F','거경관','hall',495,148)),
    DB.prepare(sceneInsertSql('K3-05','거경관 3층 연결 복도 05','3F','거경관','hall',525,148)),
    DB.prepare(sceneInsertSql('K3-06','거경관 3층 연결 복도 06','3F','거경관','hall',555,148)),
    DB.prepare(sceneInsertSql('K3-07','거경관 3층 연결 복도 07','3F','거경관','hall',585,148)),
    DB.prepare(pairDeleteSql('K3-03','K3-08')),
    ...pairInsert('K3-03','K3-04').map(sql=>DB.prepare(sql)),
    ...pairInsert('K3-04','K3-05').map(sql=>DB.prepare(sql)),
    ...pairInsert('K3-05','K3-06').map(sql=>DB.prepare(sql)),
    ...pairInsert('K3-06','K3-07').map(sql=>DB.prepare(sql)),
    ...pairInsert('K3-07','K3-08').map(sql=>DB.prepare(sql)),

    // 7-14. Outdoor and building edge fixes.
    DB.prepare(pairDeleteSql('M1-03','M1-S1')),
    ...pairInsert('M1-03','O-11').map(sql=>DB.prepare(sql)),
    ...pairInsert('M1-02','O-08').map(sql=>DB.prepare(sql)),
    ...pairInsert('M1-10','O-24').map(sql=>DB.prepare(sql)),
    ...pairInsert('O-31','G1-02').map(sql=>DB.prepare(sql)),
    ...pairInsert('K1-05','O-60').map(sql=>DB.prepare(sql)),
    ...pairInsert('G1-03','O-35').map(sql=>DB.prepare(sql)),
    DB.prepare("UPDATE scenes SET node_type='hall' WHERE id='O-49'"),
    ...pairInsert('O-28','O-30').map(sql=>DB.prepare(sql)),

    DB.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)").bind(marker,'done'),
  ];
  await DB.batch(q);
}

// Repair the deployed 2.2.0 graph in place. Never replace scenes or their media.
export async function repairTopology220() {
  const { DB } = getRuntimeEnv();
  const marker = 'topology_2_2_0_exit_repair_1';
  if (await DB.prepare('SELECT 1 FROM settings WHERE key=?').bind(marker).first()) return;
  const q = [
    DB.prepare(`INSERT OR IGNORE INTO settings(key,value) SELECT 'backup_topology_220_exit_repair',
      json_object('links',(SELECT json_group_array(json_object('id',id,'from_scene',from_scene,'to_scene',to_scene,'yaw',yaw,'pitch',pitch,'label',label,'kind',kind)) FROM links),
      'nodes',(SELECT json_group_array(json_object('id',id,'title',title,'map_x',map_x,'map_y',map_y)) FROM scenes))`),
    // These guessed entrances predated the owner's explicit numbered mapping.
    ...[['M1-01','O-11'],['M1-03','O-24'],['G1-01','O-35'],['K1-01','O-60'],['K1-07','O-57']]
      .map(([a,b])=>DB.prepare(pairDeleteSql(a,b))),
    // Preserve the requested bidirectional exits (floors follow the existing 2.2.0 mapping).
    ...[['M1-03','O-11'],['M1-02','O-08'],['M1-10','O-24'],['G1-02','O-31'],['G1-03','O-35'],['K1-05','O-60'],['O-28','O-30'],['G4-S2','G4-04']]
      .flatMap(([a,b])=>pairInsert(a,b).map(sql=>DB.prepare(sql))),
    DB.prepare(pairDeleteSql('M1-03','M1-S1')),
    // Remove leftover provisional wording, retaining stable IDs.
    DB.prepare("UPDATE scenes SET title='궁리관 2층 복도 07' WHERE id='G2-07' AND title='궁리관 2층 연결 후보 07'"),
    DB.prepare("UPDATE scenes SET title='궁리관 2층 복도 08' WHERE id='G2-08' AND title='궁리관 2층 연결 후보 08'"),
    DB.prepare("UPDATE scenes SET title='궁리관 3층 복도 05' WHERE id='G3-05' AND title='궁리관 3층 연결 후보 05'"),
    DB.prepare("UPDATE scenes SET title='본관 3층 복도 06' WHERE id='M3-06' AND title='본관 3층 궁리관 연결 후보 06'"),
    // Even spacing along the surveyed lower corridor; no camera-heading changes.
    ...[4,5,6,7].map((n,i)=>DB.prepare(`UPDATE scenes SET map_x=?,map_y=? WHERE id=? AND map_x=? AND map_y=148`).bind(384+(658-384)*(i+1)/5,146+(136-146)*(i+1)/5,`K3-0${n}`,495+i*30)),
    DB.prepare("UPDATE scenes SET node_type='hall' WHERE id='O-49'"),
    DB.prepare("UPDATE links SET label=(SELECT title FROM scenes WHERE id=to_scene) WHERE to_scene IN ('G2-07','G2-08','G3-05','M3-06') AND label LIKE '%연결 후보%'"),
    DB.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').bind(marker,'done'),
  ];
  await DB.batch(q);
}

// Apply all route changes before changing the displayed node numbers. Keep the
// original scene data in settings for recovery; the uploaded files stay in R2.
export async function applyTopology230() {
  const { DB } = getRuntimeEnv();
  const marker = 'topology_2_3_0';
  if (await DB.prepare('SELECT 1 FROM settings WHERE key=?').bind(marker).first()) return;
  const q = [
    DB.prepare(`INSERT OR IGNORE INTO settings(key,value)
      SELECT 'backup_before_2_3_0',json_object(
        'scenes',(SELECT json_group_array(json_object('id',id,'title',title,'floor',floor,'building',building,'node_type',node_type,'map_x',map_x,'map_y',map_y,'annotation',annotation,'image_8k',image_8k,'image_4k',image_4k,'thumb',thumb,'original_key',original_key)) FROM scenes WHERE id IN ('G2-07','G2-08','O-58','O-60') OR id BETWEEN 'O-61' AND 'O-69'),
        'links',(SELECT json_group_array(json_object('id',id,'from_scene',from_scene,'to_scene',to_scene,'yaw',yaw,'pitch',pitch,'label',label,'kind',kind)) FROM links WHERE from_scene IN ('G2-07','G2-08','O-58','O-60','M2-02','M2-03','M2-10','K2-02','K2-03','K2-04') OR to_scene IN ('G2-07','G2-08','O-58','O-60','M2-02','M2-03','M2-10','K2-02','K2-03','K2-04')))`),
    // 1F entrances and the replacement Geogyeong exit.
    DB.prepare(pairDeleteSql('O-08','M1-02')),
    ...pairInsert('O-08','M1-01').map(sql=>DB.prepare(sql)),
    DB.prepare("UPDATE scenes SET node_type='entrance' WHERE id='O-58'"),
    ...pairInsert('O-58','K1-05').map(sql=>DB.prepare(sql)),
    // Geogyeong 2F: replace the short diagonal with the surveyed branch.
    DB.prepare(pairDeleteSql('K2-02','K2-03')),
    ...pairInsert('K2-03','K2-04').map(sql=>DB.prepare(sql)),
    // Gungri 2F: remove the mistaken intermediate 07, retain 08 at the
    // west stair as the only ordinary node between S1 and Geogyeong.
    ...pairInsert('G2-08','G2-S1').map(sql=>DB.prepare(sql)),
    ...pairInsert('G2-01','M2-10').map(sql=>DB.prepare(sql)),
    ...pairInsert('G2-01','G2-S2').map(sql=>DB.prepare(sql)),
    ...pairInsert('G2-S2','G2-02').map(sql=>DB.prepare(sql)),
    ...pairInsert('G3-01','M3-06').map(sql=>DB.prepare(sql)),
    DB.prepare(pairDeleteSql('M2-02','M2-E')),
    DB.prepare(linkInsertSql('M2-02','M-ELV','elevator')),
    DB.prepare(linkInsertSql('M2-03','M-ELV','elevator')),
    DB.prepare("DELETE FROM links WHERE from_scene IN ('G2-07','O-60') OR to_scene IN ('G2-07','O-60')"),
    DB.prepare("DELETE FROM scenes WHERE id IN ('G2-07','O-60')"),
    // Finish the edits first, then number the surviving nodes in order.
    DB.prepare("UPDATE scenes SET id='G2-07',title='궁리관 2층 복도 07',map_x=330,map_y=158 WHERE id='G2-08'"),
    DB.prepare("UPDATE links SET from_scene='G2-07' WHERE from_scene='G2-08'"),
    DB.prepare("UPDATE links SET to_scene='G2-07',label='궁리관 2층 복도 07' WHERE to_scene='G2-08'"),
    ...Array.from({length:9},(_,i)=>i+61).flatMap(old=>{
      const from=`O-${old}`,to=`O-${old-1}`;
      return [
        DB.prepare(`UPDATE scenes SET id=?,title=substr(title,1,length(title)-2)||? WHERE id=?`).bind(to,String(old-1),from),
        DB.prepare('UPDATE links SET from_scene=? WHERE from_scene=?').bind(to,from),
        DB.prepare('UPDATE links SET to_scene=? WHERE to_scene=?').bind(to,from),
      ];
    }),
    DB.prepare("UPDATE links SET label=(SELECT title FROM scenes WHERE id=to_scene) WHERE to_scene LIKE 'O-%' AND label LIKE '% 6%'"),
    DB.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').bind(marker,'done'),
  ];
  await DB.batch(q);
}

// Keep photographed scene identities intact while correcting the 3F corridor.
export async function applyTopology231() {
  const { DB } = getRuntimeEnv();
  const marker = 'topology_2_3_1';
  if (await DB.prepare('SELECT 1 FROM settings WHERE key=?').bind(marker).first()) return;
  await DB.batch([
    DB.prepare(`INSERT OR IGNORE INTO settings(key,value) SELECT 'backup_before_2_3_1',json_object(
      'scenes',(SELECT json_group_array(json_object('id',id,'map_x',map_x,'map_y',map_y)) FROM scenes WHERE id IN ('G3-01','G3-S2','G3-04','G3-05','G3-S3')),
      'links',(SELECT json_group_array(json_object('id',id,'from_scene',from_scene,'to_scene',to_scene,'yaw',yaw,'pitch',pitch,'label',label,'kind',kind)) FROM links WHERE from_scene IN ('G3-01','G3-S2','G3-04','G3-05','G3-S3') OR to_scene IN ('G3-01','G3-S2','G3-04','G3-05','G3-S3')))`),
    ...[['G3-01','G3-05'],['G3-S2','G3-05'],['G3-04','G3-S3']].map(([a,b])=>DB.prepare(pairDeleteSql(a,b))),
    ...[['G3-01','G3-S2'],['G3-S2','G3-04'],['G3-04','G3-05'],['G3-05','G3-S3']].flatMap(([a,b])=>pairInsert(a,b).map(sql=>DB.prepare(sql))),
    DB.prepare("UPDATE scenes SET map_y=92 WHERE id IN ('G3-01','G3-S2','G3-04','G3-05','G3-S3')"),
    DB.prepare("UPDATE scenes SET map_x=870 WHERE id='G3-05'"),
    DB.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').bind(marker,'done'),
  ]);
}

export async function applyTopology232() {
  const { DB } = getRuntimeEnv();
  const marker = 'topology_2_3_2';
  if (await DB.prepare('SELECT 1 FROM settings WHERE key=?').bind(marker).first()) return;
  await DB.batch([
    DB.prepare(`INSERT OR IGNORE INTO settings(key,value) SELECT 'backup_before_2_3_2',
      (SELECT json_group_array(json_object('id',id,'from_scene',from_scene,'to_scene',to_scene,'yaw',yaw,'pitch',pitch,'label',label,'kind',kind))
      FROM links WHERE (from_scene='G3-02' AND to_scene='G3-04') OR (from_scene='G3-04' AND to_scene='G3-02'))`),
    DB.prepare(pairDeleteSql('G3-02','G3-04')),
    ...pairInsert('G3-02','G3-05').map(sql=>DB.prepare(sql)),
    DB.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').bind(marker,'done'),
  ]);
}

// Space the surveyed 02 → 05 diagonal away from 04 on the node map.
export async function applyTopology233() {
  const { DB } = getRuntimeEnv();
  const marker = 'topology_2_3_3';
  if (await DB.prepare('SELECT 1 FROM settings WHERE key=?').bind(marker).first()) return;
  await DB.batch([
    DB.prepare(`INSERT OR IGNORE INTO settings(key,value) SELECT 'backup_before_2_3_3',
      (SELECT json_object('map_x',map_x,'map_y',map_y) FROM scenes WHERE id='G3-02')`),
    DB.prepare("UPDATE scenes SET map_x=685,map_y=185 WHERE id='G3-02'"),
    DB.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').bind(marker,'done'),
  ]);
}
