-- Schema 5: Handschrift (Apple Pencil) auf PDF-Seiten als eigene Art der
-- Markierung („ink“). Die Striche liegen als Vektordaten in `ink`, relativ zur
-- Seite; die PDF-Datei selbst bleibt unverändert.
-- SQLite kann CHECK-Bedingungen nicht ändern, daher wird die Tabelle neu angelegt.

CREATE TABLE annotations_new (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page        INTEGER NOT NULL CHECK (page >= 1),
  kind        TEXT NOT NULL CHECK (kind IN ('highlight','bookmark','ink')),
  color       TEXT NOT NULL DEFAULT 'gelb',
  rects       TEXT NOT NULL DEFAULT '[]',
  quote       TEXT NOT NULL DEFAULT '',
  comment     TEXT NOT NULL DEFAULT '',
  ink         TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
INSERT INTO annotations_new (id, document_id, page, kind, color, rects, quote, comment, created_at, updated_at)
  SELECT id, document_id, page, kind, color, rects, quote, comment, created_at, updated_at FROM annotations;
DROP TABLE annotations;
ALTER TABLE annotations_new RENAME TO annotations;
CREATE INDEX annotations_doc ON annotations(document_id, page);
