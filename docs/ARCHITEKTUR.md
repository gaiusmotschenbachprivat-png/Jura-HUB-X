# Architektur von Studium OS

Stand: Ende Phase 2 (Version 0.1). Dieses Dokument beschreibt die
Architekturentscheidungen, die Schichten der Anwendung und die technischen Risiken.

## 1. Architekturentscheidung (ADR-001): Tauri 2 + React + Rust-Kern + SQLite

**Entscheidung:** Desktop-App mit **Tauri 2**. Die Oberfläche ist **React 19 + TypeScript**
(Vite). Die gesamte Geschäftslogik für Daten, Dateien, Suche und Backups liegt in einer
eigenständigen **Rust-Bibliothek `studium-core`**. Diese nutzt **SQLite** (über `rusqlite`,
mit eingebautem SQLite und FTS5).

**Begründung:**

| Anforderung | Warum diese Wahl passt |
|---|---|
| Vollständig lokal, offline | Tauri bündelt kein Netzwerk-Backend. SQLite ist eine Datei, kein Server. |
| Sicherheit | Rust für Dateisystem, Pfade und Backups. Die Oberfläche bekommt **keinen** direkten Datei- oder SQL-Zugriff, nur eng definierte Befehle. |
| macOS und Windows | Tauri nutzt die systemeigene WebView (WKWebView bzw. WebView2). Kein mitgeliefertes Chromium. |
| Langfristige Wartbarkeit | Der Rust-Kern ist ohne Tauri testbar (`cargo test`). Die Oberfläche ist austauschbar. |
| Performance | SQLite + FTS5 schafft Hunderttausende Einträge. Dokumente liegen als Dateien, nicht in der Datenbank. |

**Geprüfte Alternativen:**
- *Electron*: größer (≈150 MB), eigenes Chromium mit eigener Update-Pflicht, Node-Zugriff
  in der Oberfläche ist ein häufiger Angriffsweg. Kein Vorteil für dieses Projekt.
- *tauri-plugin-sql* (SQL direkt aus JavaScript): verworfen. Die Oberfläche dürfte dann
  beliebiges SQL ausführen. Stattdessen typisierte Rust-Befehle.
- *Reine Web-App*: erfüllt die Offline- und Dateisystem-Anforderungen nicht zuverlässig.

## 2. Schichten

```
┌──────────────────────────── Oberfläche (src/) ────────────────────────────┐
│ features/*   Bildschirme: Navigation, Editor, Dokumente, Suche, Backup … │
│ ui/*         wiederverwendbare Bausteine (Button, Dialog, Splitter …)     │
│ lib/*        reine Logik: DOCX-Export/-Import, PDF-Text, Formatierung      │
│ api/*        typisierte Brücke zum Backend (+ In-Memory-Mock für Tests)    │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │  Tauri IPC (invoke), nur freigegebene Befehle
┌───────────────────────────────▼──── Tauri-Hülle (src-tauri/) ─────────────┐
│ commands/*   dünne Adapter: Argumente prüfen → studium-core aufrufen       │
│ state.rs     eine Datenbankverbindung (Mutex), Pfade, Auto-Backup-Timer    │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │  normale Rust-Aufrufe
┌───────────────────────────────▼──── studium-core (crates/studium-core) ───┐
│ db/          Verbindung, PRAGMAs, Migrationen                              │
│ repo/        Studienbereiche, Struktur, Notizen, Versionen, Verknüpfungen, │
│              Dokumente, Papierkorb                                         │
│ search.rs    FTS5-Index und Abfragen                                       │
│ files.rs     inhaltsadressierter Dokumentenspeicher, Pfad-/Namensprüfung   │
│ backup.rs    Backup erstellen, prüfen, wiederherstellen                    │
└───────────────────────────────────────────────────────────────────────────┘
```

Regeln:
1. Die Oberfläche kennt keine Dateipfade im Datenordner und kein SQL.
2. Jede schreibende Operation, die mehrere Tabellen berührt, läuft in **einer Transaktion**
   (Inhalt + Suchindex + Versionshistorie gemeinsam oder gar nicht).
3. Tauri-Befehle enthalten keine Geschäftslogik. Sie sind Adapter.
4. Fehler werden als verständliche deutsche Meldung an die Oberfläche gegeben. Technische
   Details gehen ins Protokoll, **ohne** Notizinhalte.

## 3. Technologie-Stack

| Bereich | Wahl | Hinweis |
|---|---|---|
| Desktop-Hülle | Tauri 2 | Plugins nur: `dialog` (Dateiauswahl), `opener` (Datei mit Standardprogramm öffnen) |
| Oberfläche | React 19, TypeScript (strict), Vite | |
| Zustand | Zustand (kleiner, gepflegter Store) | |
| Editor | TipTap 3 (ProseMirror) | Inhalt als ProseMirror-JSON gespeichert |
| PDF | pdf.js (`pdfjs-dist`), lokal gebündelt | Rendering und Textextraktion in der WebView, kein Netz |
| DOCX-Export | `docx` (npm) | erzeugt echte .docx-Dateien |
| DOCX-Import | `mammoth` (npm) | DOCX → HTML → Editor; Makros werden nie ausgeführt |
| Datenbank | SQLite 3 (gebündelt via `rusqlite`), WAL, FTS5 | |
| IDs | UUID v7 (zeitlich sortierbar) | |
| Hashes | SHA-256 (`sha2`) | Deduplikation und Backup-Prüfung |
| Backups | ZIP (`zip`) mit `manifest.json` | |
| Styles | eigene CSS-Variablen (Design-Tokens), keine UI-Bibliothek | |
| Tests | `cargo test` (Kern), Vitest (Oberflächenlogik) | |

## 4. Projektstruktur

```
studium-os/
├── README.md
├── docs/                    Architektur, Datenhaltung, Sicherheit, Roadmap
├── crates/studium-core/     Rust-Kern (ohne Tauri, vollständig testbar)
│   ├── src/db/              Verbindung + Migrationen (migrations/*.sql)
│   ├── src/repo/            Datenzugriff je Entität
│   ├── src/search.rs
│   ├── src/files.rs
│   ├── src/backup.rs
│   └── tests/               Integrationstests
├── src-tauri/               Tauri-Hülle, Befehle, Konfiguration, Rechte
└── src/                     React-Oberfläche
    ├── api/                 Befehle + Typen + Mock + Browser-Backend (web.ts)
    ├── core/                Datenkern als TypeScript-Port (iPad-/Browser-Version)
    ├── web/                 Daten-Worker, OPFS-/IndexedDB-Speicher
    ├── features/            ein Ordner je Funktionsbereich
    ├── lib/                 reine Logik (getestet mit Vitest)
    ├── ui/                  Bausteine
    └── styles/              Design-Tokens, Grundtypografie
```

### iPad-/Browser-Version (ADR-002)

Tauri läuft nicht auf dem iPad. Statt einer zweiten Oberfläche läuft dieselbe React-App im
Browser mit einem eigenen Backend (`src/api/web.ts`). Der Datenkern ist ein TypeScript-Port
von `studium-core` (`src/core`), der dieselben SQL-Migrationsdateien und SQL-Texte nutzt und
in einem Web Worker gegen SQLite (WebAssembly) läuft. Das Backup-Format ist identisch, damit
Daten zwischen iPad und Rechner wandern können. Abwägung: Zwei Implementierungen des Kerns
müssen synchron gehalten werden; dafür sind die Tests beider Seiten parallel aufgebaut.
Details: [IPAD.md](IPAD.md).

### KI-Assistent (ADR-003)

Optionales Modul in `src/ai/` (TypeScript, läuft am Desktop und auf dem iPad gleich). Claude wird
über das offizielle SDK `@anthropic-ai/sdk` angesprochen; am Desktop über einen eigenen `fetch`, der
an den Rust-Befehl `ai_http` weiterleitet (Schlüssel bleibt in Rust, CSP der Oberfläche bleibt zu).
Retrieval nutzt die vorhandene SQLite-FTS5-Suche über eigene Tabellen (`legal_sources`,
`legal_chunks`, `legal_index`, Migration 0003) statt einer separaten Vektordatenbank: offline,
ohne zusätzliches Modell, gut für exakte Normbezüge; die Suchschicht (`Retriever`) ist austauschbar.
Details: [KI-ASSISTENT.md](KI-ASSISTENT.md).

## 5. Editor-Datenmodell

Notizen werden als **ProseMirror-JSON** gespeichert (strukturierter Baum aus Absätzen,
Überschriften, Listen, Tabellen …). Zusätzlich wird bei jedem Speichern der reine Text
abgeleitet und in den Suchindex geschrieben. Gespeichert wird nicht bei jedem Tastendruck,
sondern 800 ms nach der letzten Eingabe sowie beim Wechsel der Notiz und beim Schließen.
Versionen entstehen höchstens alle 10 Minuten pro Notiz und zusätzlich vor jeder
Wiederherstellung einer alten Version.

## 6. Technische Risiken

| Risiko | Einschätzung | Gegenmaßnahme |
|---|---|---|
| DOCX-Treue (Fußnoten, komplexe Tabellen) | mittel | Export aus eigenem Datenmodell; bekannte Grenzen dokumentieren; Testdokumente |
| PDF-Export | mittel | Phase 4: Druckansicht der WebView ist je OS unterschiedlich. Alternative: PDF aus DOCX via lokales LibreOffice, falls installiert |
| Große PDFs (Folien mit 300+ Seiten) | mittel | Text nur einmal beim Import extrahieren, seitenweise speichern; Rendering seitenweise (virtuell) |
| Verschlüsselung der Datenbank | hoch (Aufwand) | Phase 5: SQLCipher prüfen. Bis dahin: Festplattenverschlüsselung des Betriebssystems (siehe SICHERHEIT.md) |
| OCR offline | hoch | Phase 6: Tesseract lokal, optional. Dokumente ohne Text werden klar markiert |
| WebView-Unterschiede macOS/Windows | niedrig–mittel | Keine exotischen Web-APIs, Tests auf beiden Systemen vor Release |
| Datenverlust bei Absturz | niedrig | WAL, `synchronous=FULL`, Transaktionen, Autosave, Versionen, Backups |
| Migrationen zerstören Daten | niedrig | nur additive Migrationen, vor jeder Migration automatisches Backup, Migrationstests |
