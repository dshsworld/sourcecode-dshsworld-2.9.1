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

    const fromYaw = finiteNumber(body.fromYaw, "Source yaw", -360, 360);
    const fromPitch = finiteNumber(body.fromPitch, "Source pitch", -90, 90, -18);
    const toYaw = finiteNumber(body.toYaw, "Target yaw", -360, 360);
    const toPitch = finiteNumber(body.toPitch, "Target pitch", -90, 90, -18);
    const fromLabel = safeText(body.fromLabel, "Source label", 60);
    const toLabel = safeText(body.toLabel, "Target label", 60);
    const kind = safeText(body.kind || "walk", "Link kind", 24);
    if (!["walk", "elevator", "stairs"].includes(kind)) fail(400, "Unsupported link kind.");

    const tour = await getTour();
    const alreadyConnected = tour.links.some((link) =>
      (link.fromScene === fromScene && link.toScene === toScene)
      || (link.fromScene === toScene && link.toScene === fromScene));
    if (alreadyConnected) fail(409, "Those nodes are already connected.");

    const { DB } = getRuntimeEnv();
    const insert = "INSERT INTO links (from_scene, to_scene, yaw, pitch, label, kind, positioned) VALUES (?, ?, ?, ?, ?, ?, ?)";
    await DB.batch([
      DB.prepare(insert).bind(fromScene, toScene, fromYaw, fromPitch, fromLabel, kind, 2),
      DB.prepare(insert).bind(toScene, fromScene, toYaw, toPitch, toLabel, kind, 0),
    ]);
    return json({ ok: true }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
