import { requireAdmin } from "@/lib/admin-auth";
import { errorResponse, fail, finiteNumber, json, safeText, sceneId } from "@/lib/http";
import { getRuntimeEnv } from "@/lib/runtime";
import { getTour, sceneExists } from "@/lib/tour-data";

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const body = await request.json() as Record<string, unknown>;
    const fromScene = sceneId(body.fromScene);
    const toScene = sceneId(body.toScene);
    if (fromScene === toScene) fail(400, "A node cannot link to itself.");
    if (!await sceneExists(fromScene) || !await sceneExists(toScene)) fail(404, "Source or target node not found.");
    const yaw = finiteNumber(body.yaw, "Yaw", -360, 360);
    const pitch = finiteNumber(body.pitch, "Pitch", -90, 90, -18);
    const label = safeText(body.label, "Label", 60);
    const kind = safeText(body.kind || "walk", "Link kind", 24);
    if (!["walk", "elevator", "stairs"].includes(kind)) fail(400, "Unsupported link kind.");
    const tour = await getTour();
    if (tour.links.some((link) => link.fromScene === fromScene && link.toScene === toScene && Math.abs(link.yaw - yaw) < 0.001 && Math.abs(link.pitch - pitch) < 0.001)) fail(409, "That link already exists.");
    const result = await getRuntimeEnv().DB.prepare("INSERT INTO links (from_scene, to_scene, yaw, pitch, label, kind, positioned) VALUES (?, ?, ?, ?, ?, ?, 2)")
      .bind(fromScene, toScene, yaw, pitch, label, kind).run();
    return json({ ok: true, id: Number(result.meta.last_row_id) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
