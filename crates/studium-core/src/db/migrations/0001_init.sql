-- Migration 1: Grundschema (Phase 2)
-- Regel: Migrationen sind nur additiv. Bestehende Spalten werden nie gelöscht oder umgedeutet.

CREATE TABLE areas (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#3b5bdb',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE nodes (
  id          TEXT PRIMARY KEY,
  area_id     TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES nodes(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('semester','module','course','session','topic','folder','note')),
  title       TEXT NOT NULL,
  position    REAL NOT NULL DEFAULT 0,
  meta        TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  archived_at TEXT,
  deleted_at  TEXT
);
CREATE INDEX nodes_parent ON nodes(parent_id, position);
CREATE INDEX nodes_area ON nodes(area_id);
CREATE INDEX nodes_deleted ON nodes(deleted_at);

CREATE TABLE notes (
  node_id      TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  content_json TEXT NOT NULL,
  plain_text   TEXT NOT NULL DEFAULT '',
  template     TEXT,
  word_count   INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL
);

CREATE TABLE note_versions (
  id           TEXT PRIMARY KEY,
  node_id      TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  content_json TEXT NOT NULL,
  plain_text   TEXT NOT NULL,
  word_count   INTEGER NOT NULL DEFAULT 0,
  reason       TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX note_versions_node ON note_versions(node_id, created_at);

CREATE TABLE blobs (
  sha256     TEXT PRIMARY KEY,
  size       INTEGER NOT NULL,
  mime       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE documents (
  id            TEXT PRIMARY KEY,
  blob_sha      TEXT NOT NULL REFERENCES blobs(sha256),
  title         TEXT NOT NULL,
  original_name TEXT NOT NULL,
  ext           TEXT NOT NULL,
  doc_type      TEXT NOT NULL DEFAULT 'sonstiges',
  page_count    INTEGER,
  text_status   TEXT NOT NULL DEFAULT 'pending'
                CHECK (text_status IN ('pending','ok','none','unsupported','error')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX documents_blob ON documents(blob_sha);

CREATE TABLE document_pages (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_no     INTEGER NOT NULL,
  text        TEXT NOT NULL,
  PRIMARY KEY (document_id, page_no)
);

CREATE TABLE placements (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  node_id     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (document_id, node_id)
);
CREATE INDEX placements_node ON placements(node_id);

CREATE TABLE node_area_refs (
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  area_id TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  PRIMARY KEY (node_id, area_id)
);

CREATE TABLE links (
  id          TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'related',
  anchor      TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
);
CREATE INDEX links_source ON links(source_type, source_id);
CREATE INDEX links_target ON links(target_type, target_id);

CREATE VIRTUAL TABLE search_index USING fts5(
  entity_type UNINDEXED,
  entity_id   UNINDEXED,
  area_id     UNINDEXED,
  page        UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE backups (
  id         TEXT PRIMARY KEY,
  path       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  size       INTEGER NOT NULL,
  sha256     TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('manual','auto')),
  status     TEXT NOT NULL,
  message    TEXT
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
