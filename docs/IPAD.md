# Studium OS auf dem iPad (Browser-Version)

Die iPad-Version ist dieselbe Oberfläche wie die Desktop-App. Sie läuft in Safari und lässt
sich über „Zum Home-Bildschirm“ wie eine App installieren. **Alle Daten bleiben auf dem iPad.**
Die Website liefert nur das Programm aus; es gibt keine Anmeldung, keinen Server für Daten
und keine Übertragung von Inhalten.

## Installation

1. Die Adresse der Web-App in **Safari** öffnen (siehe README, Abschnitt „iPad“).
2. Auf **Teilen** tippen → **Zum Home-Bildschirm** → **Hinzufügen**.
3. Studium OS ab jetzt immer über das Symbol auf dem Home-Bildschirm starten.

Warum Home-Bildschirm? Safari löscht Website-Daten, die länger nicht genutzt wurden, nur bei
Websites im Browser-Tab – nicht bei Apps auf dem Home-Bildschirm. Außerdem startet die App
dann im Vollbild und funktioniert offline.

## Updates

Neue Versionen lädt die App beim Öffnen bzw. beim Zurückwechseln selbst und startet dann kurz neu
(ungespeicherte Änderungen werden vorher gesichert). **Einmalig** nach dem Update von Version 0.4.0
oder älter: die App am iPad ganz schließen (in der App-Übersicht nach oben wischen) und neu öffnen –
die alte Version hielt sich sonst im Zwischenspeicher fest.

## Technik

| Teil | Desktop-App | iPad-/Browser-Version |
|---|---|---|
| Oberfläche | React (gleicher Code) | React (gleicher Code) |
| Datenkern | Rust (`crates/studium-core`) | TypeScript-Port (`src/core`), gleiche SQL-Texte und Prüfungen |
| Datenbank | SQLite (Datei) | SQLite (WebAssembly, sqlite-wasm) im Web Worker |
| Ablage | Datenordner | privates Dateisystem der Website (OPFS); falls nicht verfügbar: IndexedDB |
| Migrationen | `crates/studium-core/src/db/migrations/*.sql` | dieselben Dateien |
| Backup-Format | `.studiumbackup` | identisch – Backups sind zwischen iPad und Rechner austauschbar |
| Offline | immer | Service Worker hält die App-Dateien vor (keine Nutzerdaten) |

Speichervarianten:
- **OPFS mit synchronem Zugriff** (bevorzugt): Datenbank als Datei, Änderungen sofort dauerhaft.
- **IndexedDB** (Ersatz, falls der Browser den synchronen Dateizugriff nicht anbietet): Die
  Datenbank liegt im Arbeitsspeicher und wird nach jeder Änderung vollständig in einer
  IndexedDB-Transaktion gesichert, *bevor* die Oberfläche die Speicherung bestätigt.

Welche Variante aktiv ist, steht unter **Einstellungen → Daten & Sicherheit**.

Nur ein Tab/Fenster darf die Daten gleichzeitig bearbeiten (Web Locks); ein zweiter Tab
wird mit einer Meldung abgewiesen.

## Backups auf dem iPad

1. **Einstellungen → Backup → Jetzt Backup erstellen.** Das Backup entsteht im App-Speicher
   und wird sofort vollständig geprüft.
2. **In Dateien sichern** öffnet das Teilen-Menü. Dort „In Dateien sichern“ wählen und einen
   Ort aussuchen (z. B. USB-Stick, „Auf meinem iPad“). Erst dann schützt das Backup auch bei
   Verlust oder Defekt des iPads.
3. Wiederherstellen: **Aus Backup-Datei wiederherstellen …** – funktioniert auch mit Backups
   der Desktop-App. Der bisherige Stand wird vorher als eigenes Backup aufbewahrt.

**Achtung:** Wer in den iPad-Einstellungen die Website-Daten löscht oder die App vom
Home-Bildschirm entfernt, löscht auch die Studiendaten. Deshalb regelmäßig sichern.

## Unterschiede zur Desktop-App

- Kein frei wählbarer Backup-Ordner; Backups werden über das Teilen-Menü gesichert.
- „Mit Standardprogramm öffnen“: PDFs und Bilder öffnen in einem neuen Tab, andere Dateien
  werden über das Teilen-Menü angeboten (z. B. „In Word öffnen“).
- Kontextmenüs: **lange drücken** statt Rechtsklick. Verschieben im Strukturbaum per Ziehen
  geht nur mit Maus/Trackpad.
- Tastenkürzel funktionieren mit angeschlossener Tastatur (⌘ K usw.).

## Tests

- `npm test` – Kern (TypeScript-Port) gegen SQLite-WebAssembly, u. a. Backups, Suche, FSRS.
- `npm run build:web && npm run test:web` – Ende-zu-Ende in Chromium (Oberfläche, Import,
  Suche, Neuladen, Backup, Wiederherstellung, zweiter Tab, offline, Hochformat).
- `tests/e2e-web/webkit-run.py` – dieselben Kernabläufe in WebKit (Safari-Engine, Linux).
- GitHub-Workflow: Lauf im echten Safari auf macOS (`tests/e2e-web/safari-run.mjs`).

Nicht automatisch prüfbar: das Verhalten auf einem echten iPad (Teilen-Menü, Home-Bildschirm).
