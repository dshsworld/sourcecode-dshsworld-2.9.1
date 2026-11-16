import { assertSameOrigin, fail } from "./http";
import { getRuntimeEnv } from "./runtime";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function equalBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

export async function verifyPassword(password: unknown, encoded: string) {
  try {
    const [algorithm, saltText, expectedText] = encoded.split("$");
    if (algorithm !== "sha256" || !saltText || !expectedText) return false;
    const salt = fromBase64Url(saltText);
    const expected = fromBase64Url(expectedText);
    if (salt.length < 16 || expected.length !== 32) return false;
    const passwordBytes = encoder.encode(String(password ?? ""));
    const material = new Uint8Array(salt.length + passwordBytes.length);
    material.set(salt);
    material.set(passwordBytes, salt.length);
    const actual = new Uint8Array(await crypto.subtle.digest("SHA-256", material));
    return equalBytes(actual, expected);
  } catch {
    return false;
  }
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export type AdminSession = { role: "admin"; csrf: string; exp: number };

export async function signSession(session: AdminSession, secret: string) {
  const payload = toBase64Url(encoder.encode(JSON.stringify(session)));
  return `${payload}.${toBase64Url(await hmac(payload, secret))}`;
}

export async function verifySession(token: string | undefined, secret: string) {
  if (!token || !secret) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !equalBytes(await hmac(payload, secret), fromBase64Url(signature))) return null;
  try {
    const session = JSON.parse(decoder.decode(fromBase64Url(payload))) as AdminSession;
    return session.role === "admin" && Number.isFinite(session.exp) && session.exp > Date.now() && typeof session.csrf === "string" ? session : null;
  } catch {
    return null;
  }
}

export function parseCookies(header: string) {
  return Object.fromEntries(header.split(";").map((entry) => entry.trim().split("=", 2)).filter(([name]) => name).map(([name, value]) => [name, decodeURIComponent(value || "")]));
}

export async function getAdminSession(request: Request) {
  const { SESSION_SECRET = "" } = getRuntimeEnv();
  return verifySession(parseCookies(request.headers.get("cookie") || "").dshs_session, SESSION_SECRET);
}

export async function requireAdmin(request: Request, csrf = true) {
  const session = await getAdminSession(request);
  if (!session) fail(401, "Administrator sign-in required.");
  if (csrf) {
    assertSameOrigin(request);
    if (request.headers.get("x-csrf-token") !== session.csrf) fail(403, "Invalid CSRF token.");
  }
  return session;
}

export function sessionCookie(token: string, maxAgeSeconds: number) {
  return `dshs_session=${encodeURIComponent(token)}; HttpOnly; Secure; Path=/; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie() {
  return "dshs_session=; HttpOnly; Secure; Path=/; SameSite=Strict; Max-Age=0";
}

export async function clientKey(request: Request) {
  const address = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(address))));
}

export function randomToken(bytes = 24) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return toBase64Url(value);
}
