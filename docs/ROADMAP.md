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

## Phase 3 – Dokumente und Lernen ✅
| Funktion | Status |
|---|---|
| PDF-Markierungen (5 Farben) aus Textauswahl, Kommentare, Lesezeichen, Seitenleiste mit Liste | ✅ |
| Markierungen und Kommentare durchsuchbar (mit Seite) | ✅ |
| Definitionen mit Fundstelle, Quelle, Beispiel; Rückverweise „Verwendet in“ | ✅ |
| Prüfungsschemata als Gliederungseditor (A. I. 1. a) aa) (1)) | ✅ |
| Fälle mit Sachverhalt, Fallfrage, Schwierigkeit, Stand, Lösung als Gutachten-Notiz | ✅ |
| Gesetzesfundstellen strukturiert, Schnelleingabe („§ 823 Abs. 1 BGB“), ohne Gesetzestexte | ✅ |
| Herkunftsangabe, Kennzeichnung ungeprüfter Inhalte | ✅ |
| Karteikarten (Frage/Antwort, Begriff/Definition, Norm), aus Definitionen, Schemata, Markierungen und Notiztext | ✅ |
| Wiederholung mit FSRS (ts-fsrs), Statistik, schwierige Karten, Pausieren | ✅ |
| Aufgaben, offene Fragen, Lernziele, Prüfungstermine; je Termin/Veranstaltung | ✅ |
| Lernübersicht (fällige Karten, Prüfungen, offene Fragen, nicht zusammengefasste Termine, unbearbeitete Übungsblätter) | ✅ |
| Bilder (Einfügen, Drag-and-drop, Screenshots) und Formeln (LaTeX/KaTeX) im Editor, auch im DOCX-Export | ✅ |
| Eigene Schlagwort-Verwaltung | ⬜ (Schlagwörter vorerst als Text an Karteikarten) |
| Graph-Darstellung der Verknüpfungen | ⬜ (optional; Navigation über Kontextbereich vorhanden) |

## iPad-/Browser-Version ✅ (Version 0.3)

Gleiche Oberfläche, Datenkern als TypeScript-Port, Speicherung im Gerät (OPFS/IndexedDB),
offline, Backups austauschbar mit der Desktop-App. Details: [IPAD.md](IPAD.md).

## Phase 4 – Word und Export ⬜
PDF-Export, verknüpfte Word-Dateien mit Änderungserkennung (Hash + Änderungszeit),
Fußnoten im DOCX-Export, Tests mit realen Dokumenten.

## Phase 5 – Sicherheit und Stabilisierung ⬜
`freezePrototype` wieder aktivieren (Word-Import isolieren), Verschlüsselte Backups (age), SQLCipher-Prüfung, Netzwerk-Audit, Tests unter
macOS/Windows, Signierung, Installationspakete.

## Phase 6 – Erweiterungen ⬜
Lokale OCR (Tesseract), Duplikaterkennung, lokale semantische Suche, optionale
KI-Funktionen nur mit ausdrücklicher Zustimmung.
