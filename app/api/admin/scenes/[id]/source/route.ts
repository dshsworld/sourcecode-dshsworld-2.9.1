import { requireAdmin } from '@/lib/admin-auth';
import { errorResponse, json, sceneId, fail } from '@/lib/http';
import { getRuntimeEnv } from '@/lib/runtime';

export async function GET(request: Request, context: {params:Promise<{id:string}>}) {
  try {
    await requireAdmin(request, false);
    const id = sceneId((await context.params).id);
    const {DB,BUCKET} = getRuntimeEnv();
    const pending = await DB.prepare('SELECT value FROM settings WHERE key=?').bind(`pending_insp_${id}`).first<{value:string}>();
    if (!pending) return json({pending:false});
    const source = JSON.parse(pending.value);
    if (new URL(request.url).searchParams.get('download') !== '1') return json({pending:true,filename:source.filename,size:source.size});
    const object = await BUCKET.get(source.key);
    if (!object) fail(404,'원본 파일을 찾을 수 없습니다.');
    return new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Cache-Control':'private, no-store','Content-Disposition':`attachment; filename="${id}.insp"`}});
  } catch(error) { return errorResponse(error); }
}
