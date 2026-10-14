# Sicherheitskonzept

## 1. Begriffe sauber getrennt

| Begriff | Was es bedeutet | Was es **nicht** bedeutet |
|---|---|---|
| **Lokale Speicherung** | Daten liegen nur auf deinem Rechner. | Nicht automatisch verschlüsselt. Wer Zugriff auf dein Benutzerkonto oder die Festplatte hat, kann die Dateien lesen. |
| **Verschlüsselung** | Daten sind ohne Schlüssel unlesbar. | Schützt nicht vor Datenverlust. |
| **Backup** | Kopie zur Wiederherstellung. | Ein Backup auf einem USB-Stick ist so (un)geschützt wie der Stick. |
| **Betriebssystemschutz** | Benutzerkonto mit Passwort, FileVault (macOS) bzw. BitLocker/Geräteverschlüsselung (Windows). | Schützt nicht, solange du angemeldet bist. |

## 2. Aktueller Stand der Verschlüsselung (ehrlich)

- Die Datenbank und der Dokumentenspeicher sind in Version 0.1 **nicht** von der App
  verschlüsselt.
- **Empfehlung jetzt:** FileVault (macOS: Systemeinstellungen → Datenschutz & Sicherheit →
  FileVault) bzw. BitLocker/Geräteverschlüsselung (Windows: Einstellungen → Datenschutz und
  Sicherheit → Geräteverschlüsselung) einschalten. Das verschlüsselt die ganze Festplatte
  mit etablierten, vom Betriebssystem gewarteten Verfahren und schützt bei Verlust oder
  Diebstahl des Laptops.
- **Geplant (Phase 5):**
  1. Verschlüsselte Backups mit dem etablierten Format **age** (Rust-Crate `age`),
     passwortbasiert (scrypt). Wichtig für Backups auf USB-Sticks.
  2. Prüfung von **SQLCipher** für die Datenbank (AES-256, weit verbreitet). Schlüssel im
     Schlüsselbund des Betriebssystems (macOS Keychain, Windows Credential Manager) über
     das Crate `keyring`. Nie im Klartext auf der Platte.
- Es wird **keine selbst entwickelte Kryptografie** verwendet.

## 3. Netzwerk

**Die App führt keine Netzwerkzugriffe durch.**

| Komponente | Netzwerk? | Absicherung |
|---|---|---|
| Rust-Kern | nein | keine HTTP-Bibliothek als Abhängigkeit |
| Oberfläche | nein | Content-Security-Policy erlaubt nur eigene Ressourcen (`default-src 'self'`, `connect-src` nur IPC) |
| Tauri-Plugins | nein | nur `dialog` und `opener`; kein `http`, `updater`, `shell` |
| Schriften, PDF-Worker | nein | lokal im App-Paket, kein CDN |
| Telemetrie, Fehlerberichte, Werbung | nein | nicht vorhanden |
| Externe KI | nein | nicht vorhanden. Wird sie später ergänzt, dann nur optional, abgeschaltet als Standard und mit ausdrücklicher Zustimmung pro Vorgang |

Ausnahme, auf die du keinen Einfluss hast: Das Betriebssystem selbst (z. B. Gatekeeper
auf macOS, SmartScreen auf Windows) prüft beim ersten Start unter Umständen die Signatur
der App online. Das betrifft die App-Datei, nicht deine Inhalte.

Externe Links in Notizen öffnen sich im Standardbrowser, nie innerhalb der App.

## 4. Tauri-Sicherheitskonfiguration

- **Capabilities** (`src-tauri/capabilities/default.json`): nur die Rechte, die die
  Oberfläche braucht (Fensterzugriff, Dateiauswahldialog, Öffnen mit Standardprogramm).
  Kein freier Dateisystemzugriff aus JavaScript.
- **CSP** ist streng gesetzt, `unsafe-eval` ist nicht erlaubt. `unsafe-inline` nur für
  Styles (vom Editor benötigt).
- **Eigene Befehle** sind die einzige Schnittstelle zu Daten. Sie prüfen alle Argumente
  (IDs, Längen, Dateiendungen).
- **Keine Fernzugriffe:** Die App lädt keine Webseiten. `withGlobalTauri` ist aus.
- **`freezePrototype` ist aus.** Die Option friert `Object.prototype` ein (Schutz gegen
  „Prototype Pollution“). Sie ist mit dem Word-Importer *mammoth* (über dessen Abhängigkeit
  underscore.js) nicht vereinbar: Die App startete damit nicht. Das fiel im End-to-End-Test der
  echten App auf. Da die Oberfläche ausschließlich eigenen, gebündelten Code ausführt (CSP ohne
  `unsafe-eval`, keine fremden Skripte), ist das Restrisiko gering. Prüfauftrag für Phase 5:
  Word-Import ersetzen oder isolieren (z. B. in einem Web Worker) und die Option wieder einschalten.

## 5. Dateien und Pfade

- Importierte Dateien werden nie ausgeführt. DOCX wird nur gelesen (Text/Formatierung),
  Makros werden ignoriert. PDFs werden mit pdf.js ohne JavaScript-Ausführung dargestellt
  (`isEvalSupported: false`, keine PDF-Skripte).
- Dateien im Speicher heißen nach ihrem Hash. Benutzerdateinamen werden nie zu Pfaden.
- Exportnamen werden bereinigt (keine `/ \ : * ? " < > |`, keine reservierten
  Windows-Namen wie `CON`, keine führenden Punkte).
- Beim Import werden nur reguläre Dateien bis 500 MB mit erlaubter Endung angenommen.
  Symbolische Links werden aufgelöst und als normale Datei behandelt.
- Backups werden vor dem Entpacken geprüft. ZIP-Einträge mit `..`, absoluten Pfaden oder
  unbekannten Namen werden abgelehnt (Schutz gegen „Zip Slip“).

## 6. Datenintegrität

- SQLite mit `journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON`.
- Mehrteilige Schreibvorgänge in Transaktionen.
- Vor jeder Datenbankmigration automatischer Schnappschuss in `pre-migration/`.
- Löschen geht immer zuerst in den Papierkorb.
- Versionshistorie für Notizen.

## 7. Protokollierung

Das Protokoll (`logs/`) enthält Zeitpunkt, Vorgang und Fehlermeldung. Es enthält **keine**
Notizinhalte, keine Dokumenttexte und keine Titel. Es bleibt lokal.

## 8. Abhängigkeiten

Abhängigkeiten werden bewusst klein gehalten und nur aus gepflegten Projekten gewählt.
Prüfung mit `npm audit` und `cargo audit` vor jedem Release (siehe README).

## 9. Bekannte Sicherheitsgrenzen

- Schadsoftware unter deinem Benutzerkonto kann die Daten lesen, solange keine
  App-Verschlüsselung aktiv ist.
- Backups sind bis Phase 5 unverschlüsselt.
- Die App wird für Release-Builds signiert werden müssen (Apple Developer ID bzw.
  Windows-Codesignatur). Ohne Signatur warnen macOS und Windows beim Start.
