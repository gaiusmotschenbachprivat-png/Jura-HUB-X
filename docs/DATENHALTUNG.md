# Datenhaltung

Dieses Dokument beantwortet: **Welche Daten liegen wo, in welchem Format, und wie
kommen sie wieder heraus?**

## 1. Speicherorte

Alle Daten liegen in **einem** Datenordner auf deinem Rechner:

| Betriebssystem | Datenordner |
|---|---|
| macOS | `~/Library/Application Support/de.studium-os.app/` |
| Windows | `%APPDATA%\de.studium-os.app\` (z. B. `C:\Users\<Name>\AppData\Roaming\de.studium-os.app\`) |
| Linux (Entwicklung) | `~/.local/share/de.studium-os.app/` |

Der genaue Pfad wird in der App unter **Einstellungen → Daten & Backups** angezeigt.

Inhalt des Datenordners:

```
de.studium-os.app/
├── studium.sqlite          Datenbank: Struktur, Notizen, Versionen, Verknüpfungen, Suchindex
├── studium.sqlite-wal      SQLite-Schreibprotokoll (gehört zur Datenbank, nie einzeln löschen)
├── studium.sqlite-shm      SQLite-Hilfsdatei
├── files/                  Dokumentenspeicher (Originaldateien, unverändert)
│   └── 3f/3fa9…e1          Datei, benannt nach ihrem SHA-256-Hash
├── tmp/                    Zwischendateien während Import/Backup (wird beim Start geleert)
├── pre-migration/          automatische Sicherungen vor Datenbank-Updates
├── backups/                Standardziel für Backups (frei änderbar)
└── logs/                   Fehlerprotokoll (keine Notizinhalte)
```

Backups landen in dem Ordner, den du wählst – auch auf einem USB-Stick oder einer
externen Festplatte. Eine optionale **zweite Kopie** geht in einen weiteren Ordner deiner
Wahl. Die App wählt nie selbst einen Cloud-Ordner.

## 2. Dokumentenspeicher

- Importierte Dateien werden **kopiert**, nicht verschoben. Dein Original bleibt, wo es war.
- Die Kopie wird nach ihrem **SHA-256-Hash** benannt. Dieselbe Datei zweimal importiert
  belegt nur einmal Speicher (Deduplikation).
- Ein Dokument kann **mehreren** Vorlesungen/Themen zugeordnet sein, ohne Kopie
  (Tabelle `placements`).
- Dateien im Speicher werden nie verändert. Markierungen und Kommentare (Phase 3) liegen
  in der Datenbank, nicht in der PDF.
- Der ursprüngliche Dateiname wird nur als Text in der Datenbank gespeichert, nie als Pfad
  verwendet. Damit sind Pfadangriffe über Dateinamen (`../../`) ausgeschlossen.

## 3. Datenbankschema

Version wird über `PRAGMA user_version` geführt. Migrationen liegen in
`crates/studium-core/src/db/migrations/` und sind **nur additiv**.

### Phase 2 (Migration 1 – umgesetzt)

| Tabelle | Zweck | Wichtige Felder |
|---|---|---|
| `areas` | Studienbereiche (Rechtswissenschaften, Recht & Wirtschaft, WiWiZ …) | `name`, `color`, `position`, `archived_at` |
| `nodes` | flexibler Strukturbaum | `area_id`, `parent_id`, `kind`, `title`, `position`, `meta` (JSON), `archived_at`, `deleted_at` |
| `notes` | Inhalt einer Notiz (1:1 zu `nodes` mit `kind='note'`) | `content_json`, `plain_text`, `template`, `word_count` |
| `note_versions` | Versionshistorie | `node_id`, `content_json`, `reason`, `created_at` |
| `blobs` | physische Dateien im Speicher | `sha256`, `size`, `mime` |
| `documents` | logisches Dokument | `blob_sha`, `title`, `original_name`, `ext`, `doc_type`, `page_count`, `text_status`, `deleted_at` |
| `document_pages` | extrahierter Text je Seite | `document_id`, `page_no`, `text` |
| `placements` | Zuordnung Dokument ↔ Strukturknoten (n:m) | `document_id`, `node_id` |
| `node_area_refs` | „auch relevant für“ anderen Studienbereich | `node_id`, `area_id` |
| `links` | interne Verknüpfungen, bidirektional abfragbar | `source_type/id`, `target_type/id`, `kind`, `anchor` (z. B. `{"page": 12}`) |
| `search_index` | FTS5-Volltextindex | `entity_type`, `entity_id`, `area_id`, `page`, `title`, `body` |
| `backups` | Backup-Metadaten | `path`, `created_at`, `size`, `sha256`, `kind`, `status` |
| `settings` | Einstellungen | `key`, `value` |

**Strukturbaum statt starrer Tabellen.** `nodes.kind` ist eines von
`semester`, `module`, `course` (Veranstaltung), `session` (Vorlesungstermin), `topic`,
`folder`, `note`. Jeder Knoten darf unter jedem anderen hängen. So geht
`Studiengang → Semester → Modul → Vorlesung → Termin → Thema → Notiz`, aber auch eine
zusätzliche Ebene oder eine Notiz direkt unter dem Semester. Veranstaltungsfelder
(Dozent, Wochentag, Uhrzeit, Ort, Beschreibung, Lernziele) liegen in `meta` als JSON, weil
nicht alle Felder für jeden Knoten sinnvoll sind.

**Mehrere Studienbereiche.** Jeder Knoten gehört genau einem Bereich (keine Vermischung).
Über `node_area_refs` erscheint er zusätzlich als Verweis in anderen Bereichen
(z. B. Gesellschaftsrecht in Jura **und** Recht & Wirtschaft), ohne Kopie.

**Umbenennen bricht keine Verknüpfungen.** Alle Verweise laufen über UUIDs, nie über
Titel.

**Löschen.** Löschen setzt `deleted_at` (Papierkorb). Endgültig gelöscht wird nur im
Papierkorb und nur nach Bestätigung. Unterknoten wandern mit in den Papierkorb und kommen
beim Wiederherstellen mit zurück.

**Herkunft importierter Inhalte.** Importierte Dokumente haben keinen „geprüft“-Status.
Ab Phase 3 erhalten Definitionen, Schemata und Fälle ein Feld `source_kind`
(`eigen`, `vorlesung`, `import`, `ki-vorschlag`), damit importierte oder generierte Inhalte
nie als geprüfte Rechtsinformation erscheinen.

### Geplant (Phase 3 und später – noch nicht in der Datenbank)

| Tabelle | Zweck |
|---|---|
| `definitions` | Begriff, Definitionstext, Rechtsgebiet, Quelle, Anmerkungen, `source_kind` |
| `schemas`, `schema_items` | hierarchische Prüfungsschemata (Baum mit Position) |
| `cases` | Fälle: Sachverhalt, Lösung (Notiz), Rechtsgebiet, Anspruchsgrundlage, Schwierigkeit |
| `citations` | strukturierte Fundstellen: Gesetz, Paragraf/Artikel, Absatz, Satz, Nr. |
| `flashcards`, `review_state`, `review_log` | Karteikarten und Wiederholungen (FSRS-Verfahren geplant) |
| `annotations`, `bookmarks` | PDF-Markierungen, Kommentare, Lesezeichen (Koordinaten, nicht in der PDF) |
| `tasks`, `exams` | Aufgaben, offene Fragen, Prüfungstermine |
| `tags`, `taggings` | Schlagwörter |

Alle verknüpfen sich über die vorhandene Tabelle `links`. Neue Tabellen kommen als neue
Migration hinzu, bestehende Daten bleiben unverändert.

## 4. Backups

Ein Backup ist eine einzelne Datei `Studium-OS-Backup-JJJJ-MM-TT_HHMMSS.studiumbackup`
(technisch ein ZIP-Archiv):

```
manifest.json      Formatversion, App-Version, Schemaversion, Zeitpunkt,
                   Liste aller Dateien mit SHA-256 und Größe
studium.sqlite     konsistenter Datenbank-Schnappschuss (VACUUM INTO)
files/…            alle Dokumente
```

- **Erstellen:** Die Datei wird zuerst als `.partial` geschrieben und erst nach
  vollständigem Schreiben und Prüfen umbenannt. Ein abgebrochenes Backup sieht man
  also nie als gültiges Backup.
- **Prüfen:** Jede Datei wird gegen ihren Hash im Manifest geprüft, die Datenbank mit
  `PRAGMA integrity_check`. Fehlt etwas oder stimmt ein Hash nicht, wird das Backup als
  beschädigt gemeldet und nicht wiederhergestellt.
- **Wiederherstellen:** Das Backup wird erst vollständig geprüft und in einen
  Zwischenordner entpackt. Dann wird der aktuelle Stand als Sicherheitskopie
  (`pre-restore-…`) beiseitegelegt und erst danach ersetzt. Es wird nie etwas
  überschrieben, ohne dass eine Kopie existiert.
- **Automatisch (optional):** einmal täglich beim Start bzw. im laufenden Betrieb,
  mit einstellbarer Anzahl aufbewahrter Backups.

## 5. Exporte

| Format | Status | Weg |
|---|---|---|
| DOCX | Phase 2 | Notiz → Word-Datei an frei gewähltem Ort |
| Markdown | Phase 2 | Notiz → `.md` |
| PDF | Phase 4 | geplant |
| Backup | Phase 2 | vollständiges Archiv, siehe oben |

Exportierte Dateien sind normale Dateien. Wenn du sie in Word bearbeitest, ändert das
nicht deine Notiz in der App. Der Rückweg ist der DOCX-Import (neue Notiz).
