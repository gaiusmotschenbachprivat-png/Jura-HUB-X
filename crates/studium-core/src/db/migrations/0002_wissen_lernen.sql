-- Migration 2: Wissensobjekte, Lernen, Planung, PDF-Markierungen (Phase 3)
-- Nur additiv: neue Tabellen, keine Änderung bestehender Daten.

-- Definitionen, Prüfungsschemata, Fälle und Gesetzesfundstellen.
-- Gemeinsame Felder als Spalten, typspezifische Felder als geprüftes JSON (`data`).
CREATE TABLE knowledge (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('definition','schema','case','citation')),
  area_id     TEXT REFERENCES areas(id) ON DELETE SET NULL,
  node_id     TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  field       TEXT NOT NULL DEFAULT '',
  -- Herkunft: eigen, vorlesung, lehrbuch, rechtsprechung, import, ki-vorschlag
  source_kind TEXT NOT NULL DEFAULT 'eigen',
  data        TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX knowledge_type ON knowledge(type, deleted_at);
CREATE INDEX knowledge_area ON knowledge(area_id);
CREATE INDEX knowledge_node ON knowledge(node_id);

-- Karteikarten mit Wiederholungsstand (FSRS).
CREATE TABLE flashcards (
  id             TEXT PRIMARY KEY,
  area_id        TEXT REFERENCES areas(id) ON DELETE SET NULL,
  node_id        TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL DEFAULT 'frage' CHECK (kind IN ('frage','definition','norm')),
  front          TEXT NOT NULL,
  back           TEXT NOT NULL,
  tags           TEXT NOT NULL DEFAULT '',
  source_type    TEXT,
  source_id      TEXT,
  difficult      INTEGER NOT NULL DEFAULT 0,
  suspended      INTEGER NOT NULL DEFAULT 0,
  -- FSRS-Zustand
  due            TEXT NOT NULL,
  stability      REAL NOT NULL DEFAULT 0,
  difficulty     REAL NOT NULL DEFAULT 0,
  elapsed_days   INTEGER NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  learning_steps INTEGER NOT NULL DEFAULT 0,
  reps           INTEGER NOT NULL DEFAULT 0,
  lapses         INTEGER NOT NULL DEFAULT 0,
  state          INTEGER NOT NULL DEFAULT 0,
  last_review    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);
CREATE INDEX flashcards_due ON flashcards(deleted_at, suspended, due);
CREATE INDEX flashcards_area ON flashcards(area_id);

CREATE TABLE review_log (
  id             TEXT PRIMARY KEY,
  card_id        TEXT NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
  rating         INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
  state_before   INTEGER NOT NULL,
  due_before     TEXT NOT NULL,
  stability      REAL NOT NULL,
  difficulty     REAL NOT NULL,
  scheduled_days INTEGER NOT NULL,
  reviewed_at    TEXT NOT NULL
);
CREATE INDEX review_log_card ON review_log(card_id, reviewed_at);
CREATE INDEX review_log_time ON review_log(reviewed_at);

-- Aufgaben und offene Fragen.
CREATE TABLE tasks (
  id         TEXT PRIMARY KEY,
  area_id    TEXT REFERENCES areas(id) ON DELETE SET NULL,
  node_id    TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL DEFAULT 'aufgabe' CHECK (kind IN ('aufgabe','frage','lernziel')),
  title      TEXT NOT NULL,
  notes      TEXT NOT NULL DEFAULT '',
  due_date   TEXT,
  done_at    TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX tasks_open ON tasks(deleted_at, done_at, due_date);

-- Prüfungstermine.
CREATE TABLE exams (
  id         TEXT PRIMARY KEY,
  area_id    TEXT REFERENCES areas(id) ON DELETE SET NULL,
  node_id    TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  title      TEXT NOT NULL,
  date       TEXT NOT NULL,
  time       TEXT NOT NULL DEFAULT '',
  place      TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX exams_date ON exams(deleted_at, date);

-- PDF-Markierungen, Kommentare und Lesezeichen. Die PDF-Datei bleibt unverändert;
-- Positionen sind relativ zur Seitengröße (0..1) gespeichert.
CREATE TABLE annotations (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page        INTEGER NOT NULL CHECK (page >= 1),
  kind        TEXT NOT NULL CHECK (kind IN ('highlight','bookmark')),
  color       TEXT NOT NULL DEFAULT 'gelb',
  rects       TEXT NOT NULL DEFAULT '[]',
  quote       TEXT NOT NULL DEFAULT '',
  comment     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX annotations_doc ON annotations(document_id, page);
