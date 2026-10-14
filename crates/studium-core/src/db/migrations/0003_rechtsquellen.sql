-- Migration 3: Rechtsquellen für den KI-Assistenten (Gesetze, Urteile, Kommentare, eigene Texte)
-- Nur additiv.

CREATE TABLE legal_sources (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('gesetz','urteil','kommentar','dokument')),
  title         TEXT NOT NULL,
  -- Gesetze: amtliche Abkürzung (BGB, StGB …)
  abbreviation  TEXT NOT NULL DEFAULT '',
  -- Urteile: Gericht, Aktenzeichen, Entscheidungsdatum
  court         TEXT NOT NULL DEFAULT '',
  file_number   TEXT NOT NULL DEFAULT '',
  decision_date TEXT NOT NULL DEFAULT '',
  -- Fassung / Stand (frei, z. B. „Stand: zuletzt geändert durch …“)
  version       TEXT NOT NULL DEFAULT '',
  -- Herkunft: Adresse oder Dateiname
  origin        TEXT NOT NULL DEFAULT '',
  chunk_count   INTEGER NOT NULL DEFAULT 0,
  imported_at   TEXT NOT NULL
);
CREATE INDEX legal_sources_abbr ON legal_sources(kind, abbreviation);

-- Abschnitte: je Absatz einer Norm bzw. je Absatz eines Textes.
CREATE TABLE legal_chunks (
  id        TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES legal_sources(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  -- normalisierte Normbezeichnung, z. B. „§ 433“ oder „Art. 20“ (leer bei Texten)
  norm      TEXT NOT NULL DEFAULT '',
  -- Absatznummer, falls erkennbar
  absatz    INTEGER,
  heading   TEXT NOT NULL DEFAULT '',
  text      TEXT NOT NULL
);
CREATE INDEX legal_chunks_norm ON legal_chunks(source_id, norm, absatz);
CREATE INDEX legal_chunks_pos ON legal_chunks(source_id, position);

CREATE VIRTUAL TABLE legal_index USING fts5(
  chunk_id  UNINDEXED,
  source_id UNINDEXED,
  norm,
  heading,
  text,
  tokenize = 'unicode61 remove_diacritics 2'
);
