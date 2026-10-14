# Studium OS

Lokales Arbeitsinstrument für das Studium (Rechtswissenschaften, Recht & Wirtschaft, WiWiZ):
Studienstruktur, Mitschriften, Vorlesungsfolien und Skripte, Verknüpfungen, Volltextsuche
und Backups. **Alles läuft lokal.** Keine Anmeldung, kein Server, keine Cloud, kein Tracking.

> Stand: Version 0.3 (Phase 3 – Dokumente und Lernen, dazu die iPad-/Browser-Version). Was fertig ist und was
> noch fehlt, steht in [docs/ROADMAP.md](docs/ROADMAP.md) und [docs/PHASENBERICHT.md](docs/PHASENBERICHT.md).

## Funktionen

- **Studienbereiche** mit eigener Farbe, Wechsel per Klick oder `⌘/Strg + 1/2/3`, Gesamtansicht `⌘/Strg + 0`
- **Flexible Struktur**: Semester → Modul → Veranstaltung → Vorlesungstermin → Thema → Notiz, beliebig tief,
  per Drag-and-drop verschiebbar, Semester archivierbar, Inhalte „auch relevant für“ andere Bereiche (ohne Kopie)
- **Editor**: Überschriften, Listen, Checklisten, Tabellen, Zitate/Definitionskästen, Text-/Formelblöcke,
  Hervorhebung, Ausrichtung, Weblinks und interne Verknüpfungen, Undo/Redo, Autosave mit Statusanzeige,
  Versionshistorie mit Wiederherstellung
- **Vorlagen**: Vorlesungsmitschrift, Definition, Prüfungsschema, Gutachten, Falllösung, Streitstand,
  Prüfungsvorbereitung, Lernzusammenfassung, wissenschaftliche Arbeit, WiWi-Mitschrift, Übungsaufgabe mit Rechenweg
- **Dokumente**: Import per Dialog oder Drag-and-drop (PDF, Word, PowerPoint, Excel, Text, Markdown, Bilder),
  Zuordnung zu mehreren Veranstaltungen ohne Kopie, Originale bleiben unverändert, Erkennung fehlender Dateien
- **PDF-Ansicht**: Seitenübersicht, Zoom, Seitennavigation, Textsuche, Text markieren/kopieren
- **Folie ↔ Mitschrift**: konkrete PDF-Seite mit Notiz verknüpfen, Folie neben der Mitschrift öffnen,
  „Mitschrift zu Seite N“ mit einem Klick, Rückverweise in beide Richtungen
- **Globale Suche** (`⌘/Strg + K`): Notizen, Struktur, Dozent/Ort, Dokumentnamen und PDF-/Word-Text mit Seitenangabe
- **Word**: Export als `.docx` und Markdown, Import von `.docx`/`.md`/`.txt` als Notiz, „Mit Standardprogramm öffnen“ (Kopie)
- **Backups**: vollständig in eine Datei, frei wählbarer Ordner (auch USB-Stick), zweite Kopie, automatisch täglich,
  Prüfung auf Vollständigkeit/Beschädigung, sichere Wiederherstellung mit Aufbewahrung des vorherigen Stands
- **PDF-Markierungen**: Text markieren (5 Farben), kommentieren, Lesezeichen setzen; alles durchsuchbar,
  die PDF bleibt unverändert
- **Wissen**: Definitionen, Prüfungsschemata (Gliederungseditor A. I. 1. a) aa)), Fälle mit Gutachten-Lösung,
  Gesetzesfundstellen; Rückverweise „Verwendet in“, Herkunftsangabe, ungeprüfte Inhalte gekennzeichnet
- **Karteikarten** mit Wiederholungsplanung nach FSRS, aus Definitionen, Schemata, PDF-Markierungen oder Notiztext
- **Planung**: Aufgaben, offene Fragen, Lernziele (auch je Vorlesungstermin), Prüfungstermine, ruhige Lernübersicht
- **Bilder und Formeln** im Editor (Screenshots einfügen, LaTeX mit KaTeX), auch im Word-Export
- **Papierkorb**, Dark/Light Mode, Schriftgröße, anpassbare Seitenleisten, Fokusmodus

## Installation und Start

### Voraussetzungen (einmalig)

| | macOS | Windows |
|---|---|---|
| Node.js | 20 oder neuer: <https://nodejs.org> | 20 oder neuer: <https://nodejs.org> |
| Rust | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` | Installer von <https://rustup.rs> |
| System | Xcode-Befehlszeilenwerkzeuge: `xcode-select --install` | „Microsoft C++ Build Tools“ (Workload *Desktopentwicklung mit C++*). WebView2 ist in Windows 10/11 bereits enthalten. |

### Entwickeln / Ausprobieren

```bash
npm install
npm run tauri dev
```

Beim ersten Start dauert das Kompilieren einige Minuten, danach startet die App in Sekunden.

### Installationsdatei bauen

```bash
npm run tauri build
```

Ergebnis:
- macOS: `target/release/bundle/dmg/Studium OS_0.3.0_*.dmg`
- Windows: `target/release/bundle/msi/Studium OS_0.3.0_*.msi` und `…/nsis/*-setup.exe`

Die App ist noch nicht signiert. macOS zeigt beim ersten Öffnen eine Warnung: Rechtsklick auf die App
→ „Öffnen“. Windows SmartScreen: „Weitere Informationen“ → „Trotzdem ausführen“.

Alternativ baut der GitHub-Workflow (`.github/workflows/ci.yml`) die Installationsdateien für macOS und
Windows automatisch, sobald das Projekt in einem GitHub-Repository liegt.

## iPad

Studium OS gibt es auch als Web-App für das iPad (Safari, „Zum Home-Bildschirm“). Alle Daten
bleiben auf dem iPad; Backups sind mit der Desktop-App austauschbar. Einrichtung, Technik und
Unterschiede: [docs/IPAD.md](docs/IPAD.md).

Bauen: `npm run build:web` (Ergebnis in `dist-web/`). Der Workflow `.github/workflows/pages.yml`
veröffentlicht sie auf GitHub Pages.

## Wo liegen meine Daten?

| System | Ordner |
|---|---|
| macOS | `~/Library/Application Support/de.studium-os.app/` |
| Windows | `%APPDATA%\de.studium-os.app\` |

Details: [docs/DATENHALTUNG.md](docs/DATENHALTUNG.md). Der Pfad steht auch in der App unter
**Einstellungen & Backup → Daten & Sicherheit**.

**Wichtig:** Die Daten sind lokal, aber in der aktuellen Version nicht von der App verschlüsselt. Schalte FileVault
(macOS) bzw. BitLocker/Geräteverschlüsselung (Windows) ein und lege regelmäßig Backups auf einem externen
Datenträger an. Siehe [docs/SICHERHEIT.md](docs/SICHERHEIT.md).

## Tests

```bash
npm test                 # Oberflächenlogik (Vitest): Export, Vorlagen, Autosave, FSRS, Gliederung …
npm run test:rust        # Rust-Kern: Datenbank, Migrationen, Suche, Dokumente, Backups
npm run typecheck        # TypeScript
npm run build:web && npm run test:web   # iPad-/Browser-Version im Browser (Playwright)
tests/e2e/run.sh         # echte Desktop-App per WebDriver, Phase 2 + 3 (nur Linux, siehe Skriptkopf)
```

## Projektstruktur

```
crates/studium-core/   Rust-Kern ohne Tauri: Datenbank, Struktur, Notizen, Dokumente, Suche, Backups
src-tauri/             Tauri-Hülle: Befehle, Rechte (capabilities), Konfiguration, CSP
src/                   React-Oberfläche (features/, lib/, ui/, styles/, api/)
tests/e2e/             End-to-End-Test der echten App
docs/                  Architektur, Datenhaltung, Sicherheit, Roadmap, Phasenbericht
```

Architektur und Entscheidungen: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md).

## Browser-Vorschau (nur Entwicklung)

`npm run dev` und dann <http://localhost:1420/?demo> öffnet die Oberfläche im Browser mit einem
Arbeitsspeicher-Backend und deutlich markierten Beispieldaten. Dort wird nichts gespeichert.
