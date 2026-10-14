import { CoreError } from "./errors";

/** Aktueller Zeitpunkt als RFC-3339-Text in UTC (wie `util::now` in Rust). */
export function now(): string {
  return new Date().toISOString();
}

/** Zeitstempel für Dateinamen, z. B. `2026-10-14_105501Z`. */
export function fileStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}_${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** Millisekunden seit 1970; unlesbare Werte gelten als sehr alt. */
export function parseTs(s: string | null | undefined): number {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** Neue, zeitlich sortierbare ID (UUID v7) – gleiches Format wie in Rust. */
export function newId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let ms = Date.now();
  for (let i = 5; i >= 0; i--) {
    b[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isId(s: unknown): s is string {
  return typeof s === "string" && UUID.test(s);
}

export function requireId(s: unknown): asserts s is string {
  if (!isId(s)) throw CoreError.invalid("Ungültige Kennung.");
}

/** Steuerzeichen wie in Rust `char::is_control` (Cc). */
// eslint-disable-next-line no-control-regex
export const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** Kürzt und säubert einen Titel. Leere Titel werden abgelehnt. */
export function cleanTitle(s: string, max: number): string {
  const t = String(s ?? "").replace(CONTROL, "").trim();
  if (!t) throw CoreError.invalid("Der Titel darf nicht leer sein.");
  return Array.from(t).slice(0, max).join("");
}

/** Zeichenweise kürzen (Unicode-Codepoints, wie `chars().take(n)`). */
export function takeChars(s: string, n: number): string {
  return Array.from(s).slice(0, n).join("");
}

export function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/** Byte-Länge eines Textes in UTF-8 (wie `str::len` in Rust). */
export function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** JSON-Text sicher parsen; bei Fehlern `fallback`. */
export function parseJson<T>(s: unknown, fallback: T): T {
  if (typeof s !== "string") return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function isSha256Hex(s: unknown): s is string {
  return typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
}
