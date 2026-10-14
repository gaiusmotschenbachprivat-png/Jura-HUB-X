/**
 * Befehle der Browser-Version – das Gegenstück zu den Tauri-Befehlen in
 * `src-tauri/src/commands`. Dünne Adapter um den Kern in `src/core`.
 * Methodennamen entsprechen der Schnittstelle `Backend` (src/api/backend.ts).
 */
import pkg from "../../package.json";
import type {
  AppInfo,
  BackupInfo,
  BackupSettings,
  DocScope,
  ImportOutcome,
  NodeDetail,
  RestoreResult,
  VerifyReport,
} from "../api/types";
import * as backup from "../core/backup";
import { sha256Blob, type BlobStore } from "../core/blobs";
import type { Ctx } from "../core/ctx";
import { type Db, schemaVersion } from "../core/db";
import { CoreError } from "../core/errors";
import * as search from "../core/search";
import * as settings from "../core/settings";
import { dbFromBytes, dbToBytes, type Sqlite3Like } from "../core/sqliteBytes";
import { fileStamp, now, parseTs, requireId } from "../core/util";
import * as annotations from "../core/repo/annotations";
import * as areas from "../core/repo/areas";
import * as cards from "../core/repo/cards";
import * as documents from "../core/repo/documents";
import * as knowledge from "../core/repo/knowledge";
import * as legal from "../core/repo/legal";
import * as links from "../core/repo/links";
import * as nodes from "../core/repo/nodes";
import * as notes from "../core/repo/notes";
import * as planning from "../core/repo/planning";
import * as trash from "../core/repo/trash";
import type { BackupStore } from "./backupStore";

export const APP_VERSION: string = pkg.version;
const BACKUP_DIR_LABEL = "App-Speicher dieses Geräts (Safari)";

export interface Env {
  sqlite3: Sqlite3Like;
  blobs: BlobStore;
  backups: BackupStore;
  /** Kurzbeschreibung des Speichers für „Daten & Sicherheit“. */
  storageLabel: string;
  db(): Db;
  /** Schließt die Datenbank, ersetzt sie durch `bytes` und öffnet sie neu (inkl. Migration). */
  replaceDatabase(bytes: Uint8Array): Promise<void>;
}

export function createService(env: Env) {
  const db = () => env.db();
  const ctx = (): Ctx => ({ db: env.db(), blobs: env.blobs });
  const openBytes = (b: Uint8Array) => dbFromBytes(env.sqlite3, b);

  async function storedBackup(name: string): Promise<File> {
    if (!/^[\w.() -]+\.studiumbackup$/.test(name)) throw CoreError.invalid("Ungültiger Backup-Name.");
    return env.backups.file(name);
  }

  function readSettings(): BackupSettings {
    const s = (k: string) => settings.get(db(), k);
    const keep = s("backup.keep");
    return {
      dir: BACKUP_DIR_LABEL,
      second_dir: null,
      auto_enabled: s("backup.auto_enabled") === true,
      keep: typeof keep === "number" ? Math.min(365, Math.max(1, Math.trunc(keep))) : 7,
      last_auto: typeof s("backup.last_auto") === "string" ? (s("backup.last_auto") as string) : null,
    };
  }

  /** Erstellt ein Backup im App-Speicher, prüft es und vermerkt das Ergebnis. */
  async function runBackup(kind: "manual" | "auto", name = backup.backupName(kind)): Promise<BackupInfo> {
    const createdAt = now();
    try {
      const out = await env.backups.writer(name);
      try {
        await backup.buildBackup({
          dbBytes: dbToBytes(env.sqlite3, db()),
          openDb: openBytes,
          blobs: env.blobs,
          sink: out,
          appVersion: APP_VERSION,
          kind,
        });
        await out.close();
      } catch (e) {
        out.abort();
        throw e;
      }
      const file = await env.backups.file(name);
      const report = await backup.verifyBackup(file, openBytes);
      if (!report.ok) {
        await env.backups.remove(name);
        throw CoreError.corrupt(`Die Prüfung direkt nach dem Schreiben ist fehlgeschlagen: ${report.problems.join("; ")}`);
      }
      const { sha256 } = await sha256Blob(file);
      const info: BackupInfo = {
        path: name,
        size: file.size,
        sha256,
        created_at: createdAt,
        file_count: report.file_count,
        kind,
        second_copy: null,
        second_copy_error: null,
      };
      backup.record(db(), info, "ok", null);
      if (kind === "auto") await pruneAuto(readSettings().keep);
      return info;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      try {
        backup.record(db(), { path: BACKUP_DIR_LABEL, created_at: createdAt, size: 0, sha256: "", kind }, "fehler", msg);
      } catch {
        /* Fehler beim Vermerken nicht über den eigentlichen Fehler stellen */
      }
      throw e;
    }
  }

  const listBackups = () => env.backups.list();

  async function pruneAuto(keep: number) {
    const autos = (await listBackups()).filter((b) => b.name.startsWith("Studium-OS-Auto-Backup-")).map((b) => b.name).sort();
    while (autos.length > Math.max(1, keep)) await env.backups.remove(autos.shift()!);
  }

  async function restoreFrom(file: Blob): Promise<RestoreResult> {
    const ex = await backup.extractBackup(file, openBytes);
    // Den jetzigen Stand vorher vollständig sichern – er wird nicht gelöscht.
    const previous = `Studium-OS-Backup-vor-Wiederherstellung-${fileStamp()}.studiumbackup`;
    await runBackup("manual", previous);
    for (const [, data] of ex.files) await env.blobs.put(data);
    await env.replaceDatabase(ex.dbBytes);
    const keepSet = new Set(ex.files.keys());
    for (const sha of env.blobs.list()) if (!keepSet.has(sha)) await env.blobs.remove(sha);
    search.rebuild(db());
    return { previous_state_dir: previous, created_at: ex.createdAt };
  }

  /** Automatisches Backup (einmal täglich, während die App geöffnet ist). */
  async function autoBackupTick() {
    try {
      const cfg = readSettings();
      if (!cfg.auto_enabled) return;
      if (cfg.last_auto && Date.now() - parseTs(cfg.last_auto) < 24 * 3600 * 1000) return;
      let ok = true;
      await runBackup("auto").catch(() => (ok = false));
      const next = ok ? now() : new Date(Date.now() - 23 * 3600 * 1000).toISOString();
      settings.set(db(), "backup.last_auto", next);
    } catch {
      /* nächster Versuch beim nächsten Takt */
    }
  }
  setTimeout(() => void autoBackupTick(), 90_000);
  setInterval(() => void autoBackupTick(), 3600_000);

  return {
    // ---- System ----
    appInfo: async (): Promise<AppInfo> => ({
      version: APP_VERSION,
      data_dir: env.storageLabel,
      db_path: "studium.sqlite",
      files_dir: "files/",
      log_dir: null,
      schema_version: schemaVersion(db()),
      platform: "web",
    }),
    settingsAll: async () => settings.all(db()),
    settingSet: async (key: string, value: unknown) => settings.set(db(), key, value),

    // ---- Struktur ----
    areasList: async () => areas.list(db()),
    areaCreate: async (name: string, color: string) => areas.create(db(), name, color),
    areaUpdate: async (id: string, name: string, color: string) => areas.update(db(), id, name, color),
    areaReorder: async (ids: string[]) => areas.reorder(db(), ids),
    nodesList: async (areaId: string | null) => nodes.list(db(), areaId ?? null),
    nodeGet: async (id: string): Promise<NodeDetail> => {
      requireId(id);
      return { node: nodes.get(db(), id), path: nodes.breadcrumb(db(), id, false), also_in_areas: nodes.areaRefsOf(db(), id) };
    },
    nodeCreate: async (input: Parameters<typeof nodes.create>[1]) => nodes.create(db(), input),
    nodeUpdate: async (id: string, patch: nodes.NodePatch) => nodes.update(db(), id, patch ?? {}),
    nodeMove: async (id: string, parentId: string | null, position: number, areaId: string | null = null) =>
      nodes.moveNode(db(), id, parentId ?? null, position, areaId ?? null),
    nodeSetArchived: async (id: string, archived: boolean) => nodes.setArchived(db(), id, archived),
    nodeTrash: async (id: string) => trash.trashNode(db(), id),
    nodeAreaRefAdd: async (nodeId: string, areaId: string) => nodes.addAreaRef(db(), nodeId, areaId),
    nodeAreaRefRemove: async (nodeId: string, areaId: string) => nodes.removeAreaRef(db(), nodeId, areaId),
    areaRefsList: async (areaId: string) => nodes.listAreaRefs(db(), areaId),

    // ---- Notizen und Suche ----
    noteGet: async (id: string) => notes.get(db(), id),
    noteSave: async (id: string, contentJson: string, plainText: string) => notes.save(db(), id, contentJson, plainText),
    noteVersions: async (id: string) => notes.listVersions(db(), id),
    noteVersionContent: async (versionId: string) => notes.getVersionContent(db(), versionId),
    noteVersionRestore: async (id: string, versionId: string) => notes.restoreVersion(db(), id, versionId),
    noteVersionCreate: async (id: string, reason: string) => notes.createVersion(db(), id, reason),
    notesRecent: async (areaId: string | null, limit: number) => notes.recent(db(), areaId ?? null, limit),
    search: async (query: string, areaId: string | null) =>
      typeof query === "string" && query.length <= 500 ? search.search(db(), query, areaId ?? null, 60) : [],

    // ---- Dokumente ----
    documentsImportFiles: async (files: { name: string; data: Blob }[], nodeId: string | null, docType: string): Promise<ImportOutcome[]> =>
      documents.importDocuments(ctx(), files, nodeId ?? null, docType),
    documentsList: async (scope: DocScope) => documents.list(db(), env.blobs, scope),
    documentsRecent: async (areaId: string | null, limit: number) => documents.recent(db(), env.blobs, areaId ?? null, limit),
    documentGet: async (id: string) => documents.detail(db(), env.blobs, id),
    documentUpdate: async (id: string, title: string, docType: string) => documents.update(db(), id, title, docType),
    documentSetText: async (id: string, pages: string[]) => documents.setText(db(), id, pages),
    documentTextError: async (id: string) => documents.setTextError(db(), id),
    documentAddPlacement: async (id: string, nodeId: string) => documents.addPlacement(db(), id, nodeId),
    documentRemovePlacement: async (id: string, nodeId: string) => documents.removePlacement(db(), id, nodeId),
    documentBytes: async (id: string) => documents.readBytes(ctx(), id),
    documentTrash: async (id: string) => trash.trashDocument(db(), id),
    documentPageText: async (id: string, page: number) => documents.pageText(db(), id, page),
    documentPagesText: async (id: string) => documents.pagesText(db(), id),

    linksFor: async (type: string, id: string) => links.forEntity(db(), type, id),
    linkAdd: async (link: Parameters<typeof links.add>[1]) => links.add(db(), link),
    linkRemove: async (id: string) => links.remove(db(), id),

    trashList: async () => trash.list(db()),
    trashRestore: async (itemType: string, id: string) => trash.restoreAny(db(), itemType, id),
    trashPurge: async (itemType: string, id: string) => trash.purgeAny(ctx(), itemType, id),

    // ---- Wissen, Lernen, Planung ----
    knowledgeList: async (filter: Parameters<typeof knowledge.list>[1]) => knowledge.list(db(), filter ?? {}),
    knowledgeGet: async (id: string) => knowledge.get(db(), id),
    knowledgeCreate: async (input: Parameters<typeof knowledge.create>[1]) => knowledge.create(db(), input),
    knowledgeUpdate: async (id: string, patch: Parameters<typeof knowledge.update>[2]) => knowledge.update(db(), id, patch),
    knowledgeTrash: async (id: string) => knowledge.trash(db(), id),
    knowledgeFields: async () => knowledge.fields(db()),
    citationParse: async (text: string) => knowledge.parseCitation(text),

    cardsList: async (filter: Parameters<typeof cards.list>[1]) => cards.list(db(), filter ?? {}),
    cardCreate: async (input: Parameters<typeof cards.create>[1]) => cards.create(db(), input),
    cardUpdate: async (id: string, patch: Parameters<typeof cards.update>[2]) => cards.update(db(), id, patch),
    cardReview: async (id: string, review: Parameters<typeof cards.review>[2]) => cards.review(db(), id, review),
    cardTrash: async (id: string) => cards.trash(db(), id),
    cardStats: async (areaId: string | null, dayStart: string) => cards.stats(db(), areaId ?? null, dayStart),

    tasksList: async (filter: Parameters<typeof planning.taskList>[1]) => planning.taskList(db(), filter ?? {}),
    taskCreate: async (input: Parameters<typeof planning.taskCreate>[1]) => planning.taskCreate(db(), input),
    taskUpdate: async (id: string, patch: Parameters<typeof planning.taskUpdate>[2]) => planning.taskUpdate(db(), id, patch),
    taskTrash: async (id: string) => planning.trash(db(), "task", id),
    examsList: async (areaId: string | null, from: string | null) => planning.examList(db(), areaId ?? null, from ?? null),
    examSave: async (id: string | null, input: Parameters<typeof planning.examSave>[2]) => planning.examSave(db(), id ?? null, input),
    examTrash: async (id: string) => planning.trash(db(), "exam", id),

    annotationsList: async (documentId: string) => annotations.list(db(), documentId),
    annotationCreate: async (input: Parameters<typeof annotations.create>[1]) => annotations.create(db(), input),
    annotationUpdate: async (id: string, patch: Parameters<typeof annotations.update>[2]) => annotations.update(db(), id, patch),
    annotationDelete: async (id: string) => annotations.remove(db(), id),

    legalSourcesList: async () => legal.list(db()),
    legalSourceSave: async (source: Parameters<typeof legal.save>[1], chunks: Parameters<typeof legal.save>[2]) => legal.save(db(), source, chunks),
    legalSourceDelete: async (id: string) => legal.remove(db(), id),
    legalSearch: async (terms: string[], kinds: Parameters<typeof legal.search>[2], limit: number) => legal.search(db(), terms, kinds ?? null, limit),
    legalNorm: async (abbreviation: string, norm: string, absatz: number | null) => legal.norm(db(), abbreviation, norm, absatz ?? null),
    legalChunks: async (ids: string[]) => legal.chunks(db(), ids),

    imageStore: async (data: Uint8Array) => documents.storeImage(ctx(), data),
    imageBytes: async (sha: string) => documents.imageBytes(ctx(), sha),

    // ---- Backups ----
    backupSettings: async () => readSettings(),
    backupCreate: async () => runBackup("manual"),
    backupHistory: async () => {
      const names = new Set((await listBackups()).map((b) => b.name));
      return backup.history(db(), 30, (p) => names.has(p));
    },
    backupVerifyFile: async (file: File): Promise<VerifyReport> => backup.verifyBackup(file, openBytes),
    backupVerifyStored: async (name: string): Promise<VerifyReport> => backup.verifyBackup(await storedBackup(name), openBytes),
    backupRestoreFile: async (file: File) => restoreFrom(file),
    backupRestoreStored: async (name: string) => restoreFrom(await storedBackup(name)),
    backupFiles: async () => listBackups(),
    backupFile: async (name: string) => storedBackup(name),
    backupDelete: async (name: string) => {
      await storedBackup(name);
      await env.backups.remove(name);
    },
  };
}

export type Service = ReturnType<typeof createService>;
