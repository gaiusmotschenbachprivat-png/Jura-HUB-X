-- Schema 6: Verlauf des KI-Assistenten. Unterhaltungen bleiben auf dem Gerät
-- (und in Backups); nichts davon wird ohne neue Frage an Anthropic gesendet.
--   entries – Anzeige (mit Originalangaben, nur lokal)
--   state   – Verlauf für die Claude API (anonymisiert), Quellenverzeichnis und
--             Zuordnung der Platzhalter zu den Originalangaben (nur lokal)

CREATE TABLE ai_chats (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT '',
  task       TEXT NOT NULL DEFAULT 'recherche' CHECK (task IN ('recherche','vertrag','schriftsatz')),
  own_docs   INTEGER NOT NULL DEFAULT 0 CHECK (own_docs IN (0, 1)),
  entries    TEXT NOT NULL DEFAULT '[]',
  state      TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ai_chats_updated ON ai_chats(updated_at);
