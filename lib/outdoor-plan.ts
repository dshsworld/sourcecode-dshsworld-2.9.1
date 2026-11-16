import { getRuntimeEnv } from './runtime';

type OutdoorKind = 'yellow' | 'orange';
type OutdoorScene = { id:string; title:string; floor:string; type:'hall'|'entrance'; x:number; y:number };
type OutdoorEdge = [number, number, 'walk' | 'walk-green'];

const rawNodes: [OutdoorKind,number,number][] = [
  ['yellow',433,51.5],['yellow',457.7,122.8],['yellow',310.7,126.1],['orange',358.3,199],
  ['yellow',493,199.4],['yellow',635.6,247.6],['yellow',310.8,248.8],['orange',269.9,249.4],
  ['yellow',357.9,273.2],['yellow',718.2,279.2],['orange',143,301.6],['yellow',361.9,336.4],
  ['yellow',311,338.5],['yellow',534.9,355.1],['yellow',720.1,356.9],['yellow',142.9,384.7],
  ['yellow',350.3,394.4],['yellow',310.6,482.4],['yellow',720.5,506.5],['yellow',536.2,508.4],
  ['orange',328.5,519.4],['yellow',360,519.9],['yellow',312.6,635.1],['orange',211.4,635.1],
  ['yellow',717.6,652.2],['yellow',358.7,654.1],['yellow',497.9,654.9],['yellow',304.8,677.4],
  ['yellow',645.2,679.9],['yellow',145,682.2],['orange',296.7,720.1],['yellow',87.1,728.5],
  ['yellow',570,728.8],['yellow',671.1,795.7],['orange',292.2,802],['yellow',87.7,831.8],
  ['yellow',141.3,846.1],['yellow',293.8,846.5],['yellow',200,847.2],['yellow',338.9,848.6],
  ['yellow',502.8,851.5],['yellow',569,852.1],['yellow',268.2,883.7],['yellow',88.7,898.2],
  ['orange',389,901],['yellow',339.4,916.1],['yellow',139.9,920.2],['yellow',239,938.6],
  ['orange',388.9,946.5],['yellow',186.2,959.1],['orange',276.9,969.3],['yellow',238.4,970.6],
  ['yellow',340.2,984.6],['yellow',504.9,1020.8],['yellow',211.6,1032],['yellow',340.3,1065],
  ['orange',276.3,1085.1],['yellow',184.6,1085.2],['yellow',230.5,1085.9],['orange',146.5,1086.2],
  ['yellow',503.6,1100.1],['yellow',340.8,1158.7],['yellow',568.1,1160.1],['yellow',219.4,1164.2],
  ['yellow',503.7,1209.5],['yellow',218.5,1215.5],['yellow',343,1216.5],['yellow',341,1313.8],
  ['yellow',512.1,1314.6],
];

const zoneName = (x:number,y:number) => {
  if (y < 680 && x < 350) return '본관동 주변';
  if (y < 700 && x >= 350) return '운동장 주변';
  if (y < 1010 && x < 470) return '궁리관 주변';
  if (y >= 1010 && x < 310) return '거경관 주변';
  if (y >= 1180) return '정문 주변';
  return '야외 동선';
};

export const OUTDOOR_SCENES: OutdoorScene[] = rawNodes.map(([kind,x,y],index) => {
  const id=`O-${String(index+1).padStart(2,'0')}`;
  return {id,title:`${zoneName(x,y)} ${index+1}`,floor:'OUT',type:kind==='orange'?'entrance':'hall',x,y};
});

const red: [number,number][] = [
  [1,2],[2,3],[2,5],[3,7],[4,5],[6,9],[6,14],[7,8],[7,13],[9,14],[10,15],
  [11,16],[12,13],[13,18],[14,17],[14,20],[15,19],[16,30],[17,20],[17,22],[18,23],
  [19,25],[20,22],[21,22],[23,24],[23,26],[23,28],[24,30],[25,27],[26,27],[27,33],
  [27,41],[28,31],[29,33],[29,34],[30,32],[32,36],[33,34],[33,41],[33,42],[34,42],
  [35,38],[36,37],[37,39],[38,39],[38,40],[38,43],[40,41],[40,46],[41,42],[41,54],
  [44,47],[45,46],[46,49],[46,53],[47,50],[48,52],[50,52],[50,55],[51,52],[52,55],
  [53,56],[54,61],[55,59],[56,62],[57,59],[58,59],[58,60],[58,64],[59,64],[61,63],
  [61,65],[62,67],[63,65],[64,66],[65,69],[67,68],[68,69],
];
const green: [number,number][] = [
  [6,10],[9,12],[10,14],[14,15],[19,20],[20,27],[22,26],
  [36,44],[37,47],[43,48],[66,67],
];

export const OUTDOOR_EDGES: OutdoorEdge[] = [
  ...red.map(([a,b]) => [a,b,'walk'] as OutdoorEdge),
  ...green.map(([a,b]) => [a,b,'walk-green'] as OutdoorEdge),
];

export async function initializeOutdoor() {
  const { DB } = getRuntimeEnv();
  const marker='outdoor_plan_2_1_1';
  if (await DB.prepare('SELECT 1 FROM settings WHERE key=?').bind(marker).first()) return;
  const quote=(value:string|number)=>typeof value==='number'?String(value):`'${value.replaceAll("'","''")}'`;
  const sceneRows=OUTDOOR_SCENES.map(s=>`(${[s.id,s.title,s.floor,'야외',s.type,s.x,s.y,'','',90,0].map(quote).join(',')})`).join(',');
  const undirected:[string,string,string][]=[
    ...OUTDOOR_EDGES.map(([a,b,kind])=>[`O-${String(a).padStart(2,'0')}`,`O-${String(b).padStart(2,'0')}`,kind] as [string,string,string]),
    // Outdoor entrance nodes join the nearest indoor entrance/landing in each surveyed building.
    ['O-11','M1-01','walk'],['O-24','M1-03','walk'],['O-35','G1-01','walk'],['O-60','K1-01','walk'],['O-57','K1-07','walk'],
  ];
  const directed=undirected.flatMap(([a,b,kind])=>[[a,b,kind],[b,a,kind]]);
  const linkRows=directed.map(row=>`(${row.map(quote).join(',')})`).join(',');
  const q=[
    DB.prepare(`INSERT OR IGNORE INTO scenes(id,title,floor,building,node_type,map_x,map_y,image_8k,image_4k,initial_yaw,initial_pitch) VALUES ${sceneRows}`),
    DB.prepare(`WITH edge(from_id,to_id,kind) AS (VALUES ${linkRows}) INSERT INTO links(from_scene,to_scene,yaw,pitch,label,kind) SELECT a.id,b.id,CASE WHEN b.map_x>a.map_x THEN 90 WHEN b.map_x<a.map_x THEN -90 WHEN b.map_y<a.map_y THEN 0 ELSE 180 END,-25,b.title,edge.kind FROM edge JOIN scenes a ON a.id=edge.from_id JOIN scenes b ON b.id=edge.to_id WHERE NOT EXISTS(SELECT 1 FROM links WHERE from_scene=a.id AND to_scene=b.id)`),
    DB.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').bind(marker,'done'),
  ];
  await DB.batch(q);
}
