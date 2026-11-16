import { clearSessionCookie, requireAdmin } from "@/lib/admin-auth";
import { errorResponse, json } from "@/lib/http";

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    return json({ authenticated: false }, 200, { "Set-Cookie": clearSessionCookie() });
  } catch (error) {
    return errorResponse(error);
  }
}
