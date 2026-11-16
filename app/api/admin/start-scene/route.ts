import { requireAdmin } from "@/lib/admin-auth";
import { errorResponse, fail, json, sceneId } from "@/lib/http";
import { getRuntimeEnv } from "@/lib/runtime";
import { sceneExists } from "@/lib/tour-data";

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const body = await request.json() as { id?: string };
    const id = sceneId(body.id);
    if (!await sceneExists(id)) fail(404, "Node not found.");
    await getRuntimeEnv().DB.prepare("INSERT INTO settings (key, value) VALUES ('start_scene', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(id).run();
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
