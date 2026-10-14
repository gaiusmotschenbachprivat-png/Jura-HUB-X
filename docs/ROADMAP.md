# Roadmap

Status: ✅ umgesetzt und getestet · 🟡 teilweise · ⬜ offen

## Phase 1 – Planung ✅
Architektur, Stack, Projektstruktur, Datenmodell, Sicherheitskonzept, Risiken
(siehe ARCHITEKTUR.md, DATENHALTUNG.md, SICHERHEIT.md).

## Phase 2 – Funktionsfähiger Grundaufbau
| Funktion | Status |
|---|---|
| Lokale SQLite-Datenbank mit Migrationen und Sicherung vor Migration | siehe Phasenbericht |
| Studienbereiche (Rechtswissenschaften, Recht & Wirtschaft, WiWiZ) + Wechsel + Gesamtansicht | |
| Flexibler Strukturbaum (Semester, Modul, Veranstaltung, Termin, Thema, Ordner, Notiz) | |
| Semester archivieren/reaktivieren, Veranstaltungsdetails | |
| Notizeditor (Überschriften, Listen, Tabellen, Checklisten, Zitate, Code, Links, Hervorhebung) | |
| Autosave, Speicherstatus, Undo/Redo, Versionshistorie | |
| Vorlagen (Mitschrift, Definition, Gutachten, Streitstand, Schema, WiWi-Übung …) | |
| Dokumentimport (Dateiauswahl + Drag-and-drop), Zuordnung zu mehreren Knoten | |
| Globale Suche (FTS5) über Notizen, Struktur, Dokumentnamen, Dokumenttext | |
| Backup erstellen, prüfen, wiederherstellen, automatisch, zweiter Ordner | |
| DOCX- und Markdown-Export, DOCX-Import | |
| Papierkorb | |
| Dark/Light Mode, Schriftgröße, Tastaturkürzel, anpassbare Seitenleisten | |

## Phase 3 – Dokumente und Lernen
PDF-Ansicht (Seitenübersicht, Zoom, Suche, Lesezeichen, Markierungen, Kommentare),
Verknüpfung PDF-Seite ↔ Notiz, Folie neben Mitschrift, Definitionen, Prüfungsschemata,
Fälle, Gesetzesfundstellen, Karteikarten mit FSRS, Lernübersicht, Prüfungstermine,
Aufgaben/offene Fragen, Rückverweise („wo wird diese Definition verwendet?“).

## Phase 4 – Word und Export
PDF-Export, verknüpfte Word-Dateien mit Änderungserkennung (Hash + Änderungszeit),
Fußnoten im DOCX-Export, Tests mit realen Dokumenten.

## Phase 5 – Sicherheit und Stabilisierung
Verschlüsselte Backups (age), SQLCipher-Prüfung, Netzwerk-Audit, Tests unter
macOS/Windows, Signierung, Installationspakete.

## Phase 6 – Erweiterungen
Lokale OCR (Tesseract), Duplikaterkennung, lokale semantische Suche, optionale
KI-Funktionen nur mit ausdrücklicher Zustimmung.
