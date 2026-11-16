import { getRuntimeEnv } from "./runtime";

// A single aggregate only: no visitor identifiers or per-visit records.
export async function visitCount(increment = false) {
  const { DB } = getRuntimeEnv();
  const row = increment
    ? await DB.prepare("INSERT INTO settings (key, value) VALUES ('page_visits', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(settings.value AS INTEGER) + 1 AS TEXT) RETURNING value").first<{ value: string }>()
    : await DB.prepare("SELECT value FROM settings WHERE key = 'page_visits'").first<{ value: string }>();
  return Number(row?.value ?? 0);
}
