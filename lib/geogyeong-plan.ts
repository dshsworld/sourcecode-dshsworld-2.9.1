import { getRuntimeEnv } from './runtime';

type GeogyeongScene = {
  id: string;
  title: string;
  floor: string;
  type: 'hall' | 'stairs' | 'stairs-mid';
  x: number;
  y: number;
};

type GeogyeongEdge = [string, string];

const x = (raw: number) => Math.round(300 + (raw - 30) * 0.62);
const scene = (id:string,title:string,floor:string,type:GeogyeongScene['type'],rawX:number,y:number):GeogyeongScene => ({
  id,
  title: `거경관 ${floor.replace('F','층')} ${title}`,
  floor,
  type,
  x:x(rawX),
  y,
});

// The locations below are transcribed from the creator's three-floor sketch.
// Coordinates are schematic positions for the node map, not camera headings.
export const GEOGYEONG_SCENES: GeogyeongScene[] = [
  scene('K3-01','서측 복도 01','3F','hall',39,58),
  scene('K3-02','서측 복도 02','3F','hall',164,56),
  scene('K3-03','서측 복도 03','3F','hall',165,146),
  scene('K3-04','세컨더리실 서측','3F','hall',344,78),
  scene('K3-05','세컨더리실 동측','3F','hall',528,75),
  scene('K3-06','배관실 앞','3F','hall',607,136),
  scene('K3-S1','중앙 계단 앞','3F','stairs',688,92),
  scene('K3-07','메이커 연구실 앞','3F','hall',759,96),
  scene('K3-08','메이커 연구실 북측','3F','hall',803,56),
  scene('K3-09','토론 공간 남측','3F','hall',839,148),
  scene('K3-10','학생 공간 북측','3F','hall',889,68),
  scene('K3-11','상담 공간 북측','3F','hall',941,70),
  scene('K3-12','상담 공간 남측','3F','hall',944,120),
  scene('K3-13','연구실 북측','3F','hall',1035,34),
  scene('K3-S2','동측 계단 앞','3F','stairs',1045,112),

  scene('K2-01','미술실 1 앞','2F','hall',367,70),
  scene('K2-02','미술실 2 앞','2F','hall',473,72),
  scene('K2-03','미술실 2 동측','2F','hall',557,70),
  scene('K2-04','미술존 복도 서측','2F','hall',437,132),
  scene('K2-05','배관실 앞','2F','hall',617,130),
  scene('K2-S1','중앙 계단 앞','2F','stairs',694,90),
  scene('K2-06','3D 프린터실 북측','2F','hall',820,54),
  scene('K2-07','3D 프린터실 남측','2F','hall',818,92),
  scene('K2-08','아두이노실 북측','2F','hall',977,54),
  scene('K2-09','아두이노실 남측','2F','hall',978,92),
  scene('K2-10','3D 프린터실 동측','2F','hall',1024,126),
  scene('K2-S2','동측 계단 앞','2F','stairs',1092,72),

  scene('K1-01','보컬 연습실 앞','1F','hall',244,116),
  scene('K1-02','음악실 앞','1F','hall',400,96),
  scene('K1-03','음악존 중앙 복도','1F','hall',552,94),
  scene('K1-04','밴드실 앞','1F','hall',555,62),
  scene('K1-05','보관실 앞','1F','hall',554,130),
  scene('K1-S1','중앙 계단 앞','1F','stairs',692,92),
  scene('K1-06','메이커스페이스 실습실 앞','1F','hall',817,86),
  scene('K1-07','메이커스페이스 앞','1F','hall',985,86),
  scene('K1-S2','동측 계단 앞','1F','stairs',1090,74),

  scene('K1-M1','1–2층 중앙 계단 중간층','1.5F','stairs-mid',693,88),
  scene('K1-M2','1–2층 동측 계단 중간층','1.5F','stairs-mid',1090,88),
  scene('K2-M1','2–3층 중앙 계단 중간층','2.5F','stairs-mid',693,88),
  scene('K2-M2','2–3층 동측 계단 중간층','2.5F','stairs-mid',1090,88),
];

export const GEOGYEONG_EDGES: GeogyeongEdge[] = [
  ['K3-01','K3-02'],['K3-02','K3-03'],['K3-03','K3-04'],['K3-04','K3-05'],
  ['K3-05','K3-06'],['K3-03','K3-06'],['K3-06','K3-S1'],['K3-S1','K3-07'],
  ['K3-07','K3-08'],['K3-07','K3-09'],['K3-07','K3-10'],['K3-09','K3-12'],
  ['K3-10','K3-11'],['K3-11','K3-12'],['K3-11','K3-13'],['K3-12','K3-S2'],
  ['K3-13','K3-S2'],

  ['K2-01','K2-04'],['K2-02','K2-04'],['K2-02','K2-03'],['K2-04','K2-05'],
  ['K2-05','K2-S1'],['K2-S1','K2-07'],['K2-06','K2-07'],['K2-06','K2-08'],
  ['K2-07','K2-09'],['K2-08','K2-09'],['K2-09','K2-10'],['K2-08','K2-S2'],

  ['K1-01','K1-02'],['K1-02','K1-03'],['K1-03','K1-04'],['K1-03','K1-05'],
  ['K1-03','K1-S1'],['K1-S1','K1-06'],['K1-06','K1-07'],['K1-07','K1-S2'],

  ['K1-S1','K1-M1'],['K1-M1','K2-S1'],['K2-S1','K2-M1'],['K2-M1','K3-S1'],
  ['K1-S2','K1-M2'],['K1-M2','K2-S2'],['K2-S2','K2-M2'],['K2-M2','K3-S2'],
];

export async function initializeGeogyeong() {
  const { DB } = getRuntimeEnv();
  const marker = 'geogyeong_plan_2_1_1';
  if (await DB.prepare('SELECT 1 FROM settings WHERE key=?').bind(marker).first()) return;
  const quote=(value:string|number)=>typeof value==='number'?String(value):`'${value.replaceAll("'","''")}'`;
  const sceneRows=GEOGYEONG_SCENES.map(s=>`(${[s.id,s.title,s.floor,'거경관',s.type,s.x,s.y,'','',90,0].map(quote).join(',')})`).join(',');
  const undirected:[string,string,string][]=GEOGYEONG_EDGES.map(([a,b])=>[a,b,'walk'] as [string,string,string]);
  const directed=undirected.flatMap(([a,b,kind])=>[[a,b,kind],[b,a,kind]]);
  const linkRows=directed.map(row=>`(${row.map(quote).join(',')})`).join(',');
  const q=[
    DB.prepare(`INSERT OR IGNORE INTO scenes(id,title,floor,building,node_type,map_x,map_y,image_8k,image_4k,initial_yaw,initial_pitch) VALUES ${sceneRows}`),
    DB.prepare(`WITH edge(from_id,to_id,kind) AS (VALUES ${linkRows}) INSERT INTO links(from_scene,to_scene,yaw,pitch,label,kind) SELECT a.id,b.id,CASE WHEN b.map_x>a.map_x THEN 90 WHEN b.map_x<a.map_x THEN -90 WHEN b.map_y<a.map_y THEN 0 ELSE 180 END,-25,b.title,edge.kind FROM edge JOIN scenes a ON a.id=edge.from_id JOIN scenes b ON b.id=edge.to_id WHERE NOT EXISTS(SELECT 1 FROM links WHERE from_scene=a.id AND to_scene=b.id)`),
    DB.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').bind(marker,'done'),
  ];
  await DB.batch(q);
}
