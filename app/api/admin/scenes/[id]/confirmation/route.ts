import { requireAdmin } from '@/lib/admin-auth';
import { errorResponse, fail, json, sceneId } from '@/lib/http';
import { getRuntimeEnv } from '@/lib/runtime';

export async function PUT(request:Request,context:{params:Promise<{id:string}>}) {
  try {
    await requireAdmin(request);
    const id=sceneId((await context.params).id);
    const body=await request.json() as {confirmed?:unknown}|null;
    if(!body||typeof body.confirmed!=='boolean')fail(400,'확인 표시 값이 올바르지 않습니다.');
    // Explicit values make retries safe and cannot overwrite concurrent uploads.
    const result=await getRuntimeEnv().DB.prepare('UPDATE scenes SET location_confirmed=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(body.confirmed?1:0,id).run();
    if(!result.meta.changes)fail(404,'노드를 찾을 수 없습니다.');
    return json({ok:true,confirmed:body.confirmed});
  } catch(error) {return errorResponse(error);}
}
