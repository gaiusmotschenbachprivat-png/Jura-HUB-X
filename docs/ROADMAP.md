# Roadmap

Status: ✅ umgesetzt und getestet · 🟡 teilweise · ⬜ offen

## Phase 1 – Planung ✅
Architektur, Stack, Projektstruktur, Datenmodell, Sicherheitskonzept, Risiken
(siehe ARCHITEKTUR.md, DATENHALTUNG.md, SICHERHEIT.md).

## Phase 2 – Funktionsfähiger Grundaufbau ✅
| Funktion | Status |
|---|---|
| Lokale SQLite-Datenbank mit Migrationen und Sicherung vor Migration | ✅ |
| Studienbereiche + Wechsel + Gesamtansicht + „auch relevant für“ | ✅ |
| Flexibler Strukturbaum mit Drag-and-drop, Archiv | ✅ |
| Veranstaltungsangaben (Dozent, Zeit, Ort, Beschreibung, Lernziele) | ✅ |
| Notizeditor (Überschriften, Listen, Tabellen, Checklisten, Zitate, Textblöcke, Links, Hervorhebung, Ausrichtung) | ✅ |
| Autosave, Speicherstatus, Undo/Redo, Versionshistorie | ✅ |
| Vorlagen Jura und Wirtschaft | ✅ |
| Dokumentimport (Dialog + Drag-and-drop), Mehrfachzuordnung, Deduplikation | ✅ |
| PDF-Ansicht (Seitenübersicht, Zoom, Navigation, Textsuche, Textauswahl) | ✅ (vorgezogen aus Phase 3) |
| Verknüpfung PDF-Seite ↔ Notiz, geteilte Ansicht, Rückverweise | ✅ (vorgezogen aus Phase 3) |
| Globale Suche (FTS5) inkl. PDF-/Word-Text mit Seitenangabe | ✅ |
| Backup erstellen/prüfen/wiederherstellen, automatisch, zweiter Ordner | ✅ |
| DOCX- und Markdown-Export, DOCX/MD/TXT-Import als Notiz | ✅ (vorgezogen aus Phase 4) |
| Papierkorb | ✅ |
| Dark/Light Mode, Schriftgröße, Tastaturkürzel, anpassbare Seitenleisten, Fokusmodus | ✅ |

## Phase 3 – Dokumente und Lernen ⬜
PDF-Lesezeichen, Markierungen, Kommentare; Bilder und Formeln im Editor; Definitionen, Prüfungsschemata,
Fälle, Gesetzesfundstellen, Karteikarten mit FSRS, Lernübersicht, Prüfungstermine,
Aufgaben/offene Fragen, Rückverweise („wo wird diese Definition verwendet?“).

## Phase 4 – Word und Export ⬜
PDF-Export, verknüpfte Word-Dateien mit Änderungserkennung (Hash + Änderungszeit),
Fußnoten im DOCX-Export, Tests mit realen Dokumenten.

## Phase 5 – Sicherheit und Stabilisierung ⬜
`freezePrototype` wieder aktivieren (Word-Import isolieren), Verschlüsselte Backups (age), SQLCipher-Prüfung, Netzwerk-Audit, Tests unter
macOS/Windows, Signierung, Installationspakete.

## Phase 6 – Erweiterungen ⬜
Lokale OCR (Tesseract), Duplikaterkennung, lokale semantische Suche, optionale
KI-Funktionen nur mit ausdrücklicher Zustimmung.
