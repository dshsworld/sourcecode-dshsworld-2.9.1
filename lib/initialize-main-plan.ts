import { initializeGeogyeong } from './geogyeong-plan';
import { initializeGungri } from './gungri-plan';
import { initializeOutdoor } from './outdoor-plan';
import { addGungriSecondFloorMarkedNodes, addGungriThirdFloorMarkedNode, applyTopology220, applyTopology230, applyTopology231, applyTopology232, applyTopology233, repairTopology220, removeConnectionPassages } from './revise-campus-topology';
import { reviseMainPlan } from './revise-main-plan';
import { getRuntimeEnv } from "./runtime";
import { MAIN_SCENES, MAIN_LINKS } from "./main-plan";
import { reviseMainFirstFloor } from './revise-main-first-floor';
import { removeMainStairLandings } from './remove-main-stair-landings';
import { reviseMainSecondFloor } from './revise-main-second-floor';
import { removeMainSecondFloorNodes } from './remove-main-second-floor-nodes';
import { reviseMainSixthFloor } from './revise-main-sixth-floor';

// One atomic, guarded data replacement, explicitly requested for v1.1.1.
// Existing records and image references remain recoverable in a private snapshot.
export async function initializeMainPlan() {
  const {DB}=getRuntimeEnv();
  const marker="main_plan_1_1_1";
  if(await DB.prepare("SELECT 1 FROM settings WHERE key = ?").bind(marker).first()) { await reviseMainPlan(); await initializeGungri(); await initializeGeogyeong(); await initializeOutdoor(); await removeConnectionPassages(); await addGungriSecondFloorMarkedNodes(); await addGungriThirdFloorMarkedNode(); await applyTopology220(); await repairTopology220(); await applyTopology230(); await applyTopology231(); await applyTopology232(); await applyTopology233(); await reviseMainFirstFloor(); await removeMainStairLandings(); await reviseMainSecondFloor(); await removeMainSecondFloorNodes(); await reviseMainSixthFloor(); return; }
  const guard="NOT EXISTS (SELECT 1 FROM settings WHERE key = 'main_plan_1_1_1')";
  const archiveColumns=["id","title","floor","node_type","image_8k","image_4k","thumb","original_key","initial_yaw","initial_pitch","created_at","updated_at"];
  const snapshot=`json_object('scenes',(SELECT json_group_array(json_object(${archiveColumns.map(k=>`'${k}',${k}`).join(",")})) FROM scenes),'links',(SELECT json_group_array(json_object('id',id,'from_scene',from_scene,'to_scene',to_scene,'yaw',yaw,'pitch',pitch,'label',label,'kind',kind)) FROM links),'start',(SELECT value FROM settings WHERE key='start_scene'))`;
  const queries=[
    DB.prepare(`INSERT OR IGNORE INTO settings (key,value) SELECT 'backup_before_1_1_1',${snapshot} WHERE ${guard}`),
    DB.prepare(`DELETE FROM links WHERE ${guard}`),
    DB.prepare(`DELETE FROM scenes WHERE ${guard}`),
    DB.prepare(`DELETE FROM hidden_demo_links WHERE ${guard}`),
    DB.prepare(`DELETE FROM settings WHERE key='start_scene' AND ${guard}`),
    ...MAIN_SCENES.map(s=>DB.prepare(`INSERT INTO scenes (id,title,floor,building,node_type,map_x,map_y,elevator_group,image_8k,image_4k,initial_yaw,initial_pitch) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}`).bind(s.id,s.title,s.floor,s.building,s.nodeType,s.mapX,s.mapY,s.elevatorGroup,"","",s.initialYaw,s.initialPitch)),
    ...MAIN_LINKS.map(l=>DB.prepare(`INSERT INTO links (from_scene,to_scene,yaw,pitch,label,kind) SELECT ?,?,?,?,?,? WHERE ${guard}`).bind(l.fromScene,l.toScene,l.yaw,l.pitch,l.label,l.kind)),
    DB.prepare(`INSERT INTO settings (key,value) SELECT 'start_scene','M1-02' WHERE ${guard}`),
    DB.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES (?, 'done')").bind(marker),
  ];
  await DB.batch(queries);
  await reviseMainPlan(); await initializeGungri(); await initializeGeogyeong(); await initializeOutdoor(); await removeConnectionPassages(); await addGungriSecondFloorMarkedNodes(); await addGungriThirdFloorMarkedNode(); await applyTopology220(); await repairTopology220(); await applyTopology230(); await applyTopology231(); await applyTopology232(); await applyTopology233(); await reviseMainFirstFloor(); await removeMainStairLandings(); await reviseMainSecondFloor(); await removeMainSecondFloorNodes(); await reviseMainSixthFloor();
}
