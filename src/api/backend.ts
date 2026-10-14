import type {
  AppInfo,
  Area,
  BackupInfo,
  BackupRecord,
  BackupSettings,
  DocScope,
  DocumentDetail,
  DocumentInfo,
  ImportOutcome,
  LinkView,
  NewLink,
  NewNode,
  Note,
  NodeDetail,
  RecentNote,
  RestoreResult,
  SaveResult,
  SearchHit,
  StudyNode,
  TrashItem,
  VerifyReport,
  VersionMeta,
} from "./types";

/**
 * Alle Operationen, die die Oberfläche am Backend ausführen kann.
 * Es gibt zwei Implementierungen: Tauri (echte App) und ein In-Memory-Mock
 * für Browser-Entwicklung und Tests.
 */
export interface Backend {
  readonly kind: "tauri" | "mock";

  appInfo(): Promise<AppInfo>;
  settingsAll(): Promise<Record<string, unknown>>;
  settingSet(key: string, value: unknown): Promise<void>;

  areasList(): Promise<Area[]>;
  areaCreate(name: string, color: string): Promise<Area>;
  areaUpdate(id: string, name: string, color: string): Promise<Area>;
  areaReorder(ids: string[]): Promise<void>;

  nodesList(areaId: string | null): Promise<StudyNode[]>;
  nodeGet(id: string): Promise<NodeDetail>;
  nodeCreate(input: NewNode): Promise<StudyNode>;
  nodeUpdate(id: string, patch: { title?: string; meta?: Record<string, unknown> }): Promise<StudyNode>;
  nodeMove(id: string, parentId: string | null, position: number, areaId?: string | null): Promise<StudyNode>;
  nodeSetArchived(id: string, archived: boolean): Promise<StudyNode>;
  nodeTrash(id: string): Promise<void>;
  nodeAreaRefAdd(nodeId: string, areaId: string): Promise<void>;
  nodeAreaRefRemove(nodeId: string, areaId: string): Promise<void>;
  areaRefsList(areaId: string): Promise<StudyNode[]>;

  noteGet(id: string): Promise<Note>;
  noteSave(id: string, contentJson: string, plainText: string): Promise<SaveResult>;
  noteVersions(id: string): Promise<VersionMeta[]>;
  noteVersionContent(versionId: string): Promise<string>;
  noteVersionRestore(id: string, versionId: string): Promise<SaveResult>;
  noteVersionCreate(id: string, reason: string): Promise<void>;
  notesRecent(areaId: string | null, limit: number): Promise<RecentNote[]>;

  search(query: string, areaId: string | null): Promise<SearchHit[]>;

  documentsImport(paths: string[], nodeId: string | null, docType: string): Promise<ImportOutcome[]>;
  documentsList(scope: DocScope): Promise<DocumentInfo[]>;
  documentsRecent(areaId: string | null, limit: number): Promise<DocumentInfo[]>;
  documentGet(id: string): Promise<DocumentDetail>;
  documentUpdate(id: string, title: string, docType: string): Promise<DocumentInfo>;
  documentSetText(id: string, pages: string[]): Promise<DocumentInfo>;
  documentTextError(id: string): Promise<void>;
  documentAddPlacement(id: string, nodeId: string): Promise<void>;
  documentRemovePlacement(id: string, nodeId: string): Promise<void>;
  documentBytes(id: string): Promise<Uint8Array>;
  documentTrash(id: string): Promise<void>;
  documentOpenExternal(id: string): Promise<string>;
  documentExportCopy(id: string, dest: string): Promise<void>;
  documentPageText(id: string, page: number): Promise<string | null>;
  documentPagesText(id: string): Promise<string[]>;

  linksFor(type: "node" | "document", id: string): Promise<LinkView[]>;
  linkAdd(link: NewLink): Promise<string>;
  linkRemove(id: string): Promise<void>;

  trashList(): Promise<TrashItem[]>;
  trashRestore(itemType: "node" | "document", id: string): Promise<void>;
  trashPurge(itemType: "node" | "document", id: string): Promise<void>;

  backupSettings(): Promise<BackupSettings>;
  backupCreate(): Promise<BackupInfo>;
  backupVerify(path: string): Promise<VerifyReport>;
  backupRestore(path: string): Promise<RestoreResult>;
  backupHistory(): Promise<BackupRecord[]>;

  exportWrite(path: string, data: Uint8Array): Promise<void>;
  readExternalFile(path: string): Promise<Uint8Array>;
  openUrl(url: string): Promise<void>;
  revealPath(path?: string): Promise<void>;

  /** Dateiauswahl. `null`, wenn abgebrochen. */
  pickFiles(opts: { multiple: boolean; extensions?: string[]; title?: string }): Promise<string[] | null>;
  pickDirectory(title: string): Promise<string | null>;
  pickSavePath(defaultName: string, ext: string): Promise<string | null>;
  /** Registriert Drag-and-drop von Dateien auf das Fenster. */
  onFileDrop(handler: (paths: string[]) => void, hover?: (over: boolean) => void): () => void;
}
