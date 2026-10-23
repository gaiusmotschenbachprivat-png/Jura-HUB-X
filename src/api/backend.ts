import type {
  AiChat,
  AiChatInput,
  AiChatMeta,
  AiHttpResponse,
  AiStatus,
  LegalHit,
  LegalKind,
  LegalSource,
  NewLegalChunk,
  NewLegalSource,
  Annotation,
  AnnotationColor,
  AppInfo,
  Card,
  CardFilter,
  CardPatch,
  CardStats,
  CitationData,
  Exam,
  ExamInput,
  Knowledge,
  KnowledgeFilter,
  KnowledgePatch,
  NewAnnotation,
  NewCard,
  NewKnowledge,
  NewTask,
  ReviewInput,
  Task,
  TaskFilter,
  TaskPatch,
  TrashItemType,
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
  MergeResult,
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
/** Nur in der Browser-/iPad-Version: Backups im App-Speicher. */
export interface WebBackups {
  list(): Promise<{ name: string; size: number; created_at: string }[]>;
  file(name: string): Promise<File>;
  remove(name: string): Promise<void>;
  /** Teilen-Menü bzw. Download – muss direkt im Klick aufgerufen werden. */
  save(file: File): Promise<void>;
  persisted(): Promise<boolean>;
  requestPersist(): Promise<boolean>;
  estimate(): Promise<{ usage: number; quota: number } | null>;
}

export interface Backend {
  readonly kind: "tauri" | "mock" | "web";
  /** Browser-Version: erfüllt, sobald der Datenspeicher bereit ist. */
  readonly ready?: Promise<void>;
  readonly webBackups?: WebBackups;

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

  linksFor(type: "node" | "document" | "knowledge", id: string): Promise<LinkView[]>;
  linkAdd(link: NewLink): Promise<string>;
  linkRemove(id: string): Promise<void>;

  trashList(): Promise<TrashItem[]>;
  trashRestore(itemType: TrashItemType, id: string): Promise<void>;
  trashPurge(itemType: TrashItemType, id: string): Promise<void>;

  knowledgeList(filter: KnowledgeFilter): Promise<Knowledge[]>;
  knowledgeGet(id: string): Promise<Knowledge>;
  knowledgeCreate(input: NewKnowledge): Promise<Knowledge>;
  knowledgeUpdate(id: string, patch: KnowledgePatch): Promise<Knowledge>;
  knowledgeTrash(id: string): Promise<void>;
  knowledgeFields(): Promise<string[]>;
  citationParse(text: string): Promise<CitationData | null>;

  cardsList(filter: CardFilter): Promise<Card[]>;
  cardCreate(input: NewCard): Promise<Card>;
  cardUpdate(id: string, patch: CardPatch): Promise<Card>;
  cardReview(id: string, review: ReviewInput): Promise<Card>;
  cardTrash(id: string): Promise<void>;
  cardStats(areaId: string | null, dayStart: string): Promise<CardStats>;

  tasksList(filter: TaskFilter): Promise<Task[]>;
  taskCreate(input: NewTask): Promise<Task>;
  taskUpdate(id: string, patch: TaskPatch): Promise<Task>;
  taskTrash(id: string): Promise<void>;
  examsList(areaId: string | null, from: string | null): Promise<Exam[]>;
  examSave(id: string | null, input: ExamInput): Promise<Exam>;
  examTrash(id: string): Promise<void>;

  annotationsList(documentId: string): Promise<Annotation[]>;
  annotationCreate(input: NewAnnotation): Promise<Annotation>;
  annotationUpdate(id: string, patch: { comment?: string; color?: AnnotationColor; ink?: string }): Promise<Annotation>;
  annotationDelete(id: string): Promise<void>;

  imageStore(data: Uint8Array): Promise<string>;
  imageBytes(sha: string): Promise<Uint8Array>;

  backupSettings(): Promise<BackupSettings>;
  backupCreate(): Promise<BackupInfo>;
  backupVerify(path: string): Promise<VerifyReport>;
  backupRestore(path: string): Promise<RestoreResult>;
  /** Mit dem Backup eines anderen Geräts zusammenführen; `preview` zählt nur. */
  backupMerge(path: string, preview: boolean): Promise<MergeResult>;
  backupHistory(): Promise<BackupRecord[]>;

  // ---- KI-Assistent: Rechtsquellen ----
  legalSourcesList(): Promise<LegalSource[]>;
  legalSourceSave(source: NewLegalSource, chunks: NewLegalChunk[]): Promise<LegalSource>;
  legalSourceDelete(id: string): Promise<void>;
  legalSearch(terms: string[], kinds: LegalKind[] | null, limit: number): Promise<LegalHit[]>;
  legalNorm(abbreviation: string, norm: string, absatz: number | null): Promise<LegalHit[]>;
  legalChunks(ids: string[]): Promise<LegalHit[]>;
  /** Texte aller Abschnitte einer Quelle in Reihenfolge */
  legalSourceTexts(id: string): Promise<string[]>;
  /** Gespeicherte Unterhaltungen des KI-Assistenten (nur lokal), neueste zuerst */
  aiChatsList(): Promise<AiChatMeta[]>;
  aiChatGet(id: string): Promise<AiChat>;
  aiChatSave(chat: AiChatInput): Promise<AiChatMeta>;
  aiChatDelete(id: string): Promise<void>;
  aiChatsClear(): Promise<void>;
  /** Ist die Claude API nutzbar (Schlüssel vorhanden)? */
  aiStatus(): Promise<AiStatus>;
  /** Browser-Version: API-Schlüssel nur für diese Sitzung (nur im Arbeitsspeicher). */
  aiSetSessionKey(key: string | null): Promise<void>;
  /** Desktop: Weiterleitung einer Anfrage an die Claude API über die Rust-Seite. */
  aiHttp(url: string, method: string, headers: [string, string][], body: string): Promise<AiHttpResponse>;
  /** Desktop: Gesetz als XML-Archiv von gesetze-im-internet.de laden (auf Knopfdruck). */
  lawFetch(abbreviation: string): Promise<Uint8Array>;

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
