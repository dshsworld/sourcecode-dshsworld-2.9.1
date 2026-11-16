export function json(payload: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Internal server error.";
  const status = typeof error === "object" && error && "status" in error
    ? Number((error as { status: number }).status)
    : 500;
  return json({ error: status === 500 ? "Internal server error." : message }, status);
}

export function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

export function safeText(value: unknown, label: string, max = 120) {
  const text = String(value ?? "").trim();
  if (!text || text.length > max || /[\u0000-\u001f]/.test(text)) fail(400, `${label} is invalid.`);
  return text;
}

export function sceneId(value: unknown) {
  const id = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(id)) fail(400, "Node ID must use A-Z, 0-9, hyphen, or underscore.");
  return id;
}

export function finiteNumber(value: unknown, label: string, min: number, max: number, fallback = 0) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) fail(400, `${label} is invalid.`);
  return parsed;
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (new URL(origin).origin !== new URL(request.url).origin) fail(403, "Cross-origin admin requests are not allowed.");
}
