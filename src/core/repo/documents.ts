/**
 * Dokumente (PDF, DOCX, Bilder …), ihre Zuordnungen und ihr extrahierter Text –
 * Port von `repo/documents.rs` und den Befehlen aus `commands/documents.rs`
 * bzw. `commands/learning.rs` (Bilder in Notizen).
 *
 * Datenbankfunktionen sind synchron. Wo Rust den Dateispeicher berührt, gibt es
 * eine asynchrone Hülle mit `Ctx`: erst die Datei (async), dann die Transaktion (sync).
 */
import type { DocScope, DocumentDetail, DocumentInfo, ImportOutcome, Placement, TextStatus } from "../../api/types";
import type { BlobStore } from "../blobs";
import type { Ctx } from "../ctx";
import type { Db } from "../db";
import { CoreError, toCmdError } from "../errors";
import { fileName, importFile, importImage, splitName, type StoredBlob } from "../files";
import * as search from "../search";
import { cleanTitle, CONTROL, newId, now, requireId } from "../util";
import * as nodes from "./nodes";

export const DOC_TYPES = [
  "folien", "skript", "uebungsblatt", "loesung", "mitschrift", "gesetz", "aufsatz", "urteil", "klausur",
  "aufnahme", "sonstiges",
];

/** Höchstmenge an Text je Seite, die indexiert wird. */
const MAX_PAGE_TEXT = 200_000;
const MAX_PAGES = 20_000;
/** Höchstzahl an Dateien je Import (Befehl `documents_import`). */
const MAX_IMPORT_FILES = 500;

/** Was zum Prüfen von `file_present` nötig ist (`None` in Rust → `null`). */
export type Presence = Pick<BlobStore, "has"> | null | undefined;

type DocRow = {
  id: string;
  blob_sha: string;
  title: string;
  original_name: string;
  ext: string;
  mime: string;
  size: number | bigint;
  doc_type: string;
  page_count: number | bigint | null;
  text_status: TextStatus;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

function fromRow(r: DocRow, store: Presence): DocumentInfo {
  return {
    id: r.id,
    title: r.title,
    original_name: r.original_name,
    ext: r.ext,
    mime: r.mime,
    size: Number(r.size),
    doc_type: r.doc_type,
    page_count: r.page_count === null ? null : Number(r.page_count),
    text_status: r.text_status,
    created_at: r.created_at,
    updated_at: r.updated_at,
    deleted_at: r.deleted_at,
    file_present: store ? store.has(r.blob_sha) : true,
  };
}

const SELECT = "SELECT d.*, b.mime, b.size FROM documents d JOIN blobs b ON b.sha256 = d.blob_sha";

/** Die ersten `n` Zeichen (Codepoints), ohne große Texte vollständig zu zerlegen. */
function takeChars(s: string, n: number): string {
  if (s.length <= n) return s;
  let count = 0;
  let end = 0;
  for (const ch of s) {
    if (count === n) break;
    end += ch.length;
    count++;
  }
  return s.slice(0, end);
}

function charCount(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export function get(db: Db, store: Presence, id: string): DocumentInfo {
  requireId(id);
  const r = db.get<DocRow>(`${SELECT} WHERE d.id = ?1`, [id]);
  if (!r) throw CoreError.notFound("Dokument nicht gefunden.");
  return fromRow(r, store);
}

export function blobSha(db: Db, id: string): string {
  const sha = db.value<string>("SELECT blob_sha FROM documents WHERE id = ?1", [id]);
  if (sha === undefined) throw CoreError.notFound("Dokument nicht gefunden.");
  return sha;
}

/**
 * Text-Dateien werden sofort indexiert; PDF und DOCX extrahiert die Oberfläche
 * (pdf.js / mammoth) und liefert den Text über `setText` nach.
 */
function initialTextStatus(ext: string): TextStatus {
  switch (ext) {
    case "pdf":
    case "docx":
      return "pending";
    case "txt":
    case "md":
    case "markdown":
      return "ok";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "m4a":
    case "mp3":
    case "wav":
    case "webm":
      return "none";
    default:
      return "unsupported";
  }
}

function titleFromName(name: string): string {
  const t = splitName(name).stem.replace(/_/g, " ").trim();
  return t ? takeChars(t, 300) : "Dokument";
}

/** Dateiname, wie er gespeichert wird: ohne Steuerzeichen, höchstens 255 Zeichen. */
export function cleanOriginalName(name: string): string {
  const base = fileName(name) || "Datei";
  return takeChars(base.replace(CONTROL, ""), 255);
}

/** Vorprüfungen von `import`, bevor die Datei in den Speicher kommt. */
export function checkImport(db: Db, nodeId: string | null, docType: string): void {
  if (!DOC_TYPES.includes(docType)) throw CoreError.invalid("Unbekannter Dokumenttyp.");
  if (nodeId !== null) {
    requireId(nodeId);
    nodes.get(db, nodeId);
  }
}

/** Liest Textdateien für den Index wie `String::from_utf8_lossy` (eine Seite). */
export async function textPagesFor(blob: StoredBlob, data: Blob): Promise<string[] | null> {
  if (initialTextStatus(blob.ext) !== "ok") return null;
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await data.arrayBuffer());
  return [takeChars(text, MAX_PAGE_TEXT)];
}

/**
 * Datenbankteil von `import`: Datensatz, Zuordnung, Index. Die Datei liegt
 * bereits im Speicher (`blob`); `textPages` nur für Textdateien.
 */
export function insertImported(
  db: Db,
  store: Presence,
  blob: StoredBlob,
  name: string,
  nodeId: string | null,
  docType: string,
  textPages: string[] | null,
): DocumentInfo {
  checkImport(db, nodeId, docType);
  const originalName = cleanOriginalName(name);
  const title = titleFromName(originalName);
  const id = newId();
  const ts = now();
  const status = initialTextStatus(blob.ext);
  const pages = status === "ok" ? textPages ?? [""] : null;
  return db.tx(() => {
    db.run("INSERT OR IGNORE INTO blobs (sha256, size, mime, created_at) VALUES (?1, ?2, ?3, ?4)", [
      blob.sha256,
      blob.size,
      blob.mime,
      ts,
    ]);
    db.run(
      `INSERT INTO documents (id, blob_sha, title, original_name, ext, doc_type, page_count, text_status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
      [id, blob.sha256, title, originalName, blob.ext, docType, pages ? pages.length : null, status, ts],
    );
    if (nodeId !== null) {
      db.run("INSERT INTO placements (document_id, node_id, created_at) VALUES (?1, ?2, ?3)", [id, nodeId, ts]);
    }
    search.put(db, "document", id, null, null, title, originalName);
    if (pages) writePages(db, id, title, pages);
    return get(db, store, id);
  });
}

/** Importiert eine Datei: Kopie in den Speicher, Datensatz, Zuordnung, Index. */
export async function importDocument(
  ctx: Ctx,
  name: string,
  data: Blob,
  nodeId: string | null,
  docType: string,
): Promise<DocumentInfo> {
  checkImport(ctx.db, nodeId, docType);
  const blob = await importFile(ctx.blobs, name, data);
  const pages = await textPagesFor(blob, data);
  return insertImported(ctx.db, ctx.blobs, blob, name, nodeId, docType, pages);
}

/**
 * Befehl `documents_import`: jede Datei wird einzeln behandelt, damit eine
 * fehlerhafte Datei nicht den ganzen Import abbricht.
 */
export async function importDocuments(
  ctx: Ctx,
  files: { name: string; data: Blob }[],
  nodeId: string | null,
  docType: string,
): Promise<ImportOutcome[]> {
  if (files.length > MAX_IMPORT_FILES) {
    throw CoreError.invalid("Bitte höchstens 500 Dateien auf einmal importieren.");
  }
  const out: ImportOutcome[] = [];
  for (const f of files) {
    const file_name = fileName(f.name) || f.name;
    try {
      const document = await importDocument(ctx, f.name, f.data, nodeId, docType);
      out.push({ file_name, document, error: null });
    } catch (e) {
      out.push({ file_name, document: null, error: toCmdError(e).message });
    }
  }
  return out;
}

function writePages(db: Db, id: string, title: string, pages: string[]): void {
  db.run("DELETE FROM document_pages WHERE document_id = ?1", [id]);
  db.run("DELETE FROM search_index WHERE entity_type = 'page' AND entity_id = ?1", [id]);
  pages.forEach((p, i) => {
    const text = takeChars(p, MAX_PAGE_TEXT);
    const no = i + 1;
    db.run("INSERT INTO document_pages (document_id, page_no, text) VALUES (?1, ?2, ?3)", [id, no, text]);
    if (text.trim()) search.put(db, "page", id, null, no, title, text);
  });
}

/**
 * Speichert den extrahierten Text (eine Zeichenkette je Seite). Enthält keine
 * Seite Text, wird das Dokument als „ohne Text“ markiert (z. B. Scan ohne OCR).
 */
export function setText(db: Db, id: string, pages: string[]): DocumentInfo {
  requireId(id);
  if (!Array.isArray(pages) || pages.some((p) => typeof p !== "string")) {
    throw CoreError.invalid("Ungültige Daten: Seitentexte müssen Texte sein.");
  }
  if (pages.length > MAX_PAGES) throw CoreError.invalid("Zu viele Seiten.");
  return db.tx(() => {
    const doc = get(db, null, id);
    writePages(db, id, doc.title, pages);
    const hasText = pages.some((p) => charCount(p.trim()) > 3);
    db.run("UPDATE documents SET page_count = ?2, text_status = ?3, updated_at = ?4 WHERE id = ?1", [
      id,
      pages.length,
      hasText ? "ok" : "none",
      now(),
    ]);
    return get(db, null, id);
  });
}

export function setTextError(db: Db, id: string): void {
  requireId(id);
  db.run("UPDATE documents SET text_status = 'error', updated_at = ?2 WHERE id = ?1", [id, now()]);
}

export function update(db: Db, id: string, title: string, docType: string): DocumentInfo {
  requireId(id);
  if (!DOC_TYPES.includes(docType)) throw CoreError.invalid("Unbekannter Dokumenttyp.");
  const clean = cleanTitle(title, 300);
  return db.tx(() => {
    const doc = get(db, null, id);
    db.run("UPDATE documents SET title = ?2, doc_type = ?3, updated_at = ?4 WHERE id = ?1", [id, clean, docType, now()]);
    search.put(db, "document", id, null, null, clean, doc.original_name);
    db.run("UPDATE search_index SET title = ?2 WHERE entity_type = 'page' AND entity_id = ?1", [id, clean]);
    return get(db, null, id);
  });
}

/**
 * Auswahl für `list` (entspricht `ScopeArg` im Befehl `documents_list`):
 * `node` = direkt zugeordnet, `subtree` = diesem Knoten oder einem Nachfahren zugeordnet.
 */
export function list(db: Db, store: Presence, scope: DocScope): DocumentInfo[] {
  let cond: string;
  let arg: string | null = null;
  switch (scope?.kind) {
    case "all":
      cond = "1=1";
      break;
    case "area":
      cond = `EXISTS (SELECT 1 FROM placements p JOIN nodes n ON n.id = p.node_id
                     WHERE p.document_id = d.id AND n.area_id = ?1 AND n.deleted_at IS NULL)`;
      arg = scope.id;
      break;
    case "node":
      cond = "EXISTS (SELECT 1 FROM placements p WHERE p.document_id = d.id AND p.node_id = ?1)";
      arg = scope.id;
      break;
    case "subtree":
      cond = `EXISTS (WITH RECURSIVE t(id) AS (SELECT ?1 UNION ALL SELECT x.id FROM nodes x JOIN t ON x.parent_id = t.id)
                     SELECT 1 FROM placements p JOIN t ON t.id = p.node_id WHERE p.document_id = d.id)`;
      arg = scope.id;
      break;
    case "unassigned":
      cond = `NOT EXISTS (SELECT 1 FROM placements p JOIN nodes n ON n.id = p.node_id
                         WHERE p.document_id = d.id AND n.deleted_at IS NULL)`;
      break;
    default:
      throw CoreError.invalid("Unbekannte Auswahl für Dokumente.");
  }
  if (arg !== null && typeof arg !== "string") throw CoreError.invalid("Ungültige Kennung.");
  const sql = `${SELECT} WHERE d.deleted_at IS NULL AND (${cond}) ORDER BY d.created_at DESC`;
  return db.all<DocRow>(sql, arg !== null ? [arg] : []).map((r) => fromRow(r, store));
}

export function recent(db: Db, store: Presence, areaId: string | null, limit: number): DocumentInfo[] {
  const docs = list(db, store, areaId !== null ? { kind: "area", id: areaId } : { kind: "all" });
  const lim = Math.min(100, Math.max(1, Math.trunc(Number(limit) || 1)));
  return docs.slice(0, lim);
}

export function placements(db: Db, id: string): Placement[] {
  return db
    .all<{ node_id: string; area_id: string; title: string }>(
      `SELECT n.id AS node_id, n.area_id, n.title FROM placements p JOIN nodes n ON n.id = p.node_id
       WHERE p.document_id = ?1 AND n.deleted_at IS NULL ORDER BY p.created_at`,
      [id],
    )
    .map((r) => ({ node_id: r.node_id, area_id: r.area_id, title: r.title, path: nodes.breadcrumb(db, r.node_id, true) }));
}

/** Befehl `document_get`. */
export function detail(db: Db, store: Presence, id: string): DocumentDetail {
  return { document: get(db, store, id), placements: placements(db, id) };
}

/** Kurzer Fundort-Text für Suchtreffer, z. B. „BGB AT · +1 weitere“. */
export function placementSummary(db: Db, id: string): string {
  const p = placements(db, id);
  if (p.length === 0) return "Nicht zugeordnet";
  if (p.length === 1) return p[0]!.path;
  return `${p[0]!.path} · +${p.length - 1} weitere`;
}

export function addPlacement(db: Db, id: string, nodeId: string): void {
  requireId(id);
  requireId(nodeId);
  get(db, null, id);
  nodes.get(db, nodeId);
  db.run("INSERT OR IGNORE INTO placements (document_id, node_id, created_at) VALUES (?1, ?2, ?3)", [id, nodeId, now()]);
}

export function removePlacement(db: Db, id: string, nodeId: string): void {
  db.run("DELETE FROM placements WHERE document_id = ?1 AND node_id = ?2", [id, nodeId]);
}

/** Datei eines Dokuments als Bytes (Befehl `document_bytes`, für die PDF-Ansicht). */
export async function readBytes(ctx: Ctx, id: string): Promise<Uint8Array> {
  const sha = blobSha(ctx.db, id);
  return ctx.blobs.read(sha);
}

export const documentBytes = readBytes;

/** Wie `documentBytes`, aber als Blob (große Dateien). */
export async function documentBlob(ctx: Ctx, id: string): Promise<Blob> {
  const sha = blobSha(ctx.db, id);
  return ctx.blobs.blob(sha);
}

/** Text einer Seite (für die Kontextanzeige von Verknüpfungen). */
export function pageText(db: Db, id: string, page: number): string | null {
  return db.value<string>("SELECT text FROM document_pages WHERE document_id = ?1 AND page_no = ?2", [id, page]) ?? null;
}

/** Text aller Seiten (Index 0 = Seite 1); leer, solange nichts ausgelesen wurde. */
export function pagesText(db: Db, id: string): string[] {
  requireId(id);
  return db
    .all<{ text: string }>("SELECT text FROM document_pages WHERE document_id = ?1 ORDER BY page_no", [id])
    .map((r) => r.text);
}

/** Datenbankteil von `store_image`: vermerkt ein gespeichertes Bild in `blobs`. */
export function recordImage(db: Db, blob: StoredBlob): string {
  db.run("INSERT OR IGNORE INTO blobs (sha256, size, mime, created_at) VALUES (?1, ?2, ?3, ?4)", [
    blob.sha256,
    blob.size,
    blob.mime,
    now(),
  ]);
  return blob.sha256;
}

/**
 * Speichert ein Bild für eine Notiz im Dokumentenspeicher und vermerkt es in `blobs`
 * (damit es in Backups enthalten ist). Liefert den SHA-256 als Kennung.
 */
export async function storeImage(ctx: Ctx, bytes: Uint8Array): Promise<string> {
  const blob = await importImage(ctx.blobs, bytes);
  return recordImage(ctx.db, blob);
}

/** Befehl `image_store`. */
export const imageStore = storeImage;

/** MIME-Typ eines in Notizen verwendeten Bildes (Prüfteil von `image_bytes`). */
export function imageMime(db: Db, sha: string): string {
  const mime = db.value<string>("SELECT mime FROM blobs WHERE sha256 = ?1", [sha]);
  if (mime === undefined) throw CoreError.notFound("Bild nicht gefunden.");
  if (!mime.startsWith("image/")) throw CoreError.invalid("Kein Bild.");
  return mime;
}

/** Bilddaten und MIME-Typ (Rust `documents::image_bytes`). */
export async function imageData(ctx: Ctx, sha: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const mime = imageMime(ctx.db, sha);
  return { bytes: await ctx.blobs.read(sha), mime };
}

/** Befehl `image_bytes`: nur die Bytes. */
export async function imageBytes(ctx: Ctx, sha: string): Promise<Uint8Array> {
  return (await imageData(ctx, sha)).bytes;
}
