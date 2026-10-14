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

export type EntityType = "node" | "document";

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
  other_kind: NodeKind | null;
  other_path: string;
  other_missing: boolean;
  created_at: string;
}

export interface SearchHit {
  entity_type: "node" | "note" | "document" | "page";
  entity_id: string;
  area_id: string | null;
  page: number | null;
  title: string;
  snippet: string;
  path: string;
  kind: NodeKind | null;
}

export interface TrashItem {
  item_type: "node" | "document";
  id: string;
  title: string;
  kind: NodeKind | null;
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
