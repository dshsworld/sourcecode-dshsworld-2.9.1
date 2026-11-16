// Survey coordinates transcribed from the owner's marked main-building plan.
// These are schematic coordinates, not geographic coordinates or photo headings.
export const BUILDINGS = ["본관", "궁리관", "거경관", "야외"];
type Point = [number, number, string?];
const floors: Record<number, { top: number; points: Point[]; elevator: Point; stairs: Point[]; paths: number[][] }> = {
  1: { top: 1140, points: [[342,1158,"로비 북측"],[342,1226,"로비"],[342,1310,"로비 남측"],[425,1227],[504,1227],[589,1227],[670,1227],[754,1227],[847,1227],[944,1227]], elevator:[342,1271], stairs:[[425,1287],[945,1287]], paths:[[0,1,3,4,5,6,7,8,9]] },
  2: { top: 960, points:[[344,990,"스튜디오 앞"],[344,1032],[423,1030],[503,1030],[587,1030],[673,1030],[753,1030],[850,1030],[946,1030],[992,1030,"동측 복도"]], elevator:[345,1072], stairs:[[423,1087],[945,1087]], paths:[[0,1,2,3,4,5,6,7,8,9]] },
  3: { top: 748, points:[[291,843,"체육관 입구"],[346,802],[422,799],[500,798,"도서관 서측"],[945,799,"도서관 동측"]], elevator:[345,843], stairs:[[423,853],[945,853]], paths:[[1,2,3,4]] },
  4: { top: 542, points:[[346,579,"요양 공간 앞"],[346,606],[422,606],[505,606],[945,606],[346,689,"하늘 정원"]], elevator:[346,649], stairs:[[424,657],[944,657]], paths:[[0,1,2,3,4]] },
  5: { top: 363, points:[[296,382,"라운지 북측"],[344,382],[346,429],[422,429],[504,429],[585,429],[692,429],[785,429],[895,429],[944,429],[297,473,"라운지 남측"]], elevator:[345,472], stairs:[[421,489],[944,489]], paths:[[0,1,2,3,4,5,6,7,8,9]] },
  6: { top: 194, points:[[297,210,"라운지 북측"],[346,210],[348,253],[424,253],[507,253],[611,253],[692,253],[771,253],[876,253],[947,253],[300,297,"라운지 남측"]], elevator:[348,296], stairs:[[423,312],[944,312]], paths:[[0,1,2,3,4,5,6,7,8,9]] },
  7: { top: 0, points:[[319,21,"라운지 북측"],[348,68],[424,67],[507,67],[611,67],[692,67],[771,67],[876,67],[947,67],[300,111,"라운지 남측"]], elevator:[348,110], stairs:[[423,127],[945,127]], paths:[[0,1,2,3,4,5,6,7,8]] },
};
export type PlanScene = { id:string; title:string; floor:string; building:string; nodeType:string; mapX:number; mapY:number; elevatorGroup:string|null; image8k:string; image4k:string; thumb:null; initialYaw:number; initialPitch:number };
export const MAIN_SCENES: PlanScene[] = [];
export const MAIN_LINKS: {fromScene:string;toScene:string;yaw:number;pitch:number;label:string;kind:string}[] = [];
const connect = (a:PlanScene,b:PlanScene,kind="walk") => {
  const yaw = Math.atan2(b.mapX-a.mapX, a.mapY-b.mapY)*180/Math.PI;
  MAIN_LINKS.push({fromScene:a.id,toScene:b.id,yaw,pitch:-25,label:b.title,kind}, {fromScene:b.id,toScene:a.id,yaw:((yaw+360)%360)-180,pitch:-25,label:a.title,kind});
};
for (let f=1;f<=7;f++) {
  const plan=floors[f];
  const make = (id:string, point:Point, nodeType="hall", label?:string):PlanScene => {
    const scene:PlanScene={id:`M${f}-${id}`,title:`본관 ${f}층 ${label || point[2] || `복도 ${id}`}`,floor:`${f}F`,building:"본관",nodeType,mapX:point[0],mapY:point[1]-plan.top,elevatorGroup:nodeType==="elevator-landing"?"MAIN-A":null,image8k:"",image4k:"",thumb:null,initialYaw:90,initialPitch:0};
    MAIN_SCENES.push(scene); return scene;
  };
  const points=plan.points.map((p,i)=>make(String(i+1).padStart(2,"0"),p));
  const elevator=make("E",plan.elevator,"elevator-landing","엘리베이터 앞");
  const stairs=plan.stairs.map((p,i)=>make(`S${i+1}`,p,"stairs",`${i===0?"서측":"동측"} 계단 앞`));
  plan.paths.forEach(path=>path.slice(1).forEach((n,i)=>connect(points[path[i]],points[n])));
  const elbow=f===1||f===2||f===4||f===7?1:f===3?1:2;
  connect(points[elbow],elevator);
  if(f===1) connect(elevator,points[2]);
  if(f===3) connect(elevator,points[0]);
  if(f===4) connect(elevator,points[5]);
  if(f>=5) connect(elevator,points[points.length-1]);
  connect(points[f===3?2:elbow+1],stairs[0]);
  connect(points[f===1?9:f===2?8:f===3||f===4?4:f===7?8:9],stairs[1]);
}
MAIN_SCENES.push({id:"M-ELV",title:"본관 엘리베이터 내부",building:"본관",floor:"ELV",nodeType:"elevator-cab",mapX:210,mapY:90,elevatorGroup:"MAIN-A",image8k:"",image4k:"",thumb:null,initialYaw:0,initialPitch:0});
// Cab service edges are explicit; the UI chooses a destination before opening doors.
for(const landing of MAIN_SCENES.filter(s=>s.nodeType==="elevator-landing")) {
  MAIN_LINKS.push({fromScene:landing.id,toScene:"M-ELV",yaw:0,pitch:-12,label:"엘리베이터 들어가기",kind:"elevator"});
  MAIN_LINKS.push({fromScene:"M-ELV",toScene:landing.id,yaw:0,pitch:-12,label:`${landing.floor} 문 열고 나가기`,kind:"elevator"});
}
