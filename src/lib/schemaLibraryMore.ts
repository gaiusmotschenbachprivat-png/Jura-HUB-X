/**
 * Weitere Standardaufbauten für die Schema-Bibliothek (Teil 2). Gleiche Form
 * wie in `schemaLibrary.ts`: „(P)“ = klassisches Klausurproblem, Normen mit
 * Gesetzesangabe. Zitierte BGB-/StGB-Normen prüft `schemata.test.ts` gegen den
 * mitgelieferten Gesetzestext.
 */
import type { Lib } from "./schemaLibrary";

type Def = [gebiet: "zivil" | "straf" | "oeff", id: string, title: string, norm: string, items: Lib[], notes?: string];

const RW_SCHULD: Lib[] = ["Rechtswidrigkeit", "Schuld"];

export const MORE_SCHEMAS: Def[] = [
  // ---------------- Zivilrecht: Allgemeiner Teil ----------------
  ["zivil", "z-einwendungen", "Rechtshindernde Einwendungen (Wirksamkeitshindernisse)", "", [
    "Geschäftsunfähigkeit (§§ 104, 105 I BGB) bzw. fehlende Zustimmung bei beschränkter Geschäftsfähigkeit (§§ 107, 108 BGB)",
    "Geheimer Vorbehalt, Scheingeschäft, Scherzerklärung (§§ 116–118 BGB)",
    "Formmangel (§ 125 BGB)",
    "Verstoß gegen ein gesetzliches Verbot (§ 134 BGB)",
    ["Sittenwidrigkeit, Wucher (§ 138 BGB)", ["(P) Wucherähnliches Geschäft (§ 138 I BGB)"]],
    "Anfechtung (§ 142 I BGB) – wirkt von Anfang an",
  ]],
  ["zivil", "z-agb", "AGB-Kontrolle", "§§ 305 ff. BGB", [
    "Anwendbarkeit (§ 310 BGB)",
    "Allgemeine Geschäftsbedingungen (§ 305 I BGB)",
    ["Einbeziehung in den Vertrag (§ 305 II BGB)", ["Keine überraschende Klausel (§ 305c I BGB)", "Vorrang der Individualabrede (§ 305b BGB)"]],
    "Auslegung; Unklarheiten zulasten des Verwenders (§ 305c II BGB)",
    ["Inhaltskontrolle", ["Klauselverbote ohne Wertungsmöglichkeit (§ 309 BGB)", "Klauselverbote mit Wertungsmöglichkeit (§ 308 BGB)", "Generalklausel: unangemessene Benachteiligung (§ 307 BGB)"]],
  ], "Rechtsfolge: Vertrag bleibt im Übrigen wirksam, an die Stelle der Klausel tritt das Gesetz (§ 306 BGB)."],
  ["zivil", "z-widerruf", "Widerruf eines Verbrauchervertrags", "§§ 312g I, 355 BGB", [
    "Verbrauchervertrag: Verbraucher (§ 13 BGB) und Unternehmer (§ 14 BGB)",
    "Widerrufsrecht: außerhalb von Geschäftsräumen geschlossener Vertrag oder Fernabsatzvertrag (§ 312g I BGB); keine Ausnahme (§ 312g II BGB)",
    "Widerrufserklärung gegenüber dem Unternehmer (§ 355 I 2 BGB)",
    ["Widerrufsfrist: 14 Tage (§ 355 II BGB)", ["Fristbeginn, insbesondere nach ordnungsgemäßer Belehrung (§ 356 III BGB)"]],
  ], "Rechtsfolge: Rückgewähr der empfangenen Leistungen (§§ 355 III, 357 BGB)."],

  // ---------------- Zivilrecht: Leistungsstörungen ----------------
  ["zivil", "z-verzug", "Verzögerungsschaden (Verzug)", "§§ 280 I, II, 286 BGB", [
    "Schuldverhältnis",
    "Nichtleistung trotz Möglichkeit der Leistung",
    "Fälligkeit und Durchsetzbarkeit des Anspruchs (keine Einrede)",
    "Mahnung (§ 286 I 1 BGB) oder Entbehrlichkeit (§ 286 II BGB); bei Entgeltforderungen 30-Tage-Regel (§ 286 III BGB)",
    "Vertretenmüssen (vermutet, § 286 IV BGB)",
    "Verzögerungsschaden und Kausalität (§§ 249 ff. BGB)",
  ], "Verzugszinsen: § 288 I BGB."],
  ["zivil", "z-283", "Schadensersatz statt der Leistung bei nachträglicher Unmöglichkeit", "§§ 280 I, III, 283 BGB", [
    "Schuldverhältnis",
    "Leistungspflicht nach Vertragsschluss ausgeschlossen (§ 275 I–III BGB)",
    "Vertretenmüssen (vermutet, § 280 I 2 BGB)",
    "Schaden und Kausalität",
  ], "Bei Unmöglichkeit schon bei Vertragsschluss: § 311a II BGB."],
  ["zivil", "z-311a", "Anfängliche Unmöglichkeit", "§ 311a II BGB", [
    "Wirksamer Vertrag trotz Leistungshindernis (§ 311a I BGB)",
    "Leistungshindernis schon bei Vertragsschluss (§ 275 I–III BGB)",
    "Kenntnis oder zu vertretende Unkenntnis des Schuldners (§ 311a II 2 BGB)",
    "Schaden (Schadensersatz statt der Leistung oder Aufwendungsersatz nach § 284 BGB)",
  ]],
  ["zivil", "z-minderung", "Minderung", "§§ 437 Nr. 2, 441 BGB", [
    "Wirksamer Kaufvertrag, Sachmangel bei Gefahrübergang",
    "Voraussetzungen des Rücktritts: erfolglose Frist zur Nacherfüllung oder Entbehrlichkeit (§ 441 I 1 BGB)",
    "Auch bei unerheblichem Mangel (§ 441 I 2 BGB)",
    "Minderungserklärung (§ 441 I 1 BGB)",
  ], "Berechnung: § 441 III BGB (Verhältnis mangelfreier zu mangelhafter Wert)."],
  ["zivil", "z-sesdl-mangel", "Schadensersatz statt der Leistung wegen eines Mangels", "§§ 437 Nr. 3, 280 I, III, 281 BGB", [
    "Wirksamer Kaufvertrag",
    "Sachmangel bei Gefahrübergang (§§ 434, 446 BGB)",
    "Erfolglose Frist zur Nacherfüllung oder Entbehrlichkeit (§§ 281 II, 440 BGB)",
    ["Vertretenmüssen (vermutet, § 280 I 2 BGB)", ["(P) Bezugspunkt: Lieferung der mangelhaften Sache oder Ausbleiben der Nacherfüllung"]],
    "Schadensersatz statt der ganzen Leistung nicht bei unerheblicher Pflichtverletzung (§ 281 I 3 BGB)",
    "Schaden und Kausalität",
  ]],
  ["zivil", "z-vsd", "Vertrag mit Schutzwirkung zugunsten Dritter", "§§ 280 I, 241 II BGB", [
    "Schuldverhältnis zwischen Gläubiger und Schuldner",
    ["Einbeziehung des Dritten", ["Leistungsnähe des Dritten", "Einbeziehungsinteresse des Gläubigers (Gläubigernähe)", "Erkennbarkeit für den Schuldner", "Schutzbedürftigkeit des Dritten (kein eigener gleichwertiger Anspruch)"]],
    "Pflichtverletzung, Vertretenmüssen, Schaden des Dritten",
  ]],
  ["zivil", "z-dsl", "Drittschadensliquidation", "", [
    "Anspruch des Gläubigers (Anspruchsgrundlage), aber kein eigener Schaden",
    "Schaden bei einem Dritten, aber kein eigener Anspruch",
    ["Zufällige Schadensverlagerung", ["Fallgruppen: mittelbare Stellvertretung, obligatorische Gefahrentlastung (z. B. § 447 BGB), Obhutsfälle"]],
  ], "Rechtsfolge: Der Gläubiger macht den Schaden des Dritten geltend; der Dritte kann Abtretung verlangen (§ 285 BGB analog)."],

  // ---------------- Zivilrecht: Vertragstypen ----------------
  ["zivil", "z-werklohn", "Werklohnanspruch", "§ 631 I BGB", [
    ["Anspruch entstanden", ["Wirksamer Werkvertrag (§ 631 BGB)"]],
    ["Anspruch fällig: Abnahme (§§ 640 I, 641 I BGB)", ["(P) Abnahmefiktion (§ 640 II BGB)"]],
    "Anspruch nicht untergegangen",
    "Anspruch durchsetzbar (z. B. § 320 BGB bei Mängeln)",
  ]],
  ["zivil", "z-werkmaengel", "Mängelrechte beim Werkvertrag", "§ 634 BGB", [
    "Wirksamer Werkvertrag",
    "Sachmangel (§ 633 II BGB) oder Rechtsmangel (§ 633 III BGB)",
    "Grundsätzlich nach Abnahme (Gefahrübergang, § 644 BGB)",
    ["Rechte des Bestellers", [
      "Nacherfüllung (§§ 634 Nr. 1, 635 BGB)",
      "Selbstvornahme und Aufwendungsersatz (§§ 634 Nr. 2, 637 BGB)",
      "Rücktritt oder Minderung (§§ 634 Nr. 3, 636, 323, 326 V, 638 BGB)",
      "Schadensersatz (§§ 634 Nr. 4, 636, 280, 281, 283, 311a BGB)",
    ]],
    "Verjährung (§ 634a BGB)",
  ]],
  ["zivil", "z-mietminderung", "Mietminderung", "§ 536 I BGB", [
    "Wirksamer Mietvertrag",
    "Mangel der Mietsache, der die Tauglichkeit zum vertragsgemäßen Gebrauch aufhebt oder mindert (§ 536 I 1 BGB)",
    "Keine unerhebliche Minderung der Tauglichkeit (§ 536 I 3 BGB)",
    "Kein Ausschluss (Kenntnis des Mieters § 536b BGB; unterlassene Anzeige § 536c II BGB)",
  ], "Die Miete mindert sich kraft Gesetzes – eine Erklärung ist nicht nötig."],
  ["zivil", "z-buergschaft", "Bürgschaft", "§ 765 I BGB", [
    "Wirksamer Bürgschaftsvertrag",
    "Schriftform der Bürgschaftserklärung (§ 766 S. 1 BGB; nicht bei Kaufleuten, § 350 HGB)",
    ["Bestehen der Hauptforderung (Akzessorietät, § 767 I 1 BGB)", ["(P) Sittenwidrige Angehörigenbürgschaft (§ 138 I BGB)"]],
    "Einreden des Bürgen (§§ 768, 770, 771 BGB)",
  ]],
  ["zivil", "z-gesamtschuld", "Gesamtschuldnerausgleich", "§ 426 BGB", [
    "Gesamtschuld (§ 421 BGB): mehrere schulden dieselbe Leistung, der Gläubiger kann sie nur einmal fordern",
    "Ausgleichsanspruch (§ 426 I 1 BGB): grundsätzlich zu gleichen Anteilen",
    "Übergang der Gläubigerforderung (§ 426 II 1 BGB)",
  ]],

  // ---------------- Zivilrecht: Gesetzliche Schuldverhältnisse ----------------
  ["zivil", "z-823-2", "Verletzung eines Schutzgesetzes", "§ 823 II BGB", [
    "Schutzgesetz (Rechtsnorm, die zumindest auch den Einzelnen schützen soll)",
    "Verletzung des Schutzgesetzes",
    "Geschädigter im persönlichen und Schaden im sachlichen Schutzbereich",
    "Rechtswidrigkeit",
    "Verschulden (§ 823 II 2 BGB; ggf. Maßstab des Schutzgesetzes)",
    "Schaden und Kausalität",
  ]],
  ["zivil", "z-826", "Sittenwidrige vorsätzliche Schädigung", "§ 826 BGB", [
    "Schaden (auch reiner Vermögensschaden)",
    "Sittenwidrige Handlung",
    "Vorsatz bezüglich der Schädigung",
    "Kausalität",
  ]],
  ["zivil", "z-831", "Haftung für den Verrichtungsgehilfen", "§ 831 I BGB", [
    "Verrichtungsgehilfe (weisungsgebunden in den Organisationsbereich eingegliedert)",
    "Tatbestandsmäßige, rechtswidrige unerlaubte Handlung des Gehilfen (§§ 823 ff. BGB)",
    "In Ausführung der Verrichtung",
    "Schaden",
    "Keine Entlastung des Geschäftsherrn (§ 831 I 2 BGB)",
  ], "Anders als § 278 BGB: eigenes, vermutetes Verschulden des Geschäftsherrn."],
  ["zivil", "z-stvg7", "Halterhaftung", "§ 7 I StVG", [
    "Anspruchsgegner ist Halter",
    "Rechtsgutsverletzung (Tötung, Körper- oder Gesundheitsverletzung, Sachbeschädigung)",
    "Bei dem Betrieb eines Kraftfahrzeugs",
    "Kein Ausschluss (höhere Gewalt, § 7 II StVG)",
    "Schaden; ggf. Mitverursachung (§ 17 StVG, § 9 StVG i. V. m. § 254 BGB)",
  ]],
  ["zivil", "z-816", "Verfügung eines Nichtberechtigten", "§ 816 I 1 BGB", [
    "Verfügung über einen Gegenstand",
    "Als Nichtberechtigter",
    "Wirksam gegenüber dem Berechtigten (z. B. gutgläubiger Erwerb oder Genehmigung, § 185 II BGB)",
    "Entgeltlich (sonst § 816 I 2 BGB gegen den Erwerber)",
  ], "Rechtsfolge: Herausgabe des durch die Verfügung Erlangten. (P) Erlös oder objektiver Wert?"],

  // ---------------- Zivilrecht: Sachenrecht ----------------
  ["zivil", "z-932", "Gutgläubiger Erwerb beweglicher Sachen", "§§ 929 S. 1, 932 BGB", [
    "Einigung und Übergabe (§ 929 S. 1 BGB)",
    "Rechtsgeschäft im Sinne eines Verkehrsgeschäfts",
    "Veräußerer ist nicht Berechtigter",
    "Rechtsschein des Besitzes",
    "Guter Glaube des Erwerbers (§ 932 II BGB)",
    "Kein Abhandenkommen (§ 935 I BGB)",
  ]],
  ["zivil", "z-grundstueck", "Eigentumserwerb an Grundstücken", "§§ 873 I, 925 BGB", [
    "Einigung (Auflassung, § 925 I BGB)",
    "Eintragung im Grundbuch (§ 873 I BGB)",
    "Einigsein bei Eintragung",
    "Berechtigung des Veräußerers; sonst gutgläubiger Erwerb (§ 892 BGB)",
  ]],
  ["zivil", "z-ebv", "Schadensersatz im Eigentümer-Besitzer-Verhältnis", "§§ 989, 990 I BGB", [
    "Vindikationslage im Zeitpunkt der Schädigung (§§ 985, 986 BGB)",
    "Rechtshängigkeit (§ 989 BGB) oder Bösgläubigkeit des Besitzers (§ 990 I BGB)",
    "Verschlechterung, Untergang oder sonstige Unmöglichkeit der Herausgabe",
    "Verschulden des Besitzers",
    "Schaden",
  ], "Sperrwirkung des EBV gegenüber §§ 823 ff. BGB (§ 993 I a. E. BGB)."],
  ["zivil", "z-1004", "Beseitigung und Unterlassung", "§ 1004 I BGB", [
    "Beeinträchtigung des Eigentums (nicht durch Besitzentziehung)",
    "Anspruchsgegner ist Störer (Handlungs- oder Zustandsstörer)",
    "Keine Duldungspflicht (§ 1004 II BGB)",
    "Für Unterlassung: Wiederholungsgefahr (§ 1004 I 2 BGB)",
  ]],
  ["zivil", "z-pflichtteil", "Pflichtteilsanspruch", "§ 2303 I BGB", [
    "Pflichtteilsberechtigter: Abkömmling, Eltern oder Ehegatte des Erblassers (§ 2303 BGB)",
    "Durch Verfügung von Todes wegen von der Erbfolge ausgeschlossen",
    "Höhe: Hälfte des Wertes des gesetzlichen Erbteils (§ 2303 I 2 BGB)",
  ]],

  // ---------------- Strafrecht: Allgemeiner Teil ----------------
  ["straf", "s-einwilligung", "Rechtfertigende Einwilligung", "", [
    "Dispositionsbefugnis über das Rechtsgut (Grenze: § 228 StGB bei Körperverletzung)",
    "Einwilligungsfähigkeit",
    "Erklärung vor der Tat",
    "Keine wesentlichen Willensmängel",
    "Handeln in Kenntnis der Einwilligung",
  ], "Mutmaßliche Einwilligung, wenn eine Einwilligung nicht rechtzeitig eingeholt werden kann."],
  ["straf", "s-35", "Entschuldigender Notstand", "§ 35 I StGB", [
    "Notstandslage: gegenwärtige Gefahr für Leben, Leib oder Freiheit des Täters, eines Angehörigen oder einer nahestehenden Person",
    "Notstandshandlung: nicht anders abwendbar (Erforderlichkeit)",
    "Gefahrabwendungswille",
    "Keine Zumutbarkeit der Gefahrhinnahme (§ 35 I 2 StGB)",
  ]],
  ["straf", "s-etbi", "Erlaubnistatbestandsirrtum", "", [
    "Tatbestand des Delikts erfüllt",
    "Rechtswidrigkeit: objektiv kein Rechtfertigungsgrund",
    "Irrtum über die tatsächlichen Voraussetzungen eines anerkannten Rechtfertigungsgrundes (z. B. vermeintlicher Angriff bei § 32 StGB)",
    "Bei Unterstellung der Vorstellung des Täters wäre er gerechtfertigt",
    "(P) Rechtsfolge: Vorsatztheorie, strenge Schuldtheorie, eingeschränkte Schuldtheorie, rechtsfolgenverweisende Schuldtheorie",
    "Ggf. Fahrlässigkeitsstrafbarkeit",
  ]],
  ["straf", "s-mittelbar", "Mittelbare Täterschaft", "§ 25 I Alt. 2 StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Tatbestandsmerkmale durch das Werkzeug verwirklicht", "Defizit des Vordermanns (z. B. vorsatzlos, gerechtfertigt, schuldlos)", "Tatherrschaft des Hintermanns kraft überlegenen Wissens oder Willens", "(P) Täter hinter dem Täter (Organisationsherrschaft)"]],
      ["Subjektiver Tatbestand", ["Vorsatz, auch bezüglich der Tatherrschaft"]],
    ]],
    ...RW_SCHULD,
  ]],

  // ---------------- Strafrecht: Vermögensdelikte ----------------
  ["straf", "s-246", "Unterschlagung", "§ 246 I StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Fremde bewegliche Sache", "Zueignung: nach außen erkennbare Manifestation des Zueignungswillens", "(P) Wiederholte Zueignung"]],
      ["Subjektiver Tatbestand", ["Vorsatz", "Rechtswidrigkeit der Zueignung"]],
    ]],
    ...RW_SCHULD,
    "Qualifikation: anvertraute Sache (§ 246 II StGB)",
    "Formelle Subsidiarität (§ 246 I a. E. StGB)",
  ]],
  ["straf", "s-252", "Räuberischer Diebstahl", "§ 252 StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Vortat: vollendeter, nicht beendeter Diebstahl", "Auf frischer Tat betroffen", "Gewalt gegen eine Person oder Drohung mit gegenwärtiger Gefahr für Leib oder Leben"]],
      ["Subjektiver Tatbestand", ["Vorsatz", "Absicht, sich im Besitz des gestohlenen Gutes zu erhalten"]],
    ]],
    ...RW_SCHULD,
  ], "Bestrafung „gleich einem Räuber“ – Qualifikationen der §§ 250, 251 StGB sind anwendbar."],
  ["straf", "s-253", "Erpressung", "§ 253 I StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Nötigungsmittel: Gewalt oder Drohung mit einem empfindlichen Übel", "Nötigungserfolg: Handlung, Duldung oder Unterlassung", "(P) Vermögensverfügung erforderlich? (Abgrenzung zu § 249 StGB)", "Vermögensnachteil"]],
      ["Subjektiver Tatbestand", ["Vorsatz", "Absicht rechtswidriger und stoffgleicher Bereicherung"]],
    ]],
    ["Rechtswidrigkeit", ["Allgemeine Rechtfertigungsgründe", "Verwerflichkeit (§ 253 II StGB)"]],
    "Schuld",
  ], "Räuberische Erpressung: Gewalt gegen eine Person oder Drohung mit gegenwärtiger Gefahr für Leib oder Leben (§ 255 StGB)."],
  ["straf", "s-263a", "Computerbetrug", "§ 263a I StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Tathandlung: unrichtige Gestaltung des Programms, Verwendung unrichtiger oder unvollständiger Daten, unbefugte Verwendung von Daten oder sonst unbefugte Einwirkung auf den Ablauf", "(P) „Unbefugt“: betrugsspezifische Auslegung (z. B. fremde Bankkarte)", "Beeinflussung des Ergebnisses eines Datenverarbeitungsvorgangs", "Vermögensschaden"]],
      ["Subjektiver Tatbestand", ["Vorsatz", "Absicht rechtswidriger und stoffgleicher Bereicherung"]],
    ]],
    ...RW_SCHULD,
  ]],
  ["straf", "s-266", "Untreue", "§ 266 I StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", [
        "Missbrauchstatbestand: Befugnis, über fremdes Vermögen zu verfügen oder einen anderen zu verpflichten, und Missbrauch dieser Befugnis",
        "oder Treubruchstatbestand: Vermögensbetreuungspflicht und deren Verletzung",
        "(P) Vermögensbetreuungspflicht als Hauptpflicht von einiger Bedeutung (auch beim Missbrauchstatbestand)",
        "Vermögensnachteil",
      ]],
      ["Subjektiver Tatbestand", ["Vorsatz"]],
    ]],
    ...RW_SCHULD,
  ]],
  ["straf", "s-259", "Hehlerei", "§ 259 I StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Vortat: gegen fremdes Vermögen gerichtete rechtswidrige Tat eines anderen", "Sache, die ein anderer durch die Vortat erlangt hat", "Tathandlung: ankaufen, sich oder einem Dritten verschaffen, absetzen oder absetzen helfen", "(P) Absatzerfolg erforderlich?"]],
      ["Subjektiver Tatbestand", ["Vorsatz", "Absicht, sich oder einen Dritten zu bereichern"]],
    ]],
    ...RW_SCHULD,
  ]],
  ["straf", "s-303", "Sachbeschädigung", "§ 303 I StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Fremde Sache", "Beschädigen oder Zerstören", "(P) Bloße Gebrauchsbeeinträchtigung; Veränderung des Erscheinungsbildes (§ 303 II StGB)"]],
      ["Subjektiver Tatbestand", ["Vorsatz"]],
    ]],
    ...RW_SCHULD,
    "Strafantrag (§ 303c StGB)",
  ]],

  // ---------------- Strafrecht: Nichtvermögensdelikte ----------------
  ["straf", "s-240", "Nötigung", "§ 240 I StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Nötigungsmittel: Gewalt oder Drohung mit einem empfindlichen Übel", "(P) Gewaltbegriff (z. B. Sitzblockade, Zweite-Reihe-Rechtsprechung)", "Nötigungserfolg: Handlung, Duldung oder Unterlassung"]],
      ["Subjektiver Tatbestand", ["Vorsatz"]],
    ]],
    ["Rechtswidrigkeit", ["Allgemeine Rechtfertigungsgründe", "Verwerflichkeit (§ 240 II StGB)"]],
    "Schuld",
  ]],
  ["straf", "s-239", "Freiheitsberaubung", "§ 239 I StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Einsperren oder auf andere Weise der Freiheit berauben", "(P) Potentielle oder aktuelle Fortbewegungsfreiheit"]],
      ["Subjektiver Tatbestand", ["Vorsatz"]],
    ]],
    ...RW_SCHULD,
  ]],
  ["straf", "s-227", "Körperverletzung mit Todesfolge", "§ 227 I StGB", [
    ["Tatbestand", [
      "Grunddelikt: vorsätzliche Körperverletzung (§§ 223–226a StGB)",
      "Schwere Folge: Tod des Verletzten",
      "Kausalität und objektive Zurechnung",
      "(P) Tatbestandsspezifischer Gefahrzusammenhang (Letalitäts- oder Handlungslehre)",
      "Wenigstens Fahrlässigkeit bezüglich der Todesfolge (§ 18 StGB)",
    ]],
    ...RW_SCHULD,
  ]],
  ["straf", "s-222", "Fahrlässige Tötung", "§ 222 StGB", [
    ["Tatbestand", ["Tod eines Menschen, Handlung, Kausalität", "Objektive Sorgfaltspflichtverletzung bei objektiver Vorhersehbarkeit", "Objektive Zurechnung (Pflichtwidrigkeitszusammenhang, Schutzzweck der Norm)"]],
    "Rechtswidrigkeit",
    ["Schuld", ["Subjektive Sorgfaltspflichtverletzung und Vorhersehbarkeit"]],
  ]],
  ["straf", "s-323c", "Unterlassene Hilfeleistung", "§ 323c I StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Unglücksfall, gemeine Gefahr oder Not", "Unterlassen der Hilfe", "Erforderlichkeit der Hilfe", "Zumutbarkeit (keine erhebliche eigene Gefahr, keine Verletzung anderer wichtiger Pflichten)"]],
      ["Subjektiver Tatbestand", ["Vorsatz"]],
    ]],
    ...RW_SCHULD,
  ]],
  ["straf", "s-123", "Hausfriedensbruch", "§ 123 I StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Geschütztes Objekt: Wohnung, Geschäftsräume, befriedetes Besitztum, abgeschlossene Räume zum öffentlichen Dienst oder Verkehr", "Eindringen (gegen oder ohne den Willen des Berechtigten) oder Verweilen trotz Aufforderung", "(P) Generelle Zutrittserlaubnis bei Geschäftsräumen"]],
      ["Subjektiver Tatbestand", ["Vorsatz"]],
    ]],
    ...RW_SCHULD,
    "Strafantrag (§ 123 II StGB)",
  ]],
  ["straf", "s-267", "Urkundenfälschung", "§ 267 I StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Urkunde: verkörperte Gedankenerklärung, zum Beweis geeignet und bestimmt, Aussteller erkennbar", "(P) Fotokopie, Telefax, zusammengesetzte Urkunde", "Herstellen einer unechten, Verfälschen einer echten oder Gebrauchen einer unechten bzw. verfälschten Urkunde"]],
      ["Subjektiver Tatbestand", ["Vorsatz", "Zur Täuschung im Rechtsverkehr"]],
    ]],
    ...RW_SCHULD,
  ]],
  ["straf", "s-306", "Brandstiftung", "§ 306 I StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Fremdes Tatobjekt (§ 306 I Nr. 1–6 StGB)", "In Brand setzen oder durch Brandlegung ganz oder teilweise zerstören"]],
      ["Subjektiver Tatbestand", ["Vorsatz"]],
    ]],
    ...RW_SCHULD,
  ], "Schwere Brandstiftung bei Wohngebäuden u. a. auch an eigenen Sachen: § 306a I StGB."],
  ["straf", "s-315c", "Gefährdung des Straßenverkehrs", "§ 315c I StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Führen eines Fahrzeugs im Straßenverkehr", "Fahruntüchtigkeit (§ 315c I Nr. 1 StGB) oder grob verkehrswidriges und rücksichtsloses Verhalten (§ 315c I Nr. 2 StGB)", "Konkrete Gefahr für Leib oder Leben eines anderen oder fremde Sachen von bedeutendem Wert", "(P) Mitfahrer und vom Täter geführtes Fahrzeug als gefährdete Objekte"]],
      ["Subjektiver Tatbestand", ["Vorsatz; sonst Vorsatz-Fahrlässigkeits-Kombination bzw. Fahrlässigkeit (§ 315c III StGB)"]],
    ]],
    ...RW_SCHULD,
  ], "Ohne konkrete Gefahr: Trunkenheit im Verkehr (§ 316 StGB)."],
  ["straf", "s-142", "Unerlaubtes Entfernen vom Unfallort", "§ 142 I StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Unfall im Straßenverkehr", "Täter ist Unfallbeteiligter", "Sich entfernen vom Unfallort", "Vor Ermöglichung der Feststellungen (Nr. 1) bzw. ohne angemessene Wartezeit (Nr. 2)"]],
      ["Subjektiver Tatbestand", ["Vorsatz"]],
    ]],
    ...RW_SCHULD,
  ]],
  ["straf", "s-258", "Strafvereitelung", "§ 258 I StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Rechtswidrige Vortat eines anderen", "Vereitelung der Bestrafung ganz oder zum Teil"]],
      ["Subjektiver Tatbestand", ["Absichtlich oder wissentlich"]],
    ]],
    ...RW_SCHULD,
    "Persönlicher Strafausschließungsgrund: Selbstbegünstigung (§ 258 V StGB), Angehörigenprivileg (§ 258 VI StGB)",
  ]],

  // ---------------- Öffentliches Recht: Grundrechte ----------------
  ["oeff", "o-art12", "Berufsfreiheit", "Art. 12 I GG", [
    ["Schutzbereich", ["Persönlich: Deutsche (Art. 12 I 1 GG)", "Sachlich: Beruf – auf Dauer angelegte Tätigkeit zur Schaffung und Erhaltung einer Lebensgrundlage; Berufswahl und Berufsausübung"]],
    ["Eingriff", ["Unmittelbar oder mit objektiv berufsregelnder Tendenz"]],
    ["Verfassungsrechtliche Rechtfertigung", [
      "Einheitlicher Regelungsvorbehalt (Art. 12 I 2 GG)",
      ["Verhältnismäßigkeit nach der Drei-Stufen-Theorie", ["Berufsausübungsregelung: vernünftige Gemeinwohlerwägungen", "Subjektive Berufswahlregelung: Schutz wichtiger Gemeinschaftsgüter", "Objektive Berufswahlregelung: Abwehr nachweisbarer oder höchstwahrscheinlicher schwerer Gefahren für ein überragend wichtiges Gemeinschaftsgut"]],
    ]],
  ]],
  ["oeff", "o-art5", "Meinungsfreiheit", "Art. 5 I 1 GG", [
    ["Schutzbereich", ["Meinung: Werturteile; Tatsachenbehauptungen, soweit sie Voraussetzung der Meinungsbildung sind", "(P) Bewusst oder erwiesen unwahre Tatsachenbehauptungen sind nicht geschützt"]],
    "Eingriff",
    ["Verfassungsrechtliche Rechtfertigung", [
      "Schranken des Art. 5 II GG: allgemeine Gesetze, Jugendschutz, Recht der persönlichen Ehre",
      "Allgemeines Gesetz: nicht gegen eine bestimmte Meinung als solche gerichtet",
      "Wechselwirkungslehre: das beschränkende Gesetz ist im Licht der Meinungsfreiheit auszulegen",
      "Verhältnismäßigkeit",
    ]],
  ]],
  ["oeff", "o-art8", "Versammlungsfreiheit", "Art. 8 I GG", [
    ["Schutzbereich", ["Persönlich: Deutsche", "Sachlich: Versammlung – örtliche Zusammenkunft mehrerer Personen zur gemeinschaftlichen Meinungsbildung und -kundgabe", "Friedlich und ohne Waffen"]],
    "Eingriff (z. B. Auflage, Auflösung, Verbot)",
    ["Verfassungsrechtliche Rechtfertigung", ["Versammlungen unter freiem Himmel: Gesetzesvorbehalt (Art. 8 II GG)", "Versammlungen in geschlossenen Räumen: nur verfassungsimmanente Schranken", "Verhältnismäßigkeit"]],
  ]],
  ["oeff", "o-art14", "Eigentumsgarantie", "Art. 14 GG", [
    ["Schutzbereich", ["Eigentum: alle vermögenswerten Rechte, die dem Einzelnen privatnützig zugeordnet sind", "(P) Recht am eingerichteten und ausgeübten Gewerbebetrieb"]],
    ["Eingriff", ["Inhalts- und Schrankenbestimmung (Art. 14 I 2 GG)", "oder Enteignung (Art. 14 III GG): gezielter Entzug konkreter Eigentumspositionen zur Güterbeschaffung"]],
    ["Verfassungsrechtliche Rechtfertigung", ["Inhalts- und Schrankenbestimmung: verhältnismäßig, ggf. ausgleichspflichtig", "Enteignung: zum Wohl der Allgemeinheit, durch oder aufgrund eines Gesetzes mit Entschädigungsregelung (Junktimklausel, Art. 14 III 2 GG)"]],
  ]],
  ["oeff", "o-art2", "Allgemeine Handlungsfreiheit und allgemeines Persönlichkeitsrecht", "Art. 2 I GG (i. V. m. Art. 1 I GG)", [
    ["Schutzbereich", ["Allgemeine Handlungsfreiheit: jedes menschliche Verhalten (Auffanggrundrecht)", "Allgemeines Persönlichkeitsrecht (Art. 2 I i. V. m. Art. 1 I GG): engere persönliche Lebenssphäre, informationelle Selbstbestimmung"]],
    "Eingriff",
    ["Verfassungsrechtliche Rechtfertigung", ["Schrankentrias: Rechte anderer, verfassungsmäßige Ordnung, Sittengesetz", "Verhältnismäßigkeit; beim allgemeinen Persönlichkeitsrecht Sphärentheorie (Intim-, Privat-, Sozialsphäre)"]],
  ]],
  ["oeff", "o-art4", "Glaubens- und Gewissensfreiheit", "Art. 4 I, II GG", [
    ["Schutzbereich", ["Einheitliches Grundrecht: Glauben bilden, haben, bekennen und danach handeln", "(P) Plausible Darlegung der religiösen Motivation"]],
    "Eingriff",
    ["Verfassungsrechtliche Rechtfertigung", ["Vorbehaltlos gewährleistet: nur verfassungsimmanente Schranken (kollidierendes Verfassungsrecht)", "Praktische Konkordanz"]],
  ]],

  // ---------------- Öffentliches Recht: Staatsorganisation ----------------
  ["oeff", "o-konkretenk", "Konkrete Normenkontrolle", "Art. 100 I GG, §§ 13 Nr. 11, 80 ff. BVerfGG", [
    ["Zulässigkeit", [
      "Vorlageberechtigt: Gericht",
      "Vorlagegegenstand: formelles, nachkonstitutionelles Gesetz",
      "Überzeugung des Gerichts von der Verfassungswidrigkeit",
      "Entscheidungserheblichkeit",
      "Form: Begründung (§ 80 II BVerfGG)",
    ]],
    ["Begründetheit", ["Formelle und materielle Verfassungsmäßigkeit des Gesetzes"]],
  ]],
  ["oeff", "o-bundlaender", "Bund-Länder-Streit", "Art. 93 I Nr. 3 GG, §§ 13 Nr. 7, 68 ff. BVerfGG", [
    ["Zulässigkeit", [
      "Beteiligtenfähigkeit: Bundesregierung für den Bund, Landesregierung für das Land (§ 68 BVerfGG)",
      "Streitgegenstand: Maßnahme oder Unterlassung (§§ 69, 64 I BVerfGG)",
      "Antragsbefugnis: mögliche Verletzung von Rechten und Pflichten aus dem Bund-Länder-Verhältnis",
      "Form und Frist (§§ 23 I, 69, 64 III BVerfGG)",
    ]],
    ["Begründetheit", ["Verletzung von Rechten des Antragstellers aus dem Grundgesetz"]],
  ]],
  ["oeff", "o-materiellgesetz", "Materielle Verfassungsmäßigkeit eines Gesetzes", "", [
    "Vereinbarkeit mit Grundrechten (Schutzbereich, Eingriff, Rechtfertigung)",
    "Vereinbarkeit mit Staatsstrukturprinzipien (Art. 20 GG: Demokratie, Rechtsstaat, Bundesstaat, Sozialstaat)",
    "Bestimmtheitsgebot",
    "Rückwirkungsverbot (echte und unechte Rückwirkung)",
  ]],

  // ---------------- Öffentliches Recht: Verwaltungsrecht ----------------
  ["oeff", "o-ffk", "Fortsetzungsfeststellungsklage", "§ 113 I 4 VwGO", [
    ["Zulässigkeit", [
      "Verwaltungsrechtsweg (§ 40 I 1 VwGO)",
      "Statthaftigkeit: Erledigung eines Verwaltungsakts nach Klageerhebung (direkt) oder davor (analog)",
      "Klagebefugnis (§ 42 II VwGO analog)",
      ["Fortsetzungsfeststellungsinteresse", ["Wiederholungsgefahr", "Rehabilitationsinteresse", "Vorbereitung eines Amtshaftungsprozesses", "Tiefgreifender Grundrechtseingriff, der sich typischerweise kurzfristig erledigt"]],
      "(P) Vorverfahren und Klagefrist bei Erledigung vor Klageerhebung",
    ]],
    ["Begründetheit", ["Der erledigte Verwaltungsakt war rechtswidrig und hat den Kläger in seinen Rechten verletzt"]],
  ]],
  ["oeff", "o-leistung", "Allgemeine Leistungsklage", "VwGO (nicht ausdrücklich geregelt, vgl. § 43 II VwGO)", [
    ["Zulässigkeit", [
      "Verwaltungsrechtsweg (§ 40 I 1 VwGO)",
      "Statthaftigkeit: Begehren eines Realakts (Handeln, Dulden, Unterlassen), der kein Verwaltungsakt ist",
      "Klagebefugnis (§ 42 II VwGO analog)",
      "Allgemeines Rechtsschutzbedürfnis (vorheriger Antrag bei der Behörde)",
    ]],
    ["Begründetheit", ["Anspruch auf die begehrte Leistung (z. B. Folgenbeseitigungsanspruch, öffentlich-rechtlicher Unterlassungsanspruch)"]],
  ]],
  ["oeff", "o-feststellung", "Feststellungsklage", "§ 43 VwGO", [
    ["Zulässigkeit", [
      "Verwaltungsrechtsweg (§ 40 I 1 VwGO)",
      "Feststellung des Bestehens oder Nichtbestehens eines Rechtsverhältnisses oder der Nichtigkeit eines Verwaltungsakts (§ 43 I VwGO)",
      "Feststellungsinteresse (berechtigtes Interesse an baldiger Feststellung)",
      "Subsidiarität (§ 43 II VwGO)",
      "Klagebefugnis (§ 42 II VwGO analog, str.)",
    ]],
    ["Begründetheit", ["Das Rechtsverhältnis besteht bzw. besteht nicht"]],
  ]],
  ["oeff", "o-47", "Normenkontrolle vor dem Oberverwaltungsgericht", "§ 47 VwGO", [
    ["Zulässigkeit", [
      "Verwaltungsrechtsweg (§ 40 I 1 VwGO)",
      "Statthaftigkeit: Satzungen nach dem BauGB und Rechtsverordnungen aufgrund des BauGB (§ 47 I Nr. 1 VwGO); andere untergesetzliche Landesvorschriften, soweit das Landesrecht es bestimmt (§ 47 I Nr. 2 VwGO)",
      "Antragsbefugnis: mögliche Rechtsverletzung (§ 47 II 1 VwGO)",
      "Antragsfrist: ein Jahr nach Bekanntmachung (§ 47 II 1 VwGO)",
      "Antragsgegner (§ 47 II 2 VwGO)",
    ]],
    ["Begründetheit", ["Die Rechtsvorschrift ist ungültig (formell oder materiell rechtswidrig)"]],
  ]],
  ["oeff", "o-80v", "Eilrechtsschutz: Wiederherstellung der aufschiebenden Wirkung", "§ 80 V 1 VwGO", [
    ["Zulässigkeit", [
      "Verwaltungsrechtsweg (§ 40 I 1 VwGO)",
      "Statthaftigkeit: in der Hauptsache Anfechtungsklage, und die aufschiebende Wirkung (§ 80 I VwGO) entfällt nach § 80 II 1 Nr. 1–4 VwGO",
      "Antragsbefugnis (§ 42 II VwGO analog)",
      "Rechtsschutzbedürfnis (Rechtsbehelf eingelegt bzw. noch möglich)",
    ]],
    ["Begründetheit", [
      "Bei Anordnung der sofortigen Vollziehung: formelle Rechtmäßigkeit, insbesondere schriftliche Begründung (§ 80 III 1 VwGO)",
      "Interessenabwägung: Erfolgsaussichten in der Hauptsache, Vollzugsinteresse und Aussetzungsinteresse",
    ]],
  ]],
  ["oeff", "o-123", "Einstweilige Anordnung", "§ 123 I VwGO", [
    ["Zulässigkeit", [
      "Verwaltungsrechtsweg (§ 40 I 1 VwGO)",
      "Statthaftigkeit: kein Fall des § 80 V VwGO (§ 123 V VwGO)",
      "Antragsbefugnis (§ 42 II VwGO analog)",
      "Rechtsschutzbedürfnis",
    ]],
    ["Begründetheit", [
      "Anordnungsanspruch (der zu sichernde Anspruch)",
      "Anordnungsgrund (Eilbedürftigkeit)",
      "Glaubhaftmachung (§ 123 III VwGO i. V. m. § 920 II ZPO)",
      "(P) Verbot der Vorwegnahme der Hauptsache",
    ]],
  ]],
  ["oeff", "o-48", "Rücknahme eines rechtswidrigen Verwaltungsakts", "§ 48 VwVfG", [
    "Ermächtigungsgrundlage: § 48 I 1 VwVfG",
    "Formelle Rechtmäßigkeit der Rücknahme (Zuständigkeit, Anhörung § 28 VwVfG)",
    ["Materielle Rechtmäßigkeit", [
      "Rechtswidrigkeit des zurückzunehmenden Verwaltungsakts",
      "Begünstigender Verwaltungsakt: Vertrauensschutz (§ 48 II VwVfG bei Geld- oder Sachleistungen; sonst Ausgleich nach § 48 III VwVfG)",
      "Rücknahmefrist (§ 48 IV VwVfG)",
      "Ermessen",
    ]],
  ]],
  ["oeff", "o-49", "Widerruf eines rechtmäßigen Verwaltungsakts", "§ 49 VwVfG", [
    "Ermächtigungsgrundlage: § 49 I (belastend) bzw. § 49 II VwVfG (begünstigend)",
    "Formelle Rechtmäßigkeit des Widerrufs",
    ["Materielle Rechtmäßigkeit", [
      "Rechtmäßiger Verwaltungsakt",
      "Begünstigender Verwaltungsakt: Widerrufsgrund nach § 49 II 1 Nr. 1–5 VwVfG",
      "Widerrufsfrist (§ 49 II 2 i. V. m. § 48 IV VwVfG)",
      "Ermessen",
    ]],
  ]],
  ["oeff", "o-polizei", "Polizei- und ordnungsrechtliche Maßnahme (Generalklausel)", "Landespolizeigesetz", [
    "Ermächtigungsgrundlage: Spezialermächtigung (Standardmaßnahme) vor Generalklausel",
    "Formelle Rechtmäßigkeit (Zuständigkeit, Verfahren, Form)",
    ["Materielle Rechtmäßigkeit", [
      "Gefahr für die öffentliche Sicherheit oder Ordnung",
      "(P) Anscheinsgefahr, Gefahrverdacht, Putativgefahr",
      "Richtiger Adressat: Verhaltensstörer, Zustandsstörer, ausnahmsweise Nichtstörer",
      "Ermessen (Entschließungs- und Auswahlermessen)",
      "Verhältnismäßigkeit",
    ]],
  ], "Die Normen unterscheiden sich je Bundesland – im Landespolizeigesetz nachschlagen."],
  ["oeff", "o-amtshaftung", "Amtshaftung", "§ 839 I 1 BGB i. V. m. Art. 34 S. 1 GG", [
    "Handeln in Ausübung eines öffentlichen Amtes",
    "Verletzung einer drittbezogenen Amtspflicht",
    "Verschulden (Vorsatz oder Fahrlässigkeit)",
    "Kausaler Schaden",
    "Kein Haftungsausschluss: Verweisungsprivileg bei Fahrlässigkeit (§ 839 I 2 BGB), Spruchrichterprivileg (§ 839 II BGB), schuldhaft unterlassenes Rechtsmittel (§ 839 III BGB)",
    "Anspruchsgegner: die Anstellungskörperschaft (Art. 34 S. 1 GG)",
  ]],

  // ---------------- Öffentliches Recht: Europarecht ----------------
  ["oeff", "o-warenverkehr", "Warenverkehrsfreiheit", "Art. 34 AEUV", [
    "Anwendbarkeit: keine abschließende Harmonisierung durch Sekundärrecht",
    "Schutzbereich: Ware, grenzüberschreitender Bezug",
    ["Beeinträchtigung: Maßnahme gleicher Wirkung wie eine mengenmäßige Einfuhrbeschränkung", ["Dassonville-Formel", "(P) Verkaufsmodalitäten (Keck-Rechtsprechung)"]],
    ["Rechtfertigung", ["Geschriebene Gründe (Art. 36 AEUV)", "Zwingende Erfordernisse des Allgemeininteresses (Cassis de Dijon) bei unterschiedslos anwendbaren Maßnahmen", "Verhältnismäßigkeit"]],
  ]],
  ["oeff", "o-267", "Vorabentscheidungsverfahren", "Art. 267 AEUV", [
    ["Zulässigkeit", [
      "Zuständigkeit des EuGH",
      "Vorlageberechtigt: Gericht eines Mitgliedstaats",
      "Vorlagegegenstand: Auslegung der Verträge oder Gültigkeit und Auslegung von Handlungen der Unionsorgane",
      "Entscheidungserheblichkeit",
    ]],
    ["Vorlagepflicht", ["Letztinstanzliche Gerichte (Art. 267 III AEUV)", "Ausnahmen: acte clair, acte éclairé"]],
  ]],
  ["oeff", "o-258", "Vertragsverletzungsverfahren", "Art. 258 AEUV", [
    ["Zulässigkeit", [
      "Zuständigkeit des EuGH",
      "Parteifähigkeit: Kommission gegen einen Mitgliedstaat",
      "Vorverfahren: Aufforderungsschreiben und begründete Stellungnahme",
      "Klagegegenstand: Verstoß gegen eine Verpflichtung aus den Verträgen",
    ]],
    ["Begründetheit", ["Der Mitgliedstaat hat gegen eine Verpflichtung aus dem Unionsrecht verstoßen"]],
  ]],
];
