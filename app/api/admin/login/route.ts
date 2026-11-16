import { clientKey, randomToken, sessionCookie, signSession, verifyPassword } from "@/lib/admin-auth";
import { assertSameOrigin, errorResponse, fail, json } from "@/lib/http";
import { getRuntimeEnv } from "@/lib/runtime";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const SESSION_SECONDS = 8 * 60 * 60;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { DB, ADMIN_PASSWORD_HASH = "", SESSION_SECRET = "" } = getRuntimeEnv();
    if (!ADMIN_PASSWORD_HASH || SESSION_SECRET.length < 32) fail(503, "Administrator login is not configured.");
    const ipHash = await clientKey(request);
    const now = Date.now();
    const attempt = await DB.prepare("SELECT window_started_at AS windowStartedAt, count FROM login_attempts WHERE ip_hash = ?").bind(ipHash).first<{ windowStartedAt: number; count: number }>();
    if (attempt && now - attempt.windowStartedAt <= WINDOW_MS && attempt.count >= MAX_ATTEMPTS) fail(429, "Too many sign-in attempts. Try again later.");
    const body = await request.json() as { password?: string };
    if (!await verifyPassword(body.password, ADMIN_PASSWORD_HASH)) {
      if (!attempt || now - attempt.windowStartedAt > WINDOW_MS) {
        await DB.prepare("INSERT INTO login_attempts (ip_hash, window_started_at, count) VALUES (?, ?, 1) ON CONFLICT(ip_hash) DO UPDATE SET window_started_at = excluded.window_started_at, count = 1").bind(ipHash, now).run();
      } else {
        await DB.prepare("UPDATE login_attempts SET count = count + 1 WHERE ip_hash = ?").bind(ipHash).run();
      }
      fail(401, "Incorrect password.");
    }
    await DB.prepare("DELETE FROM login_attempts WHERE ip_hash = ?").bind(ipHash).run();
    const csrf = randomToken();
    const token = await signSession({ role: "admin", csrf, exp: now + SESSION_SECONDS * 1000 }, SESSION_SECRET);
    return json({ authenticated: true, csrf }, 200, { "Set-Cookie": sessionCookie(token, SESSION_SECONDS) });
  } catch (error) {
    return errorResponse(error);
  }
}
