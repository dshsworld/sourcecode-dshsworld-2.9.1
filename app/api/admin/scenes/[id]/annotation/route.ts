import { requireAdmin } from "@/lib/admin-auth";
import { errorResponse, fail, json, sceneId } from "@/lib/http";
import { getRuntimeEnv } from "@/lib/runtime";

export async function PUT(request:Request,context:{params:Promise<{id:string}>}) {
  try {
    await requireAdmin(request);
    const id=sceneId((await context.params).id);
    const body=await request.json() as {text?:unknown};
    if(typeof body.text!=="string" || body.text.length>5000) fail(400,"주석은 5,000자 이하로 입력해주세요.");
    const result=await getRuntimeEnv().DB.prepare("UPDATE scenes SET annotation=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(body.text,id).run();
    if(!result.meta.changes)fail(404,"노드를 찾을 수 없습니다.");
    return json({ok:true,text:body.text});
  } catch(error){ return errorResponse(error); }
}
