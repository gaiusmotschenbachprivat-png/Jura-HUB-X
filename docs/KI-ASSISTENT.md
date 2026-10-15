# KI-Assistent (Claude) – juristische Recherche, Vertragsprüfung, Schriftsätze

Der KI-Assistent ist ein **ausdrücklich einzuschaltendes Zusatzmodul** von Studium OS. Er nutzt
Claude (Anthropic) über das offizielle TypeScript-SDK `@anthropic-ai/sdk` und arbeitet mit deinen
eigenen Rechtsquellen: Gesetze, Urteile, Kommentare und eigene Texte, die du importierst.

> Ausgaben können fehlerhaft sein. Sie ersetzen keine anwaltliche Prüfung im Einzelfall.

## Inhalt

1. [Einrichtung](#1-einrichtung)
2. [Bedienung](#2-bedienung)
3. [Wie es funktioniert](#3-wie-es-funktioniert)
4. [Neue Rechtsquellen hinzufügen](#4-neue-rechtsquellen-hinzufügen)
5. [System-Prompt und Aufgaben anpassen](#5-system-prompt-und-aufgaben-anpassen)
6. [Werkzeuge erweitern](#6-werkzeuge-erweitern)
7. [Evaluation](#7-evaluation)
8. [Datenschutz, DSGVO und Verschwiegenheit](#8-datenschutz-dsgvo-und-verschwiegenheit)
9. [Grenzen](#9-grenzen)

## 1. Einrichtung

### API-Schlüssel

Du brauchst einen eigenen API-Schlüssel von Anthropic (console.anthropic.com). Die Nutzung wird
über dein Anthropic-Konto abgerechnet.

**Desktop-App (macOS/Windows):** Der Schlüssel kommt **nur** aus der Umgebungsvariable
`ANTHROPIC_API_KEY`. Er steht nie im Code, wird nie gespeichert und nie an die Oberfläche
gegeben – die Rust-Seite setzt ihn erst beim Weiterleiten an die Claude API ein.

- macOS: `launchctl setenv ANTHROPIC_API_KEY sk-ant-…`, danach Studium OS neu starten
  (gilt bis zum nächsten Neustart des Macs; dauerhaft z. B. über ein Startobjekt).
- Windows: Einstellungen → „Umgebungsvariablen für dieses Konto bearbeiten“ → Neu:
  `ANTHROPIC_API_KEY`. Danach Studium OS neu starten.

**iPad/Browser:** Den Schlüssel gibst du im Assistenten ein. Zwei Möglichkeiten:

- **Mit PIN merken** (Standard): Der Schlüssel wird mit einer PIN (mind. 6 Zeichen)
  verschlüsselt auf dem iPad gespeichert – Web Crypto API, PBKDF2-SHA-256 mit 600 000 Runden
  und AES-256-GCM, keine eigene Kryptografie. Gespeichert werden nur Salz, IV und Chiffrat.
  Nach jedem Start entsperrst du ihn mit der PIN. PIN vergessen → „Anderen Schlüssel verwenden“.
  Grenze: Wer an die Daten des iPads kommt, kann kurze PINs durch Ausprobieren erraten –
  nimm eine längere PIN.
- **Nur für diese Sitzung** (Häkchen „Auf diesem iPad merken“ entfernen): Der Schlüssel bleibt
  nur im Arbeitsspeicher und ist nach dem Schließen weg.

(Im Browser lässt sich technisch nicht verhindern, dass die Seite den entsperrten Schlüssel
während der Sitzung im Speicher hält.)

### Zustimmung

Beim ersten Öffnen erklärt der Assistent, was an Anthropic geht, und wird erst nach deiner
Zustimmung aktiv. Abschalten: **KI-Assistent → Einstellungen → KI-Assistent ausschalten**.

### Rechtsquellen

Ohne Quellen kann der Assistent nichts belegen. Unter **KI-Assistent → Rechtsquellen**:

- **Desktop:** Gesetze auf Knopfdruck von gesetze-im-internet.de laden (BGB, StGB, GG, KSchG …
  oder jede andere Abkürzung aus der Adresse, z. B. `bauno_by`).
- **iPad/Browser:** gesetze-im-internet.de erlaubt Browsern keinen direkten Abruf. Lade beim
  Gesetz die „XML“-Datei herunter und importiere sie als Datei.
- **Urteile, Kommentare, eigene Texte** als PDF, DOCX, TXT oder MD mit Angaben wie Gericht,
  Aktenzeichen, Datum, Fassung.

## 2. Bedienung

**Von jeder Seite:** Unten rechts ist immer ein kleines ✦-Symbol (oder ⌘/Strg + J). Es öffnet den
Assistenten als Seitenleiste, ohne die aktuelle Seite zu verlassen. Ist gerade eine Notiz oder
ein PDF offen, kannst du **„Aktuelle Notiz/Aktuelles Dokument einbeziehen“** ankreuzen – der Text
wird dann (anonymisiert) mitgeschickt. Das Symbol oben in der Leiste öffnet die Vollansicht mit
Rechtsquellen und Einstellungen.

1. Aufgabe wählen: **Recherche & Fall**, **Vertrag prüfen** (Vertragstext einfügen oder als
   Datei laden) oder **Schriftsatz entwerfen**.
2. Optional **„Eigene Notizen durchsuchen“**: Claude darf dann deine Notizen und Dokumente
   durchsuchen; Auszüge werden vor dem Senden anonymisiert.
3. Frage senden (⌘/Strg + Enter). Die Antwort enthält Quellenkennungen wie **[Q3]** – ein Klick
   zeigt den Wortlaut und die Fassung der Quelle.
4. Unter der Antwort steht das Ergebnis der **Zitatprüfung**. Nicht belegte Zitate sind gelb
   markiert, mit Begründung.
5. **„An Anthropic gesendet“** zeigt genau den (anonymisierten) Text, der übertragen wurde.
6. **„Als Notiz speichern“** legt die Antwort als Notiz an (als „ungeprüft“ gekennzeichnet).
   Unterhaltungen selbst werden nicht gespeichert.

### KI-Lernhilfen in jeder Notiz

Das Hut-Symbol neben dem Notiztitel („KI-Lernhilfen“) bietet:

- **Mitschrift aufbereiten:** Claude ordnet die Mitschrift zu einem Lernskript (Gliederung,
  Kernaussagen, Definitionen, Prüfungsschemata, Lücken, Wiederholungsfragen). Wahlweise als
  neue Zusammenfassung speichern oder unter der Mitschrift einfügen – das Original bleibt.
- **Karteikarten vorschlagen:** 6–15 Vorschläge (Definition, Frage, Norm); du wählst aus,
  welche angelegt werden. Sie tragen das Schlagwort „KI-Vorschlag“ und verweisen auf die Notiz.
- **Übungsfall erstellen:** Sachverhalt und Fallfrage zum Stoff, in drei Schwierigkeitsstufen,
  als neue Fall-Notiz. Die Lösungsskizze wird verdeckt gespeichert.
- **Lösung besprechen** (in einem Übungsfall): Rückmeldung zu Aufbau, erkannten Problemen und
  Gutachtenstil, ohne Note; die Lösungsskizze lässt sich danach aufdecken.

Die Prompts liegen in `prompts/lernen/` und lassen sich wie die übrigen anpassen. Auch hier
wird vor dem Senden anonymisiert, „An Anthropic gesendet“ zeigt den genauen Text, und alle
Ergebnisse sind als ungeprüft gekennzeichnet.

## 3. Wie es funktioniert

```
Frage
 └─► Anonymisierung (Platzhalter [PERSON_1] …)
 └─► Abruf: genannte Normen vollständig + Volltextsuche (BM25)  → Quellen [Q1] … [Qn]
 └─► Claude Opus 5.5 (adaptives Denken, effort „high“) mit Werkzeugen:
        norm_abrufen · quellen_suchen · frist_berechnen · vorlage_laden · (dokumente_suchen)
 └─► Zitatprüfung: jedes §/Art./Aktenzeichen gegen die abgerufenen Quellen
        └─ nicht belegt? → eine automatische Überarbeitungsrunde
 └─► Platzhalter zurück in Originalangaben → Anzeige mit Prüfbericht
```

| Teil | Datei |
|---|---|
| System-Prompt | `prompts/system.md` |
| Aufgabenprofile | `prompts/aufgaben/{recherche,vertrag,schriftsatz}.md` |
| Muster-Vorlagen | `prompts/vorlagen/*.md` |
| Ablauf | `src/ai/assistant.ts` |
| Claude-Zugang (SDK, Desktop-Weiterleitung) | `src/ai/client.ts`, `src-tauri/src/commands/ai.rs` |
| Abruf / Suche | `src/ai/retrieval.ts`, `src/core/repo/legal.ts`, `crates/studium-core/src/repo/legal.rs` |
| Import | `src/ai/sources/{gii,text,importer}.ts` |
| Zitaterkennung und -prüfung | `src/ai/norms.ts`, `src/ai/verify.ts` |
| Werkzeuge | `src/ai/tools/` |
| Anonymisierung | `src/ai/privacy/anonymize.ts` |
| Einstellungen (Modell, Runden) | `src/ai/config.ts` |
| Datenbank | `crates/studium-core/src/db/migrations/0003_rechtsquellen.sql` |

**Zerlegung (Chunking):** Gesetze je Absatz einer Norm (`§ 433`, Abs. 1, 2 …) mit Überschrift,
Gliederung und Stand der Fassung. Urteile und Texte je Absatz bzw. Randnummer, höchstens etwa
1 500 Zeichen pro Abschnitt.

**Ausweichmodell:** Lehnt ein Sicherheitsfilter eine Anfrage ab, beantwortet Anthropics
empfohlenes Ausweichmodell sie serverseitig (`fallbacks: "default"`). Das Modell steht unter
der Antwort.

## 4. Neue Rechtsquellen hinzufügen

- **Gesetz (Desktop):** Abkürzung aus der Adresse von gesetze-im-internet.de eingeben, z. B.
  `https://www.gesetze-im-internet.de/bdsg_2018/` → `bdsg_2018`. Eine neue Fassung ersetzt die
  alte automatisch.
- **Gesetz (iPad):** dort „XML“ herunterladen → **Datei importieren**, Art „Gesetz“.
- **Landesrecht** (z. B. BayVwVfG) steht nicht bei gesetze-im-internet.de: als PDF/TXT mit Art
  „Dokument“ importieren. Die Zitatprüfung kann solche Normen dann über den Text belegen, aber
  nicht als Gesetz erkennen.
- **Urteile:** PDF/DOCX/TXT, Art „Urteil“, dazu Gericht, Aktenzeichen und Datum eintragen – das
  Aktenzeichen nutzt die Zitatprüfung.
- **Eigene Importwege** (z. B. eine Urteilsdatenbank): eine Funktion schreiben, die
  `NewLegalSource` und `NewLegalChunk[]` erzeugt (Beispiel: `src/ai/sources/gii.ts`), und
  `api.legalSourceSave(source, chunks)` aufrufen.
- **Semantische Suche:** `Retriever` in `src/ai/retrieval.ts` ist austauschbar; eine
  Implementierung mit einem lokalen Embedding-Modell kann `LegalRetriever` ersetzen oder ergänzen.

## 5. System-Prompt und Aufgaben anpassen

- **Ohne Programmieren:** KI-Assistent → Einstellungen → System-Prompt. Gilt ab der nächsten
  Unterhaltung; „Auf Standard zurücksetzen“ stellt `prompts/system.md` wieder her.
- **Im Projekt:** `prompts/system.md` bzw. `prompts/aufgaben/*.md` bearbeiten und neu bauen.
- **Vorlagen:** neue Datei `prompts/vorlagen/<name>.md` mit Kopfdaten:
  ```
  ---
  titel: Kündigung eines Mietvertrags
  rechtsgebiet: Zivilrecht
  normen: § 568 BGB, § 573c BGB
  ---
  Text mit [[Platzhaltern]] …
  ```
- Nach jeder Änderung die Evaluation laufen lassen und mit dem vorigen Lauf vergleichen (§ 7).

Tipp: Stabile Teile (System-Prompt, Aufgabe, Werkzeuge) werden zwischengespeichert
(Prompt-Caching). Keine wechselnden Angaben wie Datum oder Uhrzeit in den System-Prompt schreiben.

## 6. Werkzeuge erweitern

Ein Werkzeug ist ein Objekt `{ definition, run }` in `src/ai/tools/`:

```ts
export const meinWerkzeug: AssistantTool = {
  definition: {
    name: "mein_werkzeug",
    description: "Was es tut und wann Claude es nutzen soll.",
    strict: true,
    input_schema: { type: "object", properties: { … }, required: [ … ], additionalProperties: false },
  },
  async run(input, ctx) {
    return { content: "Ergebnis als Text" };
  },
};
```

In `toolsFor()` (`src/ai/tools/index.ts`) aufnehmen. Ergebnisse, die Rechtsquellen liefern,
mit `ctx.registry.register(hits)` registrieren – dann bekommen sie [Qn]-Kennungen und zählen für
die Zitatprüfung. Ergebnisse aus Nutzerinhalten vor dem Zurückgeben mit `ctx.anonymizer` anonymisieren.

Platzhalter/Erweiterungspunkte: Anbindung einer Rechtsprechungsdatenbank (als Werkzeug oder
Import), Vorlagenverwaltung in der Oberfläche.

## 7. Evaluation

`eval/fragen.yaml` enthält 32 Testfragen (Zivil-, Arbeits-, öffentliches und Strafrecht,
Vertragsprüfung, Schriftsatz, zwei „Fallen“ mit erfundener Norm bzw. erfundenem Urteil) mit
erwarteten Normen, Stichworten und Werkzeugen. Die erwarteten Antworten geben verbreitetes
Lehrbuchwissen wieder – bitte fachlich prüfen und anpassen.

```bash
ANTHROPIC_API_KEY=sk-ant-… npm run eval                 # alle Fragen
EVAL_LABEL=prompt-v2 npm run eval                       # Lauf benennen
EVAL_FILTER='^ar-' npm run eval                         # nur Arbeitsrecht
npm run eval:vergleich                                  # die zwei neuesten Läufe vergleichen
```

Auf GitHub unter **Actions → KI-Evaluation → Run workflow** (vorher unter Settings → Secrets and
variables → Actions das Secret `ANTHROPIC_API_KEY` anlegen) – siehe aber den Hinweis zu
gesetze-im-internet.de unten. Die Ergebnisse liegen als Artefakt am Lauf.

Kennzahlen je Frage und gesamt:

| Kennzahl | Bedeutung |
|---|---|
| bestanden | alle erwarteten Normen zitiert, keine falschen Zitate, keine Halluzinationen, ≥ 50 % Stichworte, erwartete Werkzeuge genutzt |
| Norm-Trefferquote | Anteil der erwarteten Normen, die zitiert wurden |
| falsche Zitate | existierende Normen, die nicht durch abgerufene Quellen belegt sind |
| Halluzinationen | Normen/Absätze, die es im importierten Gesetz nicht gibt, unbelegte Aktenzeichen, erfundene [Qn] |
| Kosten | Schätzung nach Listenpreis Claude Opus 5.5 |

Jeder Lauf kostet echte API-Nutzung (die Schätzung steht im Ergebnis).

**Import echter Gesetze prüfen** (ohne API-Schlüssel): `npm run test:gesetze` lädt BGB, GG, StGB und
KSchG und prüft u. a. Absätze von § 433 BGB, Art. 1 GG, § 242 StGB, § 4 KSchG und die Zitatprüfung
(erfundener Absatz, erfundene Norm). gesetze-im-internet.de sperrt Rechenzentren wie GitHub Actions –
deshalb läuft dieser Test nur auf dem eigenen Rechner. Gleiches gilt für die Evaluation auf GitHub:
dort vorher die Gesetze als Dateien in `eval/.cache/<abk>.zip` bereitstellen oder lokal auswerten.

## 8. Datenschutz, DSGVO und Verschwiegenheit

- **Was übertragen wird:** nur beim Absenden einer Frage – die (anonymisierte) Frage, ggf. der
  (anonymisierte) Vertragstext, die gefundenen Abschnitte deiner Rechtsquellen, Werkzeugergebnisse
  und – nur wenn freigegeben – anonymisierte Auszüge aus deinen Notizen. Empfänger ist Anthropic
  (USA). Alles andere bleibt lokal. Was genau gesendet wurde, zeigt „An Anthropic gesendet“.
- **Anonymisierung:** konfigurierbar (Namen nach Anrede/Titel, E-Mail, Telefon, IBAN, Adressen,
  Geburtsdaten, eigene Aktenzeichen, eigene Begriffe). Sie arbeitet mit Mustern und ist **nicht
  lückenlos** – Namen von Beteiligten unter „Eigene Begriffe“ eintragen. Gerichtsaktenzeichen,
  Normen, Daten und Fallbuchstaben bleiben bewusst erhalten.
- **Protokolle:** Studium OS protokolliert vom Assistenten nur Methode, Pfad, Statuscode und Dauer
  – nie Inhalte, nie den Schlüssel. Unterhaltungen werden nicht gespeichert.
- **DSGVO:** Werden personenbezogene Daten Dritter verarbeitet, brauchst du eine Rechtsgrundlage
  (Art. 6 DSGVO), musst Informationspflichten beachten und bei Übermittlung in die USA die
  Voraussetzungen der Art. 44 ff. DSGVO (z. B. Angemessenheitsbeschluss/Data Privacy Framework,
  Standardvertragsklauseln) prüfen. Für berufliche Nutzung ist ein Auftragsverarbeitungsvertrag
  mit Anthropic (Art. 28 DSGVO) nötig; prüfe die aktuellen Bedingungen von Anthropic
  (Datennutzung, Aufbewahrung).
- **Berufsgeheimnis:** Für Rechtsanwälte gelten § 43a Abs. 2 BRAO, § 2 BORA und § 203 StGB. Die
  Einbeziehung externer Dienstleister ist nur unter den Voraussetzungen des § 43e BRAO
  (Verpflichtung zur Verschwiegenheit, sorgfältige Auswahl) zulässig. **Keine Mandantendaten im
  Klartext eingeben**; im Zweifel nur abstrahierte Sachverhalte verwenden.
- **Studium:** Für eigene Lernfragen und Übungsfälle ohne echte Personen gibt es diese Probleme
  in der Regel nicht. Prüfungsordnungen zu erlaubten Hilfsmitteln beachten.

Diese Hinweise sind eine Orientierung und keine Rechtsberatung.

## 9. Grenzen

- Die Zitatprüfung prüft, **ob** ein Zitat durch eine abgerufene Quelle gedeckt ist – nicht, ob die
  rechtliche Aussage dazu richtig ist.
- Der Stand der Gesetze ist der Stand beim Import (unter „Fassung“ sichtbar). Studium OS prüft
  nicht, ob seitdem Änderungen in Kraft getreten sind.
- Gescannte PDFs ohne Texterkennung können nicht importiert werden.
- Antworten werden ohne Streaming abgerufen (bis zu 16 000 Ausgabetokens); lange Prüfungen können
  eine Minute und länger dauern.
- Nicht auf macOS/Windows/iPad mit echtem API-Schlüssel getestet (siehe Phasenbericht).
