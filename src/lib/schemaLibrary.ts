/**
 * Mitgelieferte Prüfungsschemata (Standardaufbauten) für Zivilrecht,
 * Strafrecht und Öffentliches Recht – als Unterstützung, nicht als geprüfte
 * Rechtsinformation: Aufbau und Schwerpunkte können je nach Lehrbuch und
 * Lehrstuhl abweichen. „(P)“ markiert klassische Klausurprobleme.
 *
 * Farben: jedes Rechtsgebiet hat eine Grundfarbe; die Prüfungsstufen
 * (Tatbestand – Rechtswidrigkeit – Schuld, Zulässigkeit – Begründetheit,
 * entstanden – untergegangen – durchsetzbar) bekommen eigene Farben.
 */
import type { SchemaItem } from "../api/types";

export type Rechtsgebiet = "zivil" | "straf" | "oeff";

export const RECHTSGEBIETE: { id: Rechtsgebiet; label: string; color: string }[] = [
  { id: "zivil", label: "Zivilrecht", color: "#2f5fb3" },
  { id: "straf", label: "Strafrecht", color: "#b3364a" },
  { id: "oeff", label: "Öffentliches Recht", color: "#2e7d5b" },
];

export const gebietInfo = (g: Rechtsgebiet) => RECHTSGEBIETE.find((x) => x.id === g)!;

/** Rechtsgebiet aus einem Fachgebiet/Titel („Strafrecht AT“, „BGB“, „Staatsrecht“ …). */
export function gebietOf(text: string | null | undefined): Rechtsgebiet | null {
  const t = (text ?? "").toLowerCase();
  if (/straf|stgb|stpo/.test(t)) return "straf";
  if (/öffentlich|oeffentlich|staats|verfassung|verwaltung|grundrecht|polizei|baurecht|kommunal|europarecht|\bgg\b|vwgo|vwvfg/.test(t)) return "oeff";
  if (/zivil|bürgerlich|bgb|schuldrecht|sachenrecht|vertrags|familienrecht|erbrecht|handelsrecht|gesellschaftsrecht|arbeitsrecht|zpo|hgb/.test(t)) return "zivil";
  return null;
}

/** Farbe einer Prüfungsstufe (oberste Gliederungsebene). */
export function stageColor(gebiet: Rechtsgebiet | null, text: string): string {
  const t = text.toLowerCase();
  if (/zulässigkeit|vorprüfung|sachentscheidungsvoraussetzung/.test(t)) return "#5b6676";
  if (/begründetheit/.test(t)) return "#2e7d5b";
  if (/rechtswidrigkeit|rechtfertigung(?!sgr)|notwehrhandlung|notstandshandlung/.test(t)) return "#a86a12";
  if (/^schuld|schuldfähigkeit/.test(t)) return "#6b4fa3";
  if (/tatbestand|tatentschluss|unmittelbares ansetzen|notwehrlage|notstandslage/.test(t)) return "#2f5fb3";
  if (/rücktritt|strafzumessung|strafantrag|konkurrenz|strafausschließ|strafaufheb|gesamtergebnis/.test(t)) return "#1f7a85";
  if (/untergegangen|rechtsvernichtend/.test(t)) return "#b4471f";
  if (/durchsetzbar|rechtshemmend|einrede/.test(t)) return "#a86a12";
  if (/entstanden|rechtshindernd/.test(t)) return "#2e7d5b";
  if (/subjektiv/.test(t)) return "#6b4fa3";
  if (/schutzbereich/.test(t)) return "#2f5fb3";
  if (/eingriff/.test(t)) return "#a86a12";
  return gebiet ? gebietInfo(gebiet).color : "#5b6676";
}

/** „(P) …“ – klassisches Klausurproblem. */
export const PROBLEM = /^\(P\)\s*/;
export const isProblem = (text: string) => PROBLEM.test(text);

// ---------- Bibliothek ----------

type Lib = [text: string, children?: Lib[], note?: string] | string;

export interface LibrarySchema {
  id: string;
  gebiet: Rechtsgebiet;
  title: string;
  norm: string;
  /** Hinweis zum Schema insgesamt (Rechtsfolge, Aufbauhinweise) */
  notes: string;
  items: SchemaItem[];
}

let seq = 0;
function build(list: Lib[]): SchemaItem[] {
  return list.map((l) => {
    const [text, children = [], note = ""] = typeof l === "string" ? [l] : l;
    return { id: `lib-${++seq}`, text, note, children: build(children) };
  });
}
const S = (gebiet: Rechtsgebiet, id: string, title: string, norm: string, items: Lib[], notes = ""): LibrarySchema => ({ id, gebiet, title, norm, notes, items: build(items) });

const RW_SCHULD: Lib[] = ["Rechtswidrigkeit", "Schuld"];

export const SCHEMA_LIBRARY: LibrarySchema[] = [
  // ---------------- Zivilrecht ----------------
  S("zivil", "z-anspruch", "Anspruchsaufbau (Grundschema)", "", [
    ["Anspruch entstanden", ["Voraussetzungen der Anspruchsgrundlage", "Keine rechtshindernden Einwendungen (z. B. §§ 104 ff., 117, 118, 125, 134, 138 BGB)"]],
    ["Anspruch nicht untergegangen", ["Keine rechtsvernichtenden Einwendungen (z. B. Erfüllung § 362 I BGB, Anfechtung § 142 I BGB, Rücktritt § 346 I BGB, Aufrechnung § 389 BGB, Unmöglichkeit § 275 I BGB)"]],
    ["Anspruch durchsetzbar", ["Keine rechtshemmenden Einreden (z. B. Verjährung § 214 I BGB, Zurückbehaltungsrecht §§ 273, 320 BGB)"]],
  ], "Obersatz: „A könnte gegen B einen Anspruch auf … aus § … BGB haben.“"),
  S("zivil", "z-reihenfolge", "Reihenfolge der Anspruchsgrundlagen", "", [
    "Vertragliche Ansprüche",
    "Vertragsähnliche Ansprüche (c. i. c. §§ 280 I, 311 II, 241 II BGB; § 122 BGB; § 179 BGB)",
    "Ansprüche aus Geschäftsführung ohne Auftrag (§§ 677 ff. BGB)",
    "Dingliche Ansprüche (z. B. § 985 BGB; Eigentümer-Besitzer-Verhältnis §§ 987 ff. BGB)",
    "Deliktische Ansprüche (§§ 823 ff. BGB)",
    "Bereicherungsrechtliche Ansprüche (§§ 812 ff. BGB)",
  ], "Grund für die Reihenfolge: speziellere Regelungen können spätere Anspruchsgrundlagen sperren (z. B. § 993 I a. E. BGB)."),
  S("zivil", "z-vertragsschluss", "Vertragsschluss", "§§ 145 ff. BGB", [
    ["Angebot", [
      ["Objektiver Tatbestand", ["Rechtsbindungswille", "Bestimmtheit (essentialia negotii)"]],
      ["Subjektiver Tatbestand", ["Handlungswille", "Erklärungsbewusstsein", "(P) Fehlendes Erklärungsbewusstsein", "Geschäftswille"]],
      "Abgabe",
      "Zugang (§ 130 I 1 BGB)",
      "Kein Erlöschen (§§ 146 ff. BGB)",
    ]],
    ["Annahme", ["Inhaltlich übereinstimmende Willenserklärung", "Rechtzeitig (§§ 147–149 BGB)", "Zugang oder Entbehrlichkeit (§ 151 BGB)", "(P) Schweigen als Annahme"]],
    "Einigung, kein Dissens (§§ 154, 155 BGB)",
  ]),
  S("zivil", "z-geschaeftsfaehigkeit", "Geschäftsfähigkeit", "§§ 104 ff. BGB", [
    ["Geschäftsunfähigkeit (§ 104 BGB)", [], "Rechtsfolge: Nichtigkeit der Willenserklärung (§ 105 I BGB)"],
    ["Beschränkte Geschäftsfähigkeit (§ 106 BGB)", [
      "Lediglich rechtlicher Vorteil (§ 107 BGB)",
      "(P) Rechtlich neutrale Geschäfte",
      "Einwilligung (§§ 107, 183 BGB) oder Taschengeld (§ 110 BGB)",
      "Genehmigung (§§ 108, 184 BGB)",
    ]],
  ]),
  S("zivil", "z-stellvertretung", "Stellvertretung", "§ 164 I BGB", [
    "Zulässigkeit der Stellvertretung (kein höchstpersönliches Geschäft)",
    "Eigene Willenserklärung des Vertreters (Abgrenzung zum Boten)",
    ["Im Namen des Vertretenen (Offenkundigkeit)", ["(P) Geschäft für den, den es angeht"]],
    ["Mit Vertretungsmacht", ["Vollmacht (§ 167 BGB)", "Gesetzliche Vertretungsmacht", "Rechtsschein: Duldungs- und Anscheinsvollmacht", "(P) Insichgeschäft (§ 181 BGB)"]],
  ], "Rechtsfolge: Die Erklärung wirkt für und gegen den Vertretenen. Ohne Vertretungsmacht: §§ 177 ff. BGB."),
  S("zivil", "z-anfechtung", "Anfechtung", "§ 142 I BGB", [
    "Anfechtbare Willenserklärung",
    ["Anfechtungsgrund", ["Inhalts- oder Erklärungsirrtum (§ 119 I BGB)", "Eigenschaftsirrtum (§ 119 II BGB)", "Übermittlungsfehler (§ 120 BGB)", "Arglistige Täuschung oder widerrechtliche Drohung (§ 123 I BGB)", "(P) Kalkulationsirrtum"]],
    "Anfechtungserklärung (§ 143 BGB)",
    "Anfechtungsfrist (§§ 121, 124 BGB)",
    "Kein Ausschluss (z. B. Bestätigung § 144 BGB)",
  ], "Rechtsfolge: Nichtigkeit von Anfang an (§ 142 I BGB); ggf. Schadensersatz nach § 122 BGB."),
  S("zivil", "z-kaufpreis", "Kaufpreisanspruch", "§ 433 II BGB", [
    ["Anspruch entstanden", ["Wirksamer Kaufvertrag (Angebot, Annahme, keine Nichtigkeitsgründe)"]],
    ["Anspruch nicht untergegangen", ["z. B. Erfüllung (§ 362 I BGB), Rücktritt (§ 346 I BGB), Unmöglichkeit der Gegenleistung (§ 326 I 1 BGB)"]],
    ["Anspruch durchsetzbar", ["z. B. Einrede des nicht erfüllten Vertrags (§ 320 BGB), Verjährung (§§ 195, 199, 214 BGB)"]],
  ]),
  S("zivil", "z-nacherfuellung", "Nacherfüllung", "§§ 437 Nr. 1, 439 BGB", [
    "Wirksamer Kaufvertrag",
    ["Sachmangel (§ 434 BGB) oder Rechtsmangel (§ 435 BGB)", ["Subjektive Anforderungen (§ 434 II BGB)", "Objektive Anforderungen (§ 434 III BGB)", "Montageanforderungen (§ 434 IV BGB)"]],
    ["Bei Gefahrübergang (§§ 446, 447 BGB)", ["Beweislastumkehr beim Verbrauchsgüterkauf (§ 477 BGB)"]],
    "Kein Ausschluss der Mängelrechte (§§ 442, 444 BGB; § 377 HGB)",
    "Wahlrecht des Käufers (§ 439 I BGB); Verweigerungsrecht des Verkäufers (§ 439 IV BGB)",
    "Durchsetzbarkeit: Verjährung (§ 438 BGB)",
  ]),
  S("zivil", "z-ruecktritt", "Rücktritt wegen Mangels", "§§ 437 Nr. 2, 323 I, 346 I BGB", [
    "Wirksamer Kaufvertrag, Mangel bei Gefahrübergang",
    "Erfolglose Fristsetzung zur Nacherfüllung (§ 323 I BGB) oder Entbehrlichkeit (§§ 323 II, 326 V, 440 BGB)",
    "Kein Ausschluss (§ 323 V 2 BGB: unerhebliche Pflichtverletzung; § 323 VI BGB)",
    "Rücktrittserklärung (§ 349 BGB)",
  ], "Rechtsfolge: Rückgewähr der empfangenen Leistungen (§ 346 I BGB)."),
  S("zivil", "z-sesdl", "Schadensersatz statt der Leistung", "§§ 280 I, III, 281 BGB", [
    "Schuldverhältnis",
    "Pflichtverletzung: fällige, durchsetzbare Leistung nicht oder nicht wie geschuldet erbracht",
    "Erfolglose Fristsetzung (§ 281 I 1 BGB) oder Entbehrlichkeit (§ 281 II BGB; im Kaufrecht § 440 BGB)",
    "Vertretenmüssen (vermutet, § 280 I 2 BGB; §§ 276–278 BGB)",
    "Schaden und Kausalität (§§ 249 ff. BGB)",
  ]),
  S("zivil", "z-280", "Schadensersatz neben der Leistung", "§ 280 I BGB", [
    "Schuldverhältnis",
    "Pflichtverletzung (auch Schutzpflichten, § 241 II BGB)",
    "Vertretenmüssen (vermutet, § 280 I 2 BGB)",
    "Schaden und haftungsausfüllende Kausalität (§§ 249 ff. BGB)",
  ], "Verzögerungsschaden nur unter den zusätzlichen Voraussetzungen des Verzugs (§§ 280 II, 286 BGB)."),
  S("zivil", "z-cic", "Culpa in contrahendo", "§§ 280 I, 311 II, 241 II BGB", [
    "Vorvertragliches Schuldverhältnis (§ 311 II BGB)",
    "Pflichtverletzung (§ 241 II BGB)",
    "Vertretenmüssen (§ 280 I 2 BGB)",
    ["Schaden", ["(P) Vertragsaufhebung als Schadensersatz"]],
  ]),
  S("zivil", "z-985", "Herausgabeanspruch des Eigentümers", "§ 985 BGB", [
    ["Anspruchsteller ist Eigentümer", ["Eigentumserwerb prüfen (§§ 929 ff. BGB; gutgläubiger Erwerb §§ 932 ff. BGB)"]],
    "Anspruchsgegner ist Besitzer (§ 854 BGB)",
    "Kein Recht zum Besitz (§ 986 BGB)",
  ]),
  S("zivil", "z-929", "Eigentumserwerb an beweglichen Sachen", "§ 929 S. 1 BGB", [
    "Einigung",
    "Übergabe",
    "Einigsein im Zeitpunkt der Übergabe",
    ["Berechtigung des Veräußerers", ["Eigentümer oder verfügungsbefugt (§ 185 BGB)", "Sonst gutgläubiger Erwerb (§ 932 BGB)", "Kein Abhandenkommen (§ 935 BGB)"]],
  ]),
  S("zivil", "z-823", "Deliktische Haftung", "§ 823 I BGB", [
    ["Rechtsgutsverletzung (Leben, Körper, Gesundheit, Freiheit, Eigentum, sonstiges Recht)", ["(P) Allgemeines Persönlichkeitsrecht; Recht am eingerichteten und ausgeübten Gewerbebetrieb"]],
    "Verletzungshandlung (Tun oder Unterlassen bei Verkehrspflicht)",
    "Haftungsbegründende Kausalität und objektive Zurechnung",
    "Rechtswidrigkeit (durch die Rechtsgutsverletzung indiziert)",
    "Verschulden (§ 276 BGB; Deliktsfähigkeit §§ 827, 828 BGB)",
    "Schaden und haftungsausfüllende Kausalität (§§ 249 ff. BGB)",
  ], "Mitverschulden des Geschädigten: § 254 BGB."),
  S("zivil", "z-812-leistung", "Leistungskondiktion", "§ 812 I 1 Alt. 1 BGB", [
    "Etwas erlangt",
    "Durch Leistung (bewusste und zweckgerichtete Mehrung fremden Vermögens)",
    "Ohne Rechtsgrund",
    "Kein Ausschluss (§§ 814, 817 S. 2 BGB)",
  ], "Rechtsfolge: Herausgabe des Erlangten, ggf. Wertersatz (§ 818 II BGB); Entreicherung (§ 818 III BGB)."),
  S("zivil", "z-812-eingriff", "Nichtleistungskondiktion", "§ 812 I 1 Alt. 2 BGB", [
    "Etwas erlangt",
    "In sonstiger Weise (insbesondere durch Eingriff)",
    "Auf Kosten des Anspruchstellers",
    "Ohne Rechtsgrund",
  ], "Vorrang der Leistungsbeziehung: Wer etwas durch Leistung erlangt hat, ist grundsätzlich nur dem Leistenden ausgesetzt."),
  S("zivil", "z-goa", "Berechtigte Geschäftsführung ohne Auftrag", "§§ 677, 683 S. 1, 670 BGB", [
    "Geschäftsbesorgung",
    ["Fremdes Geschäft", ["(P) Auch-fremdes Geschäft"]],
    "Fremdgeschäftsführungswille",
    "Ohne Auftrag oder sonstige Berechtigung",
    "Berechtigung: Interesse und (mutmaßlicher) Wille des Geschäftsherrn (§ 683 S. 1 BGB) oder § 679 BGB",
  ], "Rechtsfolge: Aufwendungsersatz (§§ 683 S. 1, 670 BGB)."),

  // ---------------- Strafrecht ----------------
  S("straf", "s-aufbau", "Aufbau eines Strafrechtsgutachtens", "", [
    "Tatkomplexe bilden (chronologisch)",
    "Je Tatkomplex: Tatnähere zuerst (Täter vor Teilnehmer)",
    "Je Beteiligtem: schwerstes Delikt zuerst; Grunddelikt mit Qualifikation",
    "Konkurrenzen (§§ 52, 53 StGB)",
    "Gesamtergebnis",
  ]),
  S("straf", "s-vorsatz", "Vorsätzliches vollendetes Begehungsdelikt", "", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Tatsubjekt, Tathandlung, Taterfolg", "Kausalität (Äquivalenztheorie)", "Objektive Zurechnung"]],
      ["Subjektiver Tatbestand", ["Vorsatz bezüglich aller objektiven Tatumstände (§ 15 StGB)", "Besondere subjektive Merkmale (z. B. Zueignungsabsicht)"]],
    ]],
    ["Rechtswidrigkeit", ["Rechtfertigungsgründe (z. B. §§ 32, 34 StGB, Einwilligung)"]],
    ["Schuld", ["Schuldfähigkeit (§§ 19, 20 StGB)", "Entschuldigungsgründe (z. B. §§ 33, 35 StGB)", "Unrechtsbewusstsein (§ 17 StGB)"]],
    "Ggf. Strafausschließungs- und Strafaufhebungsgründe, Strafantrag",
  ]),
  S("straf", "s-versuch", "Versuch", "§§ 22, 23 I StGB", [
    ["Vorprüfung", ["Keine Vollendung", "Strafbarkeit des Versuchs (§ 23 I StGB i. V. m. § 12 StGB)"]],
    ["Tatentschluss", ["Vorsatz bezüglich aller objektiven Tatbestandsmerkmale", "Besondere subjektive Merkmale"]],
    ["Unmittelbares Ansetzen (§ 22 StGB)", ["(P) Zwischenaktstheorie, Gefährdung des Rechtsguts"]],
    ...RW_SCHULD,
    ["Kein Rücktritt (§ 24 StGB)", ["Kein fehlgeschlagener Versuch", "Unbeendeter oder beendeter Versuch", "Rücktrittshandlung: Aufgeben bzw. Verhindern der Vollendung", "Freiwilligkeit"]],
  ]),
  S("straf", "s-fahrlaessig", "Fahrlässiges Erfolgsdelikt", "", [
    ["Tatbestand", ["Erfolg, Handlung, Kausalität", "Objektive Sorgfaltspflichtverletzung bei objektiver Vorhersehbarkeit", "Objektive Zurechnung (Pflichtwidrigkeitszusammenhang, Schutzzweck der Norm)"]],
    "Rechtswidrigkeit",
    ["Schuld", ["Subjektive Sorgfaltspflichtverletzung bei subjektiver Vorhersehbarkeit", "Zumutbarkeit normgemäßen Verhaltens"]],
  ]),
  S("straf", "s-unterlassen", "Unechtes Unterlassungsdelikt", "§ 13 StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Eintritt des Erfolgs", "Unterlassen trotz physisch-realer Handlungsmöglichkeit", "(P) Abgrenzung von Tun und Unterlassen (Schwerpunkt der Vorwerfbarkeit)", "Quasi-Kausalität und objektive Zurechnung", "Garantenstellung (Beschützer- oder Überwachergarant)", "Entsprechensklausel (§ 13 I a. E. StGB)"]],
      ["Subjektiver Tatbestand", ["Vorsatz, auch bezüglich der Umstände der Garantenstellung"]],
    ]],
    "Rechtswidrigkeit",
    ["Schuld", ["Zumutbarkeit normgemäßen Verhaltens"]],
  ]),
  S("straf", "s-mittaeter", "Mittäterschaft", "§ 25 II StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Zurechnung fremder Tatbeiträge über § 25 II StGB", "Gemeinsamer Tatplan", "Gemeinsame Tatausführung (wesentlicher Tatbeitrag)", "(P) Abgrenzung von Täterschaft und Teilnahme (Tatherrschaftslehre, subjektive Theorie)"]],
      ["Subjektiver Tatbestand", ["Vorsatz", "(P) Mittäterexzess"]],
    ]],
    ...RW_SCHULD,
  ]),
  S("straf", "s-anstiftung", "Anstiftung", "§ 26 StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Vorsätzliche, rechtswidrige Haupttat", "Bestimmen (Hervorrufen des Tatentschlusses)", "(P) Omnimodo facturus"]],
      ["Subjektiver Tatbestand", ["Doppelter Anstiftervorsatz (Haupttat und Bestimmen)"]],
    ]],
    ...RW_SCHULD,
  ]),
  S("straf", "s-beihilfe", "Beihilfe", "§ 27 StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Vorsätzliche, rechtswidrige Haupttat", "Hilfeleisten", "(P) Kausalität der Beihilfe; neutrale Handlungen"]],
      ["Subjektiver Tatbestand", ["Doppelter Gehilfenvorsatz"]],
    ]],
    ...RW_SCHULD,
  ], "Strafmilderung nach § 27 II 2 StGB i. V. m. § 49 I StGB."),
  S("straf", "s-notwehr", "Notwehr", "§ 32 StGB", [
    ["Notwehrlage", ["Angriff", "Gegenwärtig", "Rechtswidrig"]],
    ["Notwehrhandlung", ["Verteidigung gegen den Angreifer", "Erforderlichkeit (geeignet; mildestes gleich wirksames Mittel)", "Gebotenheit", "(P) Einschränkungen: Provokation, krasses Missverhältnis, schuldlos Handelnde"]],
    "Subjektives Rechtfertigungselement: Verteidigungswille",
  ]),
  S("straf", "s-notstand", "Rechtfertigender Notstand", "§ 34 StGB", [
    "Notstandslage: gegenwärtige Gefahr für ein Rechtsgut",
    ["Notstandshandlung", ["Erforderlichkeit", "Interessenabwägung: das geschützte Interesse überwiegt wesentlich", "Angemessenheit (§ 34 S. 2 StGB)"]],
    "Subjektives Rechtfertigungselement: Gefahrabwendungswille",
  ]),
  S("straf", "s-242", "Diebstahl", "§ 242 I StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Fremde bewegliche Sache", "Wegnahme: Bruch fremden und Begründung neuen, nicht notwendig tätereigenen Gewahrsams", "(P) Gewahrsamsbruch bei Selbstbedienung; Abgrenzung zum Betrug (Trickdiebstahl)"]],
      ["Subjektiver Tatbestand", ["Vorsatz", "Absicht rechtswidriger Zueignung: Aneignungsabsicht (zumindest vorübergehend), Enteignungsvorsatz (dauerhaft)", "Rechtswidrigkeit der erstrebten Zueignung und Vorsatz diesbezüglich"]],
    ]],
    ...RW_SCHULD,
    "Strafzumessung: Regelbeispiele (§ 243 StGB)",
    "Strafantrag (§§ 247, 248a StGB)",
  ]),
  S("straf", "s-263", "Betrug", "§ 263 I StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Täuschung über Tatsachen", "Irrtum", "Vermögensverfügung", "(P) Verfügungsbewusstsein; Dreiecksbetrug", "Vermögensschaden", "(P) Eingehungsbetrug; schadensgleiche Vermögensgefährdung", "Kausalität und funktionaler Zusammenhang"]],
      ["Subjektiver Tatbestand", ["Vorsatz", "Absicht rechtswidriger und stoffgleicher Bereicherung"]],
    ]],
    ...RW_SCHULD,
    "Strafzumessung: Regelbeispiele (§ 263 III StGB)",
  ]),
  S("straf", "s-223", "Körperverletzung", "§ 223 I StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Körperliche Misshandlung", "oder Gesundheitsschädigung"]],
      ["Subjektiver Tatbestand", ["Vorsatz"]],
    ]],
    ["Rechtswidrigkeit", ["(P) Einwilligung und Sittenwidrigkeit (§ 228 StGB)"]],
    "Schuld",
    "Strafantrag (§ 230 StGB)",
  ]),
  S("straf", "s-224", "Gefährliche Körperverletzung", "§ 224 I StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Grunddelikt: § 223 I StGB", "Qualifikation: Nr. 1 Gift oder gesundheitsschädliche Stoffe; Nr. 2 Waffe oder gefährliches Werkzeug; Nr. 3 hinterlistiger Überfall; Nr. 4 mit einem anderen Beteiligten gemeinschaftlich; Nr. 5 lebensgefährdende Behandlung", "(P) Unbewegliche Gegenstände als Werkzeug; abstrakte oder konkrete Lebensgefahr bei Nr. 5"]],
      ["Subjektiver Tatbestand", ["Vorsatz bezüglich Grunddelikt und Qualifikation"]],
    ]],
    ...RW_SCHULD,
  ]),
  S("straf", "s-211", "Totschlag und Mord", "§§ 212, 211 StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Tötung eines anderen Menschen", "Tatbezogene Mordmerkmale (2. Gruppe): heimtückisch, grausam, mit gemeingefährlichen Mitteln"]],
      ["Subjektiver Tatbestand", ["Vorsatz", "Täterbezogene Mordmerkmale (1. Gruppe): Mordlust, Befriedigung des Geschlechtstriebs, Habgier, sonst niedrige Beweggründe", "Täterbezogene Mordmerkmale (3. Gruppe): um eine andere Straftat zu ermöglichen oder zu verdecken"]],
      "(P) Verhältnis von § 211 zu § 212 StGB – Bedeutung für § 28 StGB bei Teilnehmern",
    ]],
    ...RW_SCHULD,
  ]),
  S("straf", "s-249", "Raub", "§ 249 I StGB", [
    ["Tatbestand", [
      ["Objektiver Tatbestand", ["Fremde bewegliche Sache", "Wegnahme", "Gewalt gegen eine Person oder Drohung mit gegenwärtiger Gefahr für Leib oder Leben", "Finalzusammenhang zwischen Nötigungsmittel und Wegnahme", "(P) Abgrenzung zur räuberischen Erpressung (§§ 253, 255 StGB)"]],
      ["Subjektiver Tatbestand", ["Vorsatz", "Absicht rechtswidriger Zueignung"]],
    ]],
    ...RW_SCHULD,
  ]),

  // ---------------- Öffentliches Recht ----------------
  S("oeff", "o-vb", "Verfassungsbeschwerde", "Art. 93 I Nr. 4a GG, §§ 13 Nr. 8a, 90 ff. BVerfGG", [
    ["Zulässigkeit", [
      "Zuständigkeit des Bundesverfassungsgerichts (Art. 93 I Nr. 4a GG, § 13 Nr. 8a BVerfGG)",
      "Beschwerdefähigkeit: „jedermann“ (§ 90 I BVerfGG)",
      "Prozessfähigkeit",
      "Beschwerdegegenstand: Akt der öffentlichen Gewalt",
      ["Beschwerdebefugnis (§ 90 I BVerfGG)", ["Möglichkeit einer Grundrechtsverletzung", "Selbst, gegenwärtig und unmittelbar betroffen"]],
      "Rechtswegerschöpfung (§ 90 II 1 BVerfGG) und Subsidiarität",
      "Form (§§ 23 I, 92 BVerfGG) und Frist (§ 93 BVerfGG)",
    ]],
    ["Begründetheit", ["Verletzung eines Grundrechts oder grundrechtsgleichen Rechts (Prüfung nach dem Schema „Freiheitsgrundrecht“ bzw. „Gleichheitssatz“)"]],
  ], "Obersatz: „Die Verfassungsbeschwerde hat Erfolg, soweit sie zulässig und begründet ist.“"),
  S("oeff", "o-freiheit", "Freiheitsgrundrecht (Abwehrrecht)", "", [
    ["Schutzbereich", ["Persönlicher Schutzbereich", "Sachlicher Schutzbereich"]],
    ["Eingriff", ["Klassischer und moderner Eingriffsbegriff"]],
    ["Verfassungsrechtliche Rechtfertigung", [
      "Schranke (einfacher oder qualifizierter Gesetzesvorbehalt, verfassungsimmanente Schranken)",
      ["Schranken-Schranken", [
        "Verfassungsmäßigkeit des Gesetzes (formell und materiell)",
        "Verhältnismäßigkeit: legitimer Zweck, Geeignetheit, Erforderlichkeit, Angemessenheit",
        "Wesensgehaltsgarantie (Art. 19 II GG), Zitiergebot (Art. 19 I 2 GG)",
        "Verfassungsmäßigkeit des Einzelakts",
      ]],
    ]],
  ]),
  S("oeff", "o-gleichheit", "Allgemeiner Gleichheitssatz", "Art. 3 I GG", [
    "Ungleichbehandlung von wesentlich Gleichem (Vergleichsgruppen bilden)",
    ["Verfassungsrechtliche Rechtfertigung", ["Prüfungsmaßstab: vom Willkürverbot bis zur strengen Verhältnismäßigkeitsprüfung", "Sachlicher Grund bzw. Verhältnismäßigkeit der Ungleichbehandlung"]],
  ]),
  S("oeff", "o-formell", "Formelle Verfassungsmäßigkeit eines Bundesgesetzes", "Art. 70 ff. GG", [
    ["Gesetzgebungskompetenz", ["Ausschließliche Gesetzgebung (Art. 71, 73 GG)", "Konkurrierende Gesetzgebung (Art. 72, 74 GG), ggf. Erforderlichkeitsklausel (Art. 72 II GG)"]],
    ["Gesetzgebungsverfahren", ["Einbringung (Art. 76 GG)", "Beschluss des Bundestages (Art. 77 I GG, Art. 42 II GG)", "Mitwirkung des Bundesrates: Einspruchs- oder Zustimmungsgesetz (Art. 77 II–IV, 78 GG)"]],
    "Form: Ausfertigung und Verkündung (Art. 82 GG)",
  ]),
  S("oeff", "o-organstreit", "Organstreitverfahren", "Art. 93 I Nr. 1 GG, §§ 13 Nr. 5, 63 ff. BVerfGG", [
    ["Zulässigkeit", [
      "Zuständigkeit des Bundesverfassungsgerichts",
      "Beteiligtenfähigkeit (Art. 93 I Nr. 1 GG, § 63 BVerfGG)",
      "Streitgegenstand: rechtserhebliche Maßnahme oder Unterlassung (§ 64 I BVerfGG)",
      "Antragsbefugnis (§ 64 I BVerfGG)",
      "Form und Frist (§§ 23 I, 64 II, III BVerfGG)",
    ]],
    ["Begründetheit", ["Verletzung oder unmittelbare Gefährdung von Rechten des Antragstellers aus dem Grundgesetz"]],
  ]),
  S("oeff", "o-normenkontrolle", "Abstrakte Normenkontrolle", "Art. 93 I Nr. 2 GG, §§ 13 Nr. 6, 76 ff. BVerfGG", [
    ["Zulässigkeit", [
      "Antragsberechtigung: Bundesregierung, Landesregierung oder ein Viertel der Mitglieder des Bundestages",
      "Antragsgegenstand: Bundes- oder Landesrecht",
      ["Antragsgrund (§ 76 I BVerfGG)", ["(P) Verhältnis von „Zweifeln“ (Art. 93 I Nr. 2 GG) und „für nichtig halten“ (§ 76 I Nr. 1 BVerfGG)"]],
      "Form (§ 23 I BVerfGG)",
    ]],
    ["Begründetheit", ["Formelle und materielle Verfassungsmäßigkeit der Norm"]],
  ]),
  S("oeff", "o-anfechtung", "Anfechtungsklage", "§ 42 I Alt. 1 VwGO", [
    ["Zulässigkeit", [
      ["Verwaltungsrechtsweg (§ 40 I 1 VwGO)", ["Öffentlich-rechtliche Streitigkeit nichtverfassungsrechtlicher Art"]],
      "Statthafte Klageart: Aufhebung eines Verwaltungsakts (§ 35 S. 1 VwVfG)",
      ["Klagebefugnis (§ 42 II VwGO)", ["Möglichkeit der Verletzung eigener Rechte (Adressatentheorie)"]],
      "Vorverfahren (§§ 68 ff. VwGO), soweit nicht entbehrlich",
      "Klagefrist (§ 74 I VwGO)",
      "Klagegegner (§ 78 VwGO)",
      "Beteiligten- und Prozessfähigkeit (§§ 61, 62 VwGO)",
      "Zuständiges Gericht (§§ 45, 52 VwGO)",
    ]],
    ["Begründetheit (§ 113 I 1 VwGO)", [
      "Ermächtigungsgrundlage (Vorbehalt des Gesetzes)",
      ["Formelle Rechtmäßigkeit", ["Zuständigkeit", "Verfahren, insbesondere Anhörung (§ 28 VwVfG)", "Form (§ 37 VwVfG) und Begründung (§ 39 VwVfG)"], "Heilung und Unbeachtlichkeit von Fehlern: §§ 45, 46 VwVfG"],
      ["Materielle Rechtmäßigkeit", ["Tatbestandsvoraussetzungen der Ermächtigungsgrundlage", "Rechtsfolge: gebundene Entscheidung oder fehlerfreies Ermessen (§ 40 VwVfG, § 114 S. 1 VwGO)", "Verhältnismäßigkeit"]],
      "Verletzung subjektiver Rechte des Klägers",
    ]],
  ], "Obersatz: „Die Klage hat Erfolg, soweit sie zulässig und begründet ist.“"),
  S("oeff", "o-verpflichtung", "Verpflichtungsklage", "§ 42 I Alt. 2 VwGO", [
    ["Zulässigkeit", [
      "Verwaltungsrechtsweg (§ 40 I 1 VwGO)",
      "Statthafte Klageart: Begehren eines abgelehnten oder unterlassenen Verwaltungsakts",
      "Klagebefugnis (§ 42 II VwGO): Möglichkeit eines Anspruchs",
      "Vorverfahren (§ 68 II VwGO) bzw. Untätigkeitsklage (§ 75 VwGO)",
      "Klagefrist (§ 74 II VwGO)",
      "Klagegegner (§ 78 VwGO)",
    ]],
    ["Begründetheit (§ 113 V VwGO)", [
      "Anspruchsgrundlage",
      "Formelle Anspruchsvoraussetzungen (z. B. Antrag, Zuständigkeit)",
      "Materielle Anspruchsvoraussetzungen",
      "Spruchreife; sonst Bescheidungsurteil (§ 113 V 2 VwGO)",
    ]],
  ]),
  S("oeff", "o-ermessen", "Ermessensfehler", "§ 40 VwVfG, § 114 S. 1 VwGO", [
    "Ermessensausfall (Nichtgebrauch)",
    "Ermessensüberschreitung (Rechtsfolge außerhalb des gesetzlichen Rahmens)",
    "Ermessensfehlgebrauch (sachfremde Erwägungen, Abwägungsdefizit)",
    "Ermessensreduzierung auf null",
  ]),
  S("oeff", "o-vhm", "Verhältnismäßigkeit", "", [
    "Legitimer Zweck",
    "Geeignetheit",
    "Erforderlichkeit (mildestes gleich wirksames Mittel)",
    "Angemessenheit (Verhältnismäßigkeit im engeren Sinne)",
  ]),
];

/** Kopie mit neuen Kennungen (für „In meine Schemata übernehmen“). */
export function cloneItems(items: SchemaItem[]): SchemaItem[] {
  return items.map((i) => ({ id: "", text: i.text, note: i.note, children: cloneItems(i.children) }));
}
