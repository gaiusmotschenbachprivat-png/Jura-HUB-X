// Typen spiegeln die Rust-Strukturen aus studium-core / src-tauri.

export type NodeKind = "semester" | "module" | "course" | "session" | "topic" | "folder" | "note";

export interface Area {
  id: string;
  name: string;
  color: string;
  position: number;
  archived_at: string | null;
  created_at: string;
}

/** Zusatzangaben eines Knotens. Alle Felder optional. */
export interface NodeMeta {
  lecturer?: string;
  weekday?: string;
  time?: string;
  room?: string;
  date?: string;
  description?: string;
  goals?: string;
  ects?: string;
  [key: string]: unknown;
}

export interface StudyNode {
  id: string;
  area_id: string;
  parent_id: string | null;
  kind: NodeKind;
  title: string;
  position: number;
  meta: NodeMeta;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
}

export interface NodeDetail {
  node: StudyNode;
  path: string;
  also_in_areas: string[];
}

export interface NewNode {
  area_id: string;
  parent_id: string | null;
  kind: NodeKind;
  title: string;
  meta?: NodeMeta;
  content_json?: string;
  plain_text?: string;
  template?: string;
}

export interface Note {
  node_id: string;
  title: string;
  area_id: string;
  content_json: string;
  template: string | null;
  word_count: number;
  updated_at: string;
  path: string;
}

export interface SaveResult {
  updated_at: string;
  version_created: boolean;
}

export interface VersionMeta {
  id: string;
  reason: string;
  created_at: string;
  word_count: number;
}

export interface RecentNote {
  node_id: string;
  title: string;
  area_id: string;
  updated_at: string;
  path: string;
  word_count: number;
}

export type TextStatus = "pending" | "ok" | "none" | "unsupported" | "error";

export interface DocumentInfo {
  id: string;
  title: string;
  original_name: string;
  ext: string;
  mime: string;
  size: number;
  doc_type: string;
  page_count: number | null;
  text_status: TextStatus;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  file_present: boolean;
}

export interface Placement {
  node_id: string;
  area_id: string;
  title: string;
  path: string;
}

export interface DocumentDetail {
  document: DocumentInfo;
  placements: Placement[];
}

export interface ImportOutcome {
  file_name: string;
  document: DocumentInfo | null;
  error: string | null;
}

export type DocScope =
  | { kind: "all" }
  | { kind: "area"; id: string }
  | { kind: "node"; id: string }
  | { kind: "subtree"; id: string }
  | { kind: "unassigned" };

export type EntityType = "node" | "document" | "knowledge";

export interface NewLink {
  source_type: EntityType;
  source_id: string;
  target_type: EntityType;
  target_id: string;
  kind: "related" | "page" | "mention";
  anchor?: { page?: number };
}

export interface LinkView {
  id: string;
  kind: string;
  anchor: { page?: number } | null;
  direction: "outgoing" | "incoming";
  other_type: EntityType;
  other_id: string;
  other_title: string;
  /** Art des Strukturknotens bzw. Typ des Wissensobjekts */
  other_kind: string | null;
  other_path: string;
  other_missing: boolean;
  created_at: string;
}

export interface SearchHit {
  entity_type: "node" | "note" | "document" | "page" | "knowledge" | "card" | "task" | "exam" | "annotation";
  entity_id: string;
  area_id: string | null;
  page: number | null;
  title: string;
  snippet: string;
  path: string;
  /** Art des Strukturknotens bzw. Typ des Wissensobjekts */
  kind: string | null;
  /** bei Markierungen: zugehöriges Dokument */
  target_id: string | null;
}

export type TrashItemType = "node" | "document" | "knowledge" | "card" | "task" | "exam";

export interface TrashItem {
  item_type: TrashItemType;
  id: string;
  title: string;
  kind: string | null;
  area_id: string | null;
  deleted_at: string;
  children: number;
  path: string;
}

export interface BackupSettings {
  dir: string;
  second_dir: string | null;
  auto_enabled: boolean;
  keep: number;
  last_auto: string | null;
}

export interface BackupInfo {
  path: string;
  size: number;
  sha256: string;
  created_at: string;
  file_count: number;
  kind: string;
  second_copy: string | null;
  second_copy_error: string | null;
}

export interface VerifyReport {
  ok: boolean;
  created_at: string | null;
  schema_version: number | null;
  app_version: string | null;
  file_count: number;
  total_size: number;
  problems: string[];
}

export interface RestoreResult {
  previous_state_dir: string;
  created_at: string;
}

export interface BackupRecord {
  path: string;
  created_at: string;
  size: number;
  kind: string;
  status: string;
  message: string | null;
  exists: boolean;
}

export interface AppInfo {
  version: string;
  data_dir: string;
  db_path: string;
  files_dir: string;
  log_dir: string | null;
  schema_version: number;
  platform: string;
}

/** Fehler aus dem Backend. */
export interface BackendError {
  code: string;
  message: string;
}

// ---------- Phase 3: Wissen, Lernen, Planung ----------

export type KnowledgeType = "definition" | "schema" | "case" | "citation";
export type SourceKind = "eigen" | "vorlesung" | "lehrbuch" | "rechtsprechung" | "import" | "ki-vorschlag";

export interface DefinitionData {
  text: string;
  source: string;
  citation: string;
  example: string;
  notes: string;
}
export interface SchemaItem {
  id: string;
  text: string;
  note: string;
  children: SchemaItem[];
}
export interface SchemaData {
  norm: string;
  items: SchemaItem[];
  notes: string;
}
export interface CaseData {
  claim_basis: string;
  difficulty: 0 | 1 | 2 | 3;
  status: "offen" | "bearbeitet" | "wiederholen" | "";
  facts: string;
  question: string;
  notes: string;
  solution_note_id: string | null;
}
export interface CitationData {
  law: string;
  prefix: "§" | "Art." | "";
  number: string;
  paragraph: string;
  sentence: string;
  num: string;
  alt: string;
  notes: string;
}

export interface Knowledge<D = Record<string, unknown>> {
  id: string;
  type: KnowledgeType;
  area_id: string | null;
  node_id: string | null;
  title: string;
  field: string;
  source_kind: SourceKind;
  data: D;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface NewKnowledge {
  type: KnowledgeType;
  area_id?: string | null;
  node_id?: string | null;
  title: string;
  field?: string;
  source_kind?: SourceKind;
  data?: Record<string, unknown>;
}

export interface KnowledgePatch {
  title?: string;
  field?: string;
  source_kind?: SourceKind;
  area_id?: string | null;
  node_id?: string | null;
  data?: Record<string, unknown>;
}

export interface KnowledgeFilter {
  type?: KnowledgeType;
  area_id?: string | null;
  node_id?: string | null;
  field?: string | null;
}

export type CardKind = "frage" | "definition" | "norm";

export interface Card {
  id: string;
  area_id: string | null;
  node_id: string | null;
  kind: CardKind;
  front: string;
  back: string;
  tags: string;
  source_type: string | null;
  source_id: string | null;
  difficult: boolean;
  suspended: boolean;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface NewCard {
  area_id?: string | null;
  node_id?: string | null;
  kind?: CardKind;
  front: string;
  back: string;
  tags?: string;
  source_type?: "knowledge" | "node" | "document" | null;
  source_id?: string | null;
}

export interface CardPatch {
  front?: string;
  back?: string;
  kind?: CardKind;
  tags?: string;
  difficult?: boolean;
  suspended?: boolean;
  area_id?: string | null;
  node_id?: string | null;
}

export interface CardFilter {
  area_id?: string | null;
  node_id?: string | null;
  due_only?: boolean;
  difficult_only?: boolean;
  source_type?: string | null;
  source_id?: string | null;
  limit?: number;
}

export interface ReviewInput {
  rating: 1 | 2 | 3 | 4;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
}

export interface CardStats {
  total: number;
  due_now: number;
  new_cards: number;
  learning: number;
  review: number;
  difficult: number;
  suspended: number;
  reviewed_today: number;
  reviews_7d: number;
  retention_30d: number | null;
  due_7d: number;
}

export type TaskKind = "aufgabe" | "frage" | "lernziel";

export interface Task {
  id: string;
  area_id: string | null;
  node_id: string | null;
  kind: TaskKind;
  title: string;
  notes: string;
  due_date: string | null;
  done_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface NewTask {
  area_id?: string | null;
  node_id?: string | null;
  kind?: TaskKind;
  title: string;
  notes?: string;
  due_date?: string | null;
}

export interface TaskPatch {
  title?: string;
  notes?: string;
  kind?: TaskKind;
  due_date?: string | null;
  done?: boolean;
  node_id?: string | null;
}

export interface TaskFilter {
  area_id?: string | null;
  node_id?: string | null;
  include_done?: boolean;
  kind?: TaskKind | null;
}

export interface Exam {
  id: string;
  area_id: string | null;
  node_id: string | null;
  title: string;
  date: string;
  time: string;
  place: string;
  kind: string;
  notes: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ExamInput {
  area_id?: string | null;
  node_id?: string | null;
  title: string;
  date: string;
  time?: string;
  place?: string;
  kind?: string;
  notes?: string;
}

export type AnnotationColor = "gelb" | "gruen" | "blau" | "rot" | "lila";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Annotation {
  id: string;
  document_id: string;
  page: number;
  kind: "highlight" | "bookmark";
  color: AnnotationColor;
  rects: Rect[];
  quote: string;
  comment: string;
  created_at: string;
  updated_at: string;
}

export interface NewAnnotation {
  document_id: string;
  page: number;
  kind: "highlight" | "bookmark";
  color?: AnnotationColor;
  rects?: Rect[];
  quote?: string;
  comment?: string;
}

// ---------- KI-Assistent: Rechtsquellen ----------

export type LegalKind = "gesetz" | "urteil" | "kommentar" | "dokument";

export interface LegalSource {
  id: string;
  kind: LegalKind;
  title: string;
  abbreviation: string;
  court: string;
  file_number: string;
  decision_date: string;
  version: string;
  origin: string;
  chunk_count: number;
  imported_at: string;
}

export interface NewLegalSource {
  kind: LegalKind;
  title: string;
  abbreviation?: string;
  court?: string;
  file_number?: string;
  decision_date?: string;
  version?: string;
  origin?: string;
}

export interface NewLegalChunk {
  norm: string;
  absatz: number | null;
  heading: string;
  text: string;
}

/** Ein Abschnitt einer Rechtsquelle samt Angaben zur Quelle. */
export interface LegalHit {
  chunk_id: string;
  source_id: string;
  kind: LegalKind;
  title: string;
  abbreviation: string;
  court: string;
  file_number: string;
  decision_date: string;
  version: string;
  norm: string;
  absatz: number | null;
  heading: string;
  text: string;
  position: number;
}

export interface AiStatus {
  /** Ist ein API-Schlüssel verfügbar? */
  available: boolean;
  /** Woher: Umgebungsvariable (Desktop), Eingabe in dieser Sitzung (Browser) oder keiner */
  key_source: "env" | "session" | "none";
  /** Kann die App Gesetze selbst abrufen (nur Desktop)? */
  can_fetch_laws: boolean;
}

/** Rohe HTTP-Antwort der Weiterleitung an die Claude API (nur Desktop). */
export interface AiHttpResponse {
  status: number;
  headers: [string, string][];
  body: string;
}
