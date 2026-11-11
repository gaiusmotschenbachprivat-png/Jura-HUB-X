-- Schema 7: Karteikarten wie in einem Lernkartei-Programm.
--   deck         – Stapel mit Unterstapeln, getrennt durch „::“ (z. B. „Zivilrecht::BGB AT“)
--   template     – Kartentyp (basis, umgekehrt, definition, begriff, schema, luecke, eingabe)
--   fields       – weitere Felder des Kartentyps als JSON (Norm, Beispiel, Merke, Quelle …)
--   flag         – Flagge 0 (keine) bis 7
--   buried_until – zurückgestellt bis zu diesem Zeitpunkt (meist: morgen früh)
--   note_key/ord – zusammengehörige Karten (umgekehrte Karte, Lücken c1, c2 …)
-- Im Lernprotokoll: Antwortzeit und der Stand vor der Bewertung (für „Rückgängig“).

ALTER TABLE flashcards ADD COLUMN deck TEXT NOT NULL DEFAULT '';
ALTER TABLE flashcards ADD COLUMN template TEXT NOT NULL DEFAULT 'basis';
ALTER TABLE flashcards ADD COLUMN fields TEXT NOT NULL DEFAULT '{}';
ALTER TABLE flashcards ADD COLUMN flag INTEGER NOT NULL DEFAULT 0;
ALTER TABLE flashcards ADD COLUMN buried_until TEXT;
ALTER TABLE flashcards ADD COLUMN note_key TEXT;
ALTER TABLE flashcards ADD COLUMN ord INTEGER NOT NULL DEFAULT 0;
CREATE INDEX flashcards_deck ON flashcards(deck);
CREATE INDEX flashcards_note ON flashcards(note_key);

-- Bisherige Kartenarten als Kartentyp übernehmen
UPDATE flashcards SET template = 'definition' WHERE kind = 'definition';

ALTER TABLE review_log ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE review_log ADD COLUMN before TEXT NOT NULL DEFAULT '';
