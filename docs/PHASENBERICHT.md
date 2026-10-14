# Phasenbericht

## Phase 1 – Planung (abgeschlossen)

- Architekturentscheidung: Tauri 2 + React/TypeScript + Rust-Kern + SQLite/FTS5 ([ARCHITEKTUR.md](ARCHITEKTUR.md))
- Datenmodell und Speicherorte ([DATENHALTUNG.md](DATENHALTUNG.md))
- Sicherheitskonzept mit klarer Trennung von lokaler Speicherung, Verschlüsselung, Backup und Betriebssystemschutz ([SICHERHEIT.md](SICHERHEIT.md))
- Roadmap und Risiken ([ROADMAP.md](ROADMAP.md))

## Phase 2 – Funktionsfähiger Grundaufbau (abgeschlossen)

### Umgesetzt

Siehe Funktionsliste in der [README](../README.md). Alle Punkte der „Definition of Done“ für die
erste Version sind umgesetzt:

| Anforderung | Umsetzung | Getestet durch |
|---|---|---|
| Lokal starten | Tauri-App, Datenordner im Benutzerprofil | E2E |
| Zwischen den drei Bereichen wechseln | Bereichsreiter, `⌘/Strg+1–3`, Gesamtansicht | E2E |
| Semester, Module, Vorlesungen, Themen anlegen | Strukturbaum, Kontextmenü, Dialog, Drag-and-drop | Rust + E2E |
| Notizen professionell bearbeiten | TipTap-Editor, Vorlagen, Versionen | Vitest (Schema), E2E |
| Folien, Skripte, Übungsblätter importieren | Import mit Typ und Zuordnung, Deduplikation | Rust + E2E |
| Materialien Themen zuordnen | Mehrfachzuordnung ohne Kopie | Rust + E2E |
| Notizen mit konkreten Dokumentseiten verknüpfen | Seitenverknüpfung, geteilte Ansicht, Rückverweise | Rust + E2E |
| Inhalte global durchsuchen | FTS5 inkl. PDF-Text mit Seitenangabe | Rust + E2E |
| Schließen und ohne Datenverlust wieder öffnen | Autosave, Speichern beim Schließen, WAL/FULL | Rust + Vitest + E2E |
| Backup erstellen und wiederherstellen | geprüftes ZIP-Backup, sichere Wiederherstellung | Rust + E2E |
| Nach Word exportieren | DOCX-Export (mit Rundweg-Test), Markdown | Vitest + E2E (Schreibbefehl) |
| Ohne Internet nutzbar | keine Netzwerkkomponenten, CSP blockiert `fetch` | E2E |
| Speicherorte nachvollziehbar | Anzeige in der App + Dokumentation | manuell |

### Ausgeführte Tests (zuletzt alle bestanden)

- **Rust-Kern (`cargo test -p studium-core`)**: 23 Tests – Migrationen (inkl. Schutz vor neuerer
  Schemaversion), Struktur und Zyklenschutz, Bereichswechsel mit Unterknoten, Eingabeprüfung,
  Notizen/Versionen/Wiederherstellung, Neustart, Papierkorb, Dokumentimport mit Deduplikation,
  PDF-Signaturprüfung, fehlende Dateien, Verknüpfungen (auch interne Links im Text), Suche mit
  Sonderzeichen/Umlauten/Bereichsfilter, Backup-Rundweg, abgeschnittene/manipulierte Backups,
  Zip-Slip, Aufbewahrungsregeln.
- **Oberfläche (`npm test`)**: 13 Tests – Textableitung, alle Vorlagen gültig im Editor-Schema,
  DOCX-Export inkl. Rundweg mit unabhängigem DOCX-Leser, Markdown-Export/-Import, HTML-Escaping der
  Suchtreffer, Strukturbaum, Autosave (Zusammenfassen schneller Eingaben, Fehler und erneuter Versuch).
- **End-to-End (`tests/e2e/run.sh`)**: 35 Prüfungen an der echten Desktop-App (Linux/WebKitGTK) –
  vom Onboarding über Notiz, PDF-Import, Texterkennung, Suche, Seitenverknüpfung, geteilte Ansicht,
  Export, Sicherheitsgrenzen (kein Dateisystem-/Netzwerkzugriff aus der Oberfläche), Backup,
  Neustart, Wiederherstellung, beschädigtes Backup bis Papierkorb.

### Während der Tests gefundene und behobene Fehler

1. **App startete nicht** (leere Seite): Die Härtungsoption `freezePrototype` ist mit dem
   Word-Importer (underscore.js) unvereinbar. Option deaktiviert, Begründung in SICHERHEIT.md.
2. **Stylesheet-Kollision**: Das vollständige pdf.js-Stylesheet überschrieb globale Klassen
   (`.sidebar`, `.dialog`). Jetzt wird nur die benötigte Textebene eingebunden.
3. **Suche**: Ein schnell nach dem Tippen gedrücktes Enter wurde verschluckt. Jetzt öffnet es den
   ersten Treffer, sobald er da ist.
4. **Backup-Meldung** bei manipulierten Dateien war unklar („nicht lesbar“) – jetzt eindeutig.
5. Geteilte Ansicht ließ der Mitschrift zu wenig Platz; PDF-Seiten erzeugten einen Querscrollbalken.

### Bekannte Einschränkungen

- **Nicht auf macOS/Windows getestet.** Die Tests liefen unter Linux (gleiche Codebasis, WebKit-Engine
  wie macOS). Der CI-Workflow baut macOS- und Windows-Installationsdateien, sobald das Projekt auf GitHub liegt.
  Vor dem ernsthaften Einsatz bitte einmal auf dem eigenen Rechner durchklicken.
- **Keine App-eigene Verschlüsselung** (geplant Phase 5). Festplattenverschlüsselung des Systems nutzen.
- **PDF-Export** fehlt noch (Phase 4). DOCX-Export ist vorhanden; Word kann daraus PDF erzeugen.
- **Fußnoten, Bilder und Formeln** im Editor fehlen noch (Phase 3/4). Bilder aus importierten
  Word-Dateien werden nicht übernommen; die App weist beim Import darauf hin.
- **PDF-Markierungen, Lesezeichen und Kommentare** fehlen noch (Phase 3). Seitenverknüpfungen funktionieren.
- **Gescannte PDFs** werden angezeigt, aber nicht durchsucht (lokale OCR: Phase 6). Die App zeigt das an.
- **Verknüpfte Word-Dateien mit Änderungserkennung** fehlen noch (Phase 4). „Mit Standardprogramm öffnen“
  arbeitet mit einer Kopie; Änderungen daran fließen nicht zurück.
- **Definitionen, Prüfungsschemata, Fälle, Karteikarten, Prüfungstermine** gibt es bisher nur als
  Notizvorlagen, noch nicht als eigene Datenbankobjekte (Phase 3).
- Die App ist nicht signiert; macOS/Windows warnen beim ersten Start.
- `npm audit` meldet eine mittlere Schwachstelle in `sprintf-js` (über `argparse` → `mammoth`). Betroffen
  ist nur das Kommandozeilenwerkzeug von mammoth; der Code ist nicht im App-Paket enthalten (geprüft).

### Nächste Schritte (Phase 3)

1. PDF-Markierungen, Kommentare und Lesezeichen (gespeichert in der Datenbank, PDF bleibt unverändert)
2. Definitionsdatenbank, Prüfungsschemata (Baum), Fälle, Gesetzesfundstellen als eigene Objekte mit Rückverweisen
3. Karteikarten mit FSRS-Wiederholung und eine ruhige Lernübersicht
4. Aufgaben/offene Fragen und Prüfungstermine im Dashboard
5. Bilder und Formeln im Editor
