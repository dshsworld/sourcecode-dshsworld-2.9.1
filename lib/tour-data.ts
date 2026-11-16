import { getRuntimeEnv } from "./runtime";
import { initializeMainPlan } from "./initialize-main-plan";
import { BUILDINGS } from "./main-plan";
import { installGardenPhoto } from './garden-photo';

export type TourScene = {
  id:string; title:string; floor:string; building:string; nodeType:string;
  image8k:string; image4k:string; thumb:string|null; initialYaw:number; initialPitch:number;
  imageYaw:number; imagePitch:number;
  locationConfirmed:number;
  mapX:number|null; mapY:number|null; elevatorGroup:string|null; isStart:number; annotation:string;
};
// positioned: 0 = hidden/unplaced, 1 = estimated, 2 = manually placed (never offset by layout).
export type TourLink = { id:number; fromScene:string; toScene:string; yaw:number; pitch:number; positioned:number; label:string; kind:string };

export async function getTour() {
  await initializeMainPlan();
  await installGardenPhoto();
  const {DB}=getRuntimeEnv();
  const [sceneResult,linkResult,start]=await Promise.all([
    DB.prepare("SELECT id,title,floor,building,annotation,node_type AS nodeType,image_8k AS image8k,image_4k AS image4k,thumb,initial_yaw AS initialYaw,initial_pitch AS initialPitch,image_yaw AS imageYaw,image_pitch AS imagePitch,location_confirmed AS locationConfirmed,map_x AS mapX,map_y AS mapY,elevator_group AS elevatorGroup FROM scenes ORDER BY building,floor,id").all<TourScene>(),
    DB.prepare("SELECT id,from_scene AS fromScene,to_scene AS toScene,yaw,pitch,positioned,label,kind FROM links ORDER BY id").all<TourLink>(),
    DB.prepare("SELECT value FROM settings WHERE key='start_scene'").first<{value:string}>(),
  ]);
  return {buildings:BUILDINGS,scenes:(sceneResult.results??[]).map(s=>({...s,isStart:s.id===(start?.value||"M1-02")?1:0})),links:linkResult.results??[]};
}
export async function sceneExists(id:string) {
  await initializeMainPlan();
  return Boolean(await getRuntimeEnv().DB.prepare("SELECT 1 FROM scenes WHERE id=?").bind(id).first());
}
