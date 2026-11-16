import { getAdminSession } from "@/lib/admin-auth";
import { json } from "@/lib/http";

export async function GET(request: Request) {
  const session = await getAdminSession(request);
  return json(session ? { authenticated: true, csrf: session.csrf } : { authenticated: false });
}
