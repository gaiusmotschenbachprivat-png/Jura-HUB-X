/**
 * Backups der Browser-Version – gleiches Format wie die Desktop-App (`backup.rs`):
 * ZIP mit `manifest.json`, `studium.sqlite` und `files/<xx>/<sha256>`.
 * Ein Backup vom iPad lässt sich am Rechner wiederherstellen und umgekehrt.
 *
 * Sicherheitsregeln wie in Rust: nur bekannte Eintragsnamen, jede Prüfsumme wird
 * geprüft, die Datenbank wird vor der Wiederherstellung auf Integrität getestet.
 */
import { sha256 } from "@noble/hashes/sha2.js";

import type { BackupRecord, VerifyReport } from "../api/types";
import { sha256Blob, type BlobStore } from "./blobs";
import { type Db, integrityCheck, SCHEMA_VERSION, schemaVersion } from "./db";
import { CoreError } from "./errors";
import { entryData, readZipDirectory, type ZipEntry, ZipWriter, type ZipSink } from "./zip";
import { fileStamp, isSha256Hex, newId, now, toHex } from "./util";

export const FORMAT_VERSION = 1;
export const EXTENSION = "studiumbackup";
const MANIFEST = "manifest.json";
const DB_ENTRY = "studium.sqlite";

export interface ManifestEntry {
  path: string;
  sha256: string;
  size: number;
}

export interface Manifest {
  format: string;
  format_version: number;
  app_version: string;
  schema_version: number;
  created_at: string;
  kind: string;
  entries: ManifestEntry[];
}

export function backupName(kind: string, d = new Date()): string {
  const prefix = kind === "auto" ? "Studium-OS-Auto-Backup" : "Studium-OS-Backup";
  return `${prefix}-${fileStamp(d)}.${EXTENSION}`;
}

export function isAllowedEntry(name: string): boolean {
  if (name === MANIFEST || name === DB_ENTRY) return true;
  const parts = name.split("/");
  return parts.length === 3 && parts[0] === "files" && isSha256Hex(parts[2]) && parts[1] === parts[2]!.slice(0, 2);
}

export interface BuildResult {
  manifest: Manifest;
  fileCount: number;
  missing: string[];
}

/**
 * Schreibt ein vollständiges Backup in `sink`.
 * `dbBytes` ist ein konsistenter Schnappschuss der Datenbank.
 */
export async function buildBackup(opts: {
  dbBytes: Uint8Array;
  openDb: (bytes: Uint8Array) => Db;
  blobs: BlobStore;
  sink: ZipSink;
  appVersion: string;
  kind: string;
}): Promise<BuildResult> {
  const snap = opts.openDb(opts.dbBytes);
  let shas: string[];
  let schema: number;
  try {
    integrityCheck(snap);
    schema = schemaVersion(snap);
    shas = snap.all<{ sha256: string }>("SELECT sha256 FROM blobs ORDER BY sha256").map((r) => r.sha256);
  } finally {
    snap.raw.close();
  }
  const zip = new ZipWriter(opts.sink);
  const entries: ManifestEntry[] = [];
  entries.push({ path: DB_ENTRY, sha256: toHex(sha256(opts.dbBytes)), size: opts.dbBytes.length });
  await zip.add(DB_ENTRY, opts.dbBytes, "deflate");
  const missing: string[] = [];
  for (const sha of shas) {
    if (!isSha256Hex(sha) || !opts.blobs.has(sha)) {
      missing.push(sha);
      continue;
    }
    const blob = await opts.blobs.blob(sha);
    const h = sha256.create();
    const name = `files/${sha.slice(0, 2)}/${sha}`;
    await zip.add(name, blob, "stored", (c) => h.update(c));
    entries.push({ path: name, sha256: toHex(h.digest()), size: blob.size });
  }
  const manifest: Manifest = {
    format: "studium-os-backup",
    format_version: FORMAT_VERSION,
    app_version: opts.appVersion,
    schema_version: schema,
    created_at: now(),
    kind: opts.kind,
    entries,
  };
  await zip.add(MANIFEST, new TextEncoder().encode(JSON.stringify(manifest, null, 2)), "deflate");
  await zip.finish();
  return { manifest, fileCount: entries.length - 1, missing };
}

interface Opened {
  dir: Map<string, ZipEntry>;
  manifest: Manifest;
}

async function openArchive(file: Blob, problems: string[]): Promise<Opened | null> {
  let list: ZipEntry[];
  try {
    list = await readZipDirectory(file);
  } catch {
    problems.push("Die Datei ist kein lesbares Archiv (abgebrochen oder beschädigt).");
    return null;
  }
  const dir = new Map(list.map((e) => [e.name, e]));
  const m = dir.get(MANIFEST);
  if (!m) {
    problems.push("Das Backup ist unvollständig oder beschädigt: Die Inhaltsliste (manifest.json) fehlt.");
    return null;
  }
  if (m.usize > 64 * 1024 * 1024) {
    problems.push("Das Backup ist unvollständig oder beschädigt: Die Inhaltsliste ist unplausibel groß.");
    return null;
  }
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await (await entryData(file, m)).text()) as Manifest;
    if (!manifest || !Array.isArray(manifest.entries)) throw new Error();
  } catch {
    problems.push("Das Backup ist unvollständig oder beschädigt: Die Inhaltsliste ist unlesbar.");
    return null;
  }
  if (manifest.format !== "studium-os-backup") {
    problems.push("Das Backup ist unvollständig oder beschädigt: Die Datei ist kein Studium-OS-Backup.");
    return null;
  }
  return { dir, manifest };
}

/** Prüft ein Backup vollständig, ohne etwas zu verändern. */
export async function verifyBackup(file: Blob, openDb: (bytes: Uint8Array) => Db): Promise<VerifyReport> {
  const report: VerifyReport = {
    ok: false,
    created_at: null,
    schema_version: null,
    app_version: null,
    file_count: 0,
    total_size: 0,
    problems: [],
  };
  const opened = await openArchive(file, report.problems);
  if (!opened) return report;
  const { dir, manifest } = opened;
  report.created_at = manifest.created_at ?? null;
  report.schema_version = manifest.schema_version ?? null;
  report.app_version = manifest.app_version ?? null;
  if (manifest.format_version > FORMAT_VERSION) report.problems.push("Das Backup stammt von einer neueren Version von Studium OS.");
  if (manifest.schema_version > SCHEMA_VERSION) {
    report.problems.push(
      `Das Backup nutzt Datenbankschema ${manifest.schema_version}, diese App kennt nur bis ${SCHEMA_VERSION}. Bitte App aktualisieren.`,
    );
  }
  const listed = new Set(manifest.entries.map((e) => e.path));
  for (const name of dir.keys()) {
    if (!isAllowedEntry(name)) report.problems.push(`Unerwarteter Eintrag im Archiv: ${Array.from(name).slice(0, 80).join("")}`);
    else if (name !== MANIFEST && !listed.has(name)) report.problems.push(`Eintrag nicht in der Inhaltsliste: ${name}`);
  }
  if (!listed.has(DB_ENTRY)) report.problems.push("Die Datenbank fehlt im Backup.");
  let dbBytes: Uint8Array | null = null;
  for (const e of manifest.entries) {
    if (!isAllowedEntry(e.path)) {
      report.problems.push("Die Inhaltsliste enthält einen ungültigen Pfad.");
      continue;
    }
    const z = dir.get(e.path);
    if (!z) {
      report.problems.push(`Fehlt im Archiv: ${e.path}`);
      continue;
    }
    try {
      const data = await entryData(file, z);
      const { sha256: sha, size } = await sha256Blob(data);
      if (size === e.size && sha === e.sha256) {
        report.total_size += size;
        if (e.path === DB_ENTRY) dbBytes = new Uint8Array(await data.arrayBuffer());
      } else report.problems.push(`Prüfsumme stimmt nicht: ${e.path}`);
    } catch {
      report.problems.push(`Beschädigt, Prüfsumme stimmt nicht: ${e.path}`);
    }
  }
  report.file_count = Math.max(0, manifest.entries.length - 1);
  if (report.problems.length === 0 && dbBytes) {
    try {
      const c = openDb(dbBytes);
      try {
        integrityCheck(c);
        if (schemaVersion(c) !== manifest.schema_version) {
          throw CoreError.corrupt("Schemaversion passt nicht zur Inhaltsliste.");
        }
      } finally {
        c.raw.close();
      }
    } catch (e) {
      report.problems.push(e instanceof Error ? e.message : String(e));
    }
  }
  report.ok = report.problems.length === 0;
  return report;
}

export interface Extracted {
  dbBytes: Uint8Array;
  files: Map<string, Blob>;
  createdAt: string;
}

/** Prüft und entpackt ein Backup (nur geprüfte Einträge, Prüfsumme je Datei). */
export async function extractBackup(file: Blob, openDb: (bytes: Uint8Array) => Db): Promise<Extracted> {
  const report = await verifyBackup(file, openDb);
  if (!report.ok) throw CoreError.corrupt(report.problems.join("; "));
  const problems: string[] = [];
  const opened = await openArchive(file, problems);
  if (!opened) throw CoreError.corrupt(problems.join("; "));
  let dbBytes: Uint8Array | null = null;
  const files = new Map<string, Blob>();
  for (const e of opened.manifest.entries) {
    if (!isAllowedEntry(e.path)) throw CoreError.corrupt("Ungültiger Pfad im Backup.");
    const data = await entryData(file, opened.dir.get(e.path)!);
    const { sha256: sha } = await sha256Blob(data);
    if (sha !== e.sha256) throw CoreError.corrupt(`Prüfsumme stimmt beim Entpacken nicht: ${e.path}`);
    if (e.path === DB_ENTRY) dbBytes = new Uint8Array(await data.arrayBuffer());
    else files.set(e.path.slice(-64), data);
  }
  if (!dbBytes) throw CoreError.corrupt("Die Datenbank fehlt im Backup.");
  return { dbBytes, files, createdAt: report.created_at ?? "" };
}

export function record(
  db: Db,
  info: { path: string; created_at: string; size: number; sha256: string; kind: string },
  status: string,
  message: string | null,
): void {
  db.run(
    "INSERT INTO backups (id, path, created_at, size, sha256, kind, status, message) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
    [newId(), info.path, info.created_at, info.size, info.sha256, info.kind, status, message],
  );
}

export function history(db: Db, limit: number, exists: (path: string) => boolean): BackupRecord[] {
  return db
    .all<Omit<BackupRecord, "exists">>(
      "SELECT path, created_at, size, kind, status, message FROM backups ORDER BY created_at DESC LIMIT ?1",
      [limit],
    )
    .map((r) => ({ ...r, size: Number(r.size), exists: exists(r.path) }));
}
