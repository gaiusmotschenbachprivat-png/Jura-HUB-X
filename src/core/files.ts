/**
 * Erlaubte Dateitypen, Prüfungen beim Import und sichere Dateinamen –
 * Port der Teile von `files.rs`, die nicht den Dateispeicher selbst betreffen
 * (der liegt in `blobs.ts`).
 */
import type { BlobStore } from "./blobs";
import { CoreError } from "./errors";

export const MAX_IMPORT_BYTES = 500 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** Dateiendungen, die importiert werden dürfen, mit MIME-Typ. */
export const ALLOWED: readonly (readonly [string, string])[] = [
  ["pdf", "application/pdf"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["doc", "application/msword"],
  ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["odt", "application/vnd.oasis.opendocument.text"],
  ["txt", "text/plain"],
  ["md", "text/markdown"],
  ["markdown", "text/markdown"],
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
];

export interface StoredBlob {
  sha256: string;
  size: number;
  mime: string;
  ext: string;
}

export function mimeFor(ext: string): string | null {
  return ALLOWED.find(([e]) => e === ext)?.[1] ?? null;
}

/** Letzter Pfadbestandteil (wie `Path::file_name`). */
export function fileName(name: string): string {
  const s = String(name ?? "").replace(/\/+$/, "");
  const i = s.lastIndexOf("/");
  return i < 0 ? s : s.slice(i + 1);
}

/** Zerlegt einen Dateinamen wie Rust `Path::file_stem` / `Path::extension`. */
export function splitName(name: string): { stem: string; ext: string | null } {
  const file = fileName(name);
  if (file === "..") return { stem: file, ext: null };
  const i = file.lastIndexOf(".");
  if (i <= 0) return { stem: file, ext: null };
  return { stem: file.slice(0, i), ext: file.slice(i + 1) };
}

const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const asciiUpper = (s: string) => s.replace(/[a-z]/g, (c) => c.toUpperCase());

/** Endung in Kleinbuchstaben (nur ASCII), leer, wenn keine vorhanden. */
export function extensionOf(name: string): string {
  return asciiLower(splitName(name).ext ?? "");
}

function startsWith(b: Uint8Array, prefix: readonly number[] | string, at = 0): boolean {
  const p = typeof prefix === "string" ? Array.from(prefix, (c) => c.charCodeAt(0)) : prefix;
  if (b.length < at + p.length) return false;
  return p.every((x, i) => b[at + i] === x);
}

/** Bildtyp anhand der ersten Bytes: `[ext, mime]`. */
export function sniffImage(b: Uint8Array): [string, string] | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return ["png", "image/png"];
  if (startsWith(b, [0xff, 0xd8, 0xff])) return ["jpg", "image/jpeg"];
  if (startsWith(b, "GIF87a") || startsWith(b, "GIF89a")) return ["gif", "image/gif"];
  if (b.length > 12 && startsWith(b, "RIFF") && startsWith(b, "WEBP", 8)) return ["webp", "image/webp"];
  return null;
}

/**
 * Prüft eine Datei wie `BlobStore::import` (Endung, Größe, PDF-Signatur) und
 * legt sie im Speicher ab.
 */
export async function importFile(blobs: BlobStore, name: string, data: Blob): Promise<StoredBlob> {
  const ext = extensionOf(name);
  const mime = mimeFor(ext);
  if (!mime) {
    throw CoreError.invalid(
      `Dateityp „.${ext}“ wird nicht unterstützt. Erlaubt sind PDF, Word, PowerPoint, Excel, Text, Markdown und Bilder.`,
    );
  }
  if (data.size > MAX_IMPORT_BYTES) {
    throw CoreError.invalid("Die Datei ist größer als 500 MB und wurde nicht importiert.");
  }
  const head = new Uint8Array(await data.slice(0, 8).arrayBuffer());
  if (ext === "pdf" && !startsWith(head, "%PDF-")) {
    throw CoreError.invalid("Die Datei endet auf .pdf, ist aber keine gültige PDF-Datei.");
  }
  const { sha256, size } = await blobs.put(data);
  return { sha256, size, mime, ext };
}

/**
 * Speichert Bilddaten (z. B. eingefügte Screenshots). Nur PNG, JPEG, GIF und WebP,
 * erkannt am Dateiinhalt, höchstens 20 MB.
 */
export async function importImage(blobs: BlobStore, bytes: Uint8Array): Promise<StoredBlob> {
  if (bytes.length > MAX_IMAGE_BYTES) throw CoreError.invalid("Das Bild ist größer als 20 MB.");
  const sniffed = sniffImage(bytes);
  if (!sniffed) throw CoreError.invalid("Nur PNG-, JPEG-, GIF- und WebP-Bilder können eingefügt werden.");
  const [ext, mime] = sniffed;
  const { sha256 } = await blobs.put(bytes);
  return { sha256, size: bytes.length, mime, ext };
}

const RESERVED_WIN = [
  "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/** Leerraum wie Rust `char::is_whitespace` (Unicode White_Space). */
const WS = "\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const TRIM = new RegExp(`^[${WS}]+|[${WS}]+$`, "gu");

// eslint-disable-next-line no-control-regex
const BAD_CHAR = /[\u0000-\u001f\u007f-\u009f/\\:*?"<>|]/g;

/** Macht aus einem Titel einen Dateinamen, der unter macOS und Windows gültig ist. */
export function sanitizeFilename(name: string): string {
  let s = String(name ?? "").replace(BAD_CHAR, "_");
  s = s.replace(TRIM, "").replace(/^\.+/, "").replace(/[. ]+$/, "");
  if (!s) s = "Unbenannt";
  const stem = asciiUpper(s.split(".")[0] ?? "");
  if (RESERVED_WIN.includes(stem)) s = `_${s}`;
  return Array.from(s).slice(0, 120).join("");
}

/** Vorschlag für den Dateinamen beim Speichern einer Kopie (Befehl `suggested_file_name`). */
export function suggestedFileName(title: string, ext: string): string {
  const e = Array.from(String(ext ?? ""))
    .filter((c) => /^[A-Za-z0-9]$/.test(c))
    .slice(0, 8)
    .join("");
  return `${sanitizeFilename(title)}.${e}`;
}
