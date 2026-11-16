import { requireAdmin } from "@/lib/admin-auth";
import { errorResponse, fail, finiteNumber, json, safeText, sceneId } from "@/lib/http";
import { getRuntimeEnv } from "@/lib/runtime";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context) {
  try {
    await requireAdmin(request);
    const id = sceneId((await context.params).id);
    const { DB } = getRuntimeEnv();
    const previous = await DB.prepare("SELECT initial_yaw AS initialYaw,initial_pitch AS initialPitch,image_yaw AS imageYaw,image_pitch AS imagePitch FROM scenes WHERE id = ?").bind(id).first<{initialYaw:number;initialPitch:number;imageYaw:number;imagePitch:number}>();
    if (!previous) fail(409, "노드를 찾을 수 없습니다.");
    const body = await request.json() as Record<string, unknown>;
    const title = safeText(body.title, "Title", 100);
    const floor = safeText(body.floor, "Floor", 12);
    const building = safeText(body.building || "본관", "Building", 40);
    const nodeType = safeText(body.nodeType || "hall", "Node type", 40);
    const initialYaw = finiteNumber(body.initialYaw ?? previous.initialYaw, "Initial yaw", -360, 360, 90);
    const initialPitch = finiteNumber(body.initialPitch ?? previous.initialPitch, "Initial pitch", -85, 85, 0);
    const imageYaw = finiteNumber(body.imageYaw ?? previous.imageYaw, "Image yaw", -360, 360, 0);
    const imagePitch = finiteNumber(body.imagePitch ?? previous.imagePitch, "Image pitch", -90, 90, 0);
    // Arrows retain image-space anchors. Rendering applies the same rotation
    // to both the photograph and every arrow, including later position edits.
    await DB.prepare("UPDATE scenes SET title = ?, floor = ?, building = ?, node_type = ?, initial_yaw = ?, initial_pitch = ?, image_yaw = ?, image_pitch = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(title, floor, building, nodeType, initialYaw, initialPitch, imageYaw, imagePitch, id).run();
    return json({ ok: true, initialYaw, initialPitch, imageYaw, imagePitch });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    await requireAdmin(request);
    const id = sceneId((await context.params).id);
    const { DB, BUCKET } = getRuntimeEnv();
    const row = await DB.prepare("SELECT image_8k AS image8k, image_4k AS image4k, thumb, original_key AS originalKey FROM scenes WHERE id = ?").bind(id).first<{ image8k: string; image4k: string; thumb: string | null; originalKey: string | null }>();
    if (!row) fail(409, "The built-in demo node cannot be deleted until it is replaced.");
    await DB.batch([
      DB.prepare("DELETE FROM links WHERE from_scene = ? OR to_scene = ?").bind(id, id),
      DB.prepare("DELETE FROM scenes WHERE id = ?").bind(id),
      DB.prepare("DELETE FROM settings WHERE key = 'start_scene' AND value = ?").bind(id),
    ]);
    const keys = [row.image8k, row.image4k, row.thumb].filter(Boolean).map((url) => String(url).replace(/^\/api\/media\//, "")).filter((key) => /^(panos|thumbs)\//.test(key));
    if (row.originalKey) keys.push(row.originalKey);
    if (keys.length) await BUCKET.delete(keys);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
