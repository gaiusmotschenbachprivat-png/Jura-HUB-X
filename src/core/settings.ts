/** Einfache Schlüssel-Wert-Einstellungen (JSON-Werte), Port von `settings.rs`. */
import type { Db } from "./db";
import { CoreError } from "./errors";
import { byteLen, parseJson } from "./util";

const ALLOWED_PREFIXES = ["ui.", "backup.", "editor.", "onboarding.", "ai."];

function checkKey(key: string) {
  if (typeof key !== "string" || key.length > 64 || !ALLOWED_PREFIXES.some((p) => key.startsWith(p))) {
    throw CoreError.invalid("Unbekannte Einstellung.");
  }
}

export function get(db: Db, key: string): unknown {
  const v = db.value<string>("SELECT value FROM settings WHERE key = ?1", [key]);
  return v === undefined ? undefined : parseJson(v, undefined);
}

export function set(db: Db, key: string, value: unknown): void {
  checkKey(key);
  const s = JSON.stringify(value ?? null);
  if (byteLen(s) > 16 * 1024) throw CoreError.invalid("Der Wert ist zu groß.");
  db.run(
    "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, s],
  );
}

export function all(db: Db): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of db.all<{ key: string; value: string }>("SELECT key, value FROM settings")) {
    const v = parseJson<unknown>(r.value, undefined);
    if (v !== undefined) out[r.key] = v;
  }
  return out;
}
