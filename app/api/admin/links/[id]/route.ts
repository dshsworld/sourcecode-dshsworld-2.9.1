import { requireAdmin } from "@/lib/admin-auth";
import { errorResponse, fail, json, finiteNumber, safeText } from "@/lib/http";
import { getRuntimeEnv } from "@/lib/runtime";

// Position only: moving A → B must never change B, its label, or B → A.
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    const id = Number((await context.params).id);
    if (!Number.isInteger(id) || id <= 0) fail(400, "Invalid link ID.");
    const body = await request.json() as Record<string, unknown>;
    if (!body || typeof body.yaw !== "number" || typeof body.pitch !== "number") fail(400, "화살표를 놓을 위치를 선택해 주세요.");
    const yaw = finiteNumber(body.yaw, "Yaw", -360, 360);
    const pitch = finiteNumber(body.pitch, "Pitch", -90, 90);
    const result = await getRuntimeEnv().DB.prepare("UPDATE links SET yaw=?,pitch=?,positioned=2 WHERE id=?")
      .bind(yaw, pitch, id).run();
    if (!result.meta.changes) fail(404, "이 연결이 삭제되었습니다. 노드 맵을 다시 열어 주세요.");
    return json({ ok: true, id, yaw, pitch, positioned: 2 });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request:Request,context:{params:Promise<{id:string}>}) {
  try {
    await requireAdmin(request);
    const id=Number((await context.params).id);
    if(!Number.isInteger(id)||id<=0) fail(400,"Invalid link ID.");
    const body=await request.json() as Record<string,unknown>;
    const yaw=finiteNumber(body.yaw,"Yaw",-360,360);
    const pitch=finiteNumber(body.pitch,"Pitch",-90,90,-25);
    const label=safeText(body.label,"Label",60);
    const result=await getRuntimeEnv().DB.prepare("UPDATE links SET yaw=?,pitch=?,label=?,positioned=2 WHERE id=?").bind(yaw,pitch,label,id).run();
    if(!result.meta.changes) fail(404,"Link not found.");
    return json({ok:true});
  } catch(error) {return errorResponse(error);}
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    const id = Number((await context.params).id);
    if (!Number.isInteger(id) || id === 0) fail(400, "Invalid link ID.");
    const { DB } = getRuntimeEnv();
    if (id < 0) {
      await DB.prepare("INSERT OR IGNORE INTO hidden_demo_links (id) VALUES (?)").bind(id).run();
      return json({ ok: true });
    }
    const result = await DB.prepare("DELETE FROM links WHERE id = ?").bind(id).run();
    if (!result.meta.changes) fail(404, "Link not found.");
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
