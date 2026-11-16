import { getRuntimeEnv } from './runtime';
// Owner's marked evacuation plan: pixel positions are schematic, not panorama headings.
const plans = [
 {f:1,top:970,points:[[600,1010],[720,1080],[780,1160],[1070,1085],[1350,1100]], paths:[['S1','E','02','S2','04','05','S3'],['E','01','02','03','04'],['S2','03']]},
 {f:2,top:785,points:[[660,885],[1160,890],[1240,820],[1320,890],[1410,825],[1440,950]],paths:[['S1','E','01','S2','02','04','S3'],['02','03','04','05','S3'],['04','06','S3']]},
 {f:3,top:585,points:[[675,680],[1040,625],[910,730],[1190,685]],paths:[['S1','E','01','S2','04','S3'],['S2','02','04'],['S2','03','04']]},
 {f:4,top:395,points:[[580,470],[980,420],[910,540],[1090,477]],paths:[['S1','E','01','S2','02','04','S3'],['S2','03','04']]},
 {f:5,top:190,points:[[590,285],[700,345],[810,288],[910,342],[934,288],[1040,222],[1044,295],[1166,285]],paths:[['S1','E','01','03','05','07','08','S3'],['01','02','03','04','07'],['05','06','08']]},
];
export const GUNG_SCENES:{id:string;title:string;floor:string;type:string;x:number;y:number}[]=[];
export const GUNG_EDGES:[string,string][]=[];
for(const p of plans){
 const make=(suffix:string,x:number,y:number,type='hall',title=`복도 ${suffix}`)=>GUNG_SCENES.push({id:`G${p.f}-${suffix}`,title:`궁리관 ${p.f}층 ${title}`,floor:`${p.f}F`,type,x:300+(x-220)*.49,y:y-p.top});
 p.points.forEach(([x,y],i)=>make(String(i+1).padStart(2,'0'),x,y));
 make('S1',250,p.top+85,'stairs','서측 계단');make('S3',1560,p.top+100,'stairs','동측 계단');
 if(p.f<5)make('S2',845,p.top+65,'stairs','중앙 계단');
 make('E',440,p.top+90,'elevator-landing','승강기 앞');
 for(const path of p.paths)for(let i=1;i<path.length;i++)GUNG_EDGES.push([`G${p.f}-${path[i-1]}`,`G${p.f}-${path[i]}`]);
}
for(let f=1;f<5;f++)for(const side of [1,2,3]){
 if(side===2&&f===4)continue;
 const id=`G${f}-M${side}`;
 GUNG_SCENES.push({id,title:`궁리관 ${f}–${f+1}층 중간층 M${side}`,floor:`${f}.5F`,type:'stairs-mid',x:side===1?315:side===2?606:957,y:90});
 GUNG_EDGES.push([`G${f}-S${side}`,id],[id,`G${f+1}-S${side}`]);
}
GUNG_SCENES.push({id:'G-ELV',title:'궁리관 승강기 내부',floor:'ELV',type:'elevator-cab',x:440,y:90});
export async function initializeGungri(){
 const {DB}=getRuntimeEnv();const marker='gungri_plan_1_3_0';
 if(await DB.prepare('SELECT 1 FROM settings WHERE key=?').bind(marker).first())return;
 const guard=`NOT EXISTS(SELECT 1 FROM settings WHERE key='${marker}')`;
 const q=GUNG_SCENES.map(s=>DB.prepare(`INSERT INTO scenes(id,title,floor,building,node_type,map_x,map_y,elevator_group,image_8k,image_4k,initial_yaw,initial_pitch) SELECT ?,?,?,'궁리관',?,?,?,?, '','',90,0 WHERE ${guard} AND NOT EXISTS(SELECT 1 FROM scenes WHERE id=?)`).bind(s.id,s.title,s.floor,s.type,s.x,s.y,s.type.startsWith('elevator')?'GUNG-A':null,s.id));
 const pair=(a:string,b:string,kind='walk')=>{for(const [from,to]of [[a,b],[b,a]])q.push(DB.prepare(`INSERT INTO links(from_scene,to_scene,yaw,pitch,label,kind) SELECT a.id,b.id,CASE WHEN b.map_x>a.map_x THEN 90 WHEN b.map_x<a.map_x THEN -90 WHEN b.map_y<a.map_y THEN 0 ELSE 180 END,-25,b.title,? FROM scenes a,scenes b WHERE a.id=? AND b.id=? AND ${guard} AND NOT EXISTS(SELECT 1 FROM links WHERE from_scene=a.id AND to_scene=b.id)`).bind(kind,from,to));};
 GUNG_EDGES.forEach(([a,b])=>pair(a,b));for(let f=1;f<=5;f++)pair(`G${f}-E`,'G-ELV','elevator');
 pair('M4-07','M4-08');
 q.push(DB.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').bind(marker,'done'));
 await DB.batch(q);
}
