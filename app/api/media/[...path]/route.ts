import { fail } from "@/lib/http";
import { getRuntimeEnv } from "@/lib/runtime";

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const key = (await context.params).path.join("/");
    if (!/^(panos|thumbs)\/[a-z0-9/_-]+\.(webp|jpg|png)$/i.test(key)) fail(404, "Not found.");
    const object = await getRuntimeEnv().BUCKET.get(key);
    if (!object) fail(404, "Not found.");
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("ETag", object.httpEtag);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return new Response(object.body, { headers });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 500;
    return Response.json({ error: status === 500 ? "Internal server error." : (error as Error).message }, { status });
  }
}
