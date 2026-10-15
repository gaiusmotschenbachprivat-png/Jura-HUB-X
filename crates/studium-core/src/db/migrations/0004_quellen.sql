-- Schema 4: Literatur und Rechtsprechung („quelle“) als eigene Wissensart –
-- für Fußnoten mit Zitierhilfe und das Literaturverzeichnis.
-- SQLite kann CHECK-Bedingungen nicht ändern, daher wird die Tabelle neu angelegt.

CREATE TABLE knowledge_new (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('definition','schema','case','citation','quelle')),
  area_id     TEXT REFERENCES areas(id) ON DELETE SET NULL,
  node_id     TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  field       TEXT NOT NULL DEFAULT '',
  source_kind TEXT NOT NULL DEFAULT 'eigen',
  data        TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
INSERT INTO knowledge_new (id, type, area_id, node_id, title, field, source_kind, data, created_at, updated_at, deleted_at)
  SELECT id, type, area_id, node_id, title, field, source_kind, data, created_at, updated_at, deleted_at FROM knowledge;
DROP TABLE knowledge;
ALTER TABLE knowledge_new RENAME TO knowledge;
CREATE INDEX knowledge_type ON knowledge(type, deleted_at);
CREATE INDEX knowledge_area ON knowledge(area_id);
CREATE INDEX knowledge_node ON knowledge(node_id);
