/**
 * Gutachten-Gerüste nach Rechtsgebiet. Jedes Rechtsgebiet hat seinen eigenen
 * Ablauf: Zivilrecht fragt „Wer will was von wem woraus?“ (Anspruchsaufbau),
 * Strafrecht prüft Delikt für Delikt (Tatbestand – Rechtswidrigkeit – Schuld),
 * Öffentliches Recht trennt Zulässigkeit und Begründetheit. Die Sätze sind im
 * Gutachtenstil vorformuliert und farbig markiert; „…“ sind Platzhalter.
 * Standardaufbau zur Orientierung – Lehrstühle setzen teils andere Schwerpunkte.
 */
import { gs, legendeNode, type GutachtenSchritt } from "./gutachtenstil";
import { b, doc, empty, h, i, ol, p, type PMNode } from "./pm";
import { stageColor, type Rechtsgebiet } from "./schemaLibrary";

export type GutachtenArt = "zivil" | "straf" | "oeff-klage" | "oeff-vb" | "allgemein";

export const GUTACHTEN_ARTEN: { id: GutachtenArt; label: string; gebiet: Rechtsgebiet | null; description: string }[] = [
  { id: "zivil", label: "Zivilrecht", gebiet: "zivil", description: "Anspruchsaufbau: entstanden – nicht untergegangen – durchsetzbar." },
  { id: "straf", label: "Strafrecht", gebiet: "straf", description: "Tatkomplexe, Delikt für Delikt: Tatbestand – Rechtswidrigkeit – Schuld, Konkurrenzen." },
  { id: "oeff-klage", label: "Öff. Recht: Klage (VwGO)", gebiet: "oeff", description: "Verwaltungsprozess: Zulässigkeit – Begründetheit (§ 113 I 1 VwGO)." },
  { id: "oeff-vb", label: "Öff. Recht: Verfassungsbeschwerde", gebiet: "oeff", description: "Zulässigkeit – Begründetheit: Schutzbereich, Eingriff, Rechtfertigung." },
  { id: "allgemein", label: "Ohne Rechtsgebiet", gebiet: null, description: "Obersatz, Definition, Subsumtion, Ergebnis." },
];

const ph = (s: string) => i(`[${s}]`);
const satz = (text: string, step: GutachtenSchritt) => p(gs(text, step));
/** Die vier Schritte des Gutachtenstils für eine Voraussetzung. */
const vierSchritte = (obersatz = "Dazu müsste … vorliegen.", definition = "… ist … .", subsumtion = "Hier … .", ergebnis = "Somit liegt … vor."): PMNode[] => [
  satz(obersatz, "obersatz"),
  satz(definition, "definition"),
  satz(subsumtion, "subsumtion"),
  satz(ergebnis, "ergebnis"),
];
/** Gliederungspunkt in der Farbe seiner Prüfungsstufe. */
const stufe = (level: 3 | 4, label: string, gebiet: Rechtsgebiet): PMNode => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text: label, marks: [{ type: "textStyle", attrs: { color: stageColor(gebiet, label.replace(/^[A-Z]+\.\s*|^[IVX]+\.\s*|^\d+\.\s*/, "")) } }] }],
});
const punkt = (label: string) => p(b(label));
const hinweis = (text: string) => p(i(text));

function kopf(title: string, art: GutachtenArt): PMNode[] {
  return [
    h(1, title),
    p(b("Rechtsgebiet: "), GUTACHTEN_ARTEN.find((a) => a.id === art)!.label, "   ", b("Fallfrage: "), ph("Wie ist die Rechtslage? / Hat … Erfolg?")),
    legendeNode(),
    h(2, "Sachverhalt (Kurzfassung)"),
    empty(),
    h(2, "Lösungsskizze"),
    ol("…"),
    h(2, "Gutachten"),
  ];
}

function zivil(): PMNode[] {
  const g = "zivil";
  return [
    hinweis("Wer will was von wem woraus? Reihenfolge der Anspruchsgrundlagen: vertraglich – vertragsähnlich – dinglich – deliktisch – bereicherungsrechtlich."),
    stufe(3, "A. Anspruch des … gegen … auf … aus § … BGB", g),
    satz("… könnte gegen … einen Anspruch auf … aus § … BGB haben.", "obersatz"),
    stufe(4, "I. Anspruch entstanden", g),
    satz("Dazu müsste der Anspruch entstanden sein.", "obersatz"),
    punkt("1. …"),
    ...vierSchritte(),
    punkt("2. …"),
    ...vierSchritte(),
    satz("Der Anspruch ist entstanden.", "ergebnis"),
    stufe(4, "II. Anspruch nicht untergegangen", g),
    satz("Der Anspruch dürfte nicht untergegangen sein.", "obersatz"),
    satz("Rechtsvernichtende Einwendungen wie Erfüllung (§ 362 I BGB), Aufrechnung (§ 389 BGB) oder Rücktritt (§ 346 I BGB) sind nicht ersichtlich.", "subsumtion"),
    satz("Der Anspruch ist nicht untergegangen.", "ergebnis"),
    stufe(4, "III. Anspruch durchsetzbar", g),
    satz("Der Anspruch müsste auch durchsetzbar sein.", "obersatz"),
    satz("Rechtshemmende Einreden wie Verjährung (§ 214 I BGB) oder die Einrede des nicht erfüllten Vertrags (§ 320 I BGB) sind nicht ersichtlich.", "subsumtion"),
    satz("Der Anspruch ist durchsetzbar.", "ergebnis"),
    stufe(4, "IV. Ergebnis", g),
    satz("… hat gegen … einen Anspruch auf … aus § … BGB.", "ergebnis"),
    stufe(3, "B. Anspruch aus § … BGB", g),
    satz("… könnte gegen … zudem einen Anspruch auf … aus § … BGB haben.", "obersatz"),
    empty(),
    stufe(3, "C. Gesamtergebnis", g),
    satz("… kann von … … verlangen.", "ergebnis"),
  ];
}

function straf(): PMNode[] {
  const g = "straf";
  return [
    hinweis("Chronologisch nach Tatkomplexen; je Beteiligtem, Täter vor Teilnehmer; Vollendung vor Versuch; Grunddelikt vor Qualifikation. Am Ende Konkurrenzen."),
    h(3, "1. Tatkomplex: …"),
    stufe(4, "A. Strafbarkeit des … gem. § … StGB", g),
    satz("… könnte sich wegen … gem. § … StGB strafbar gemacht haben, indem … .", "obersatz"),
    stufe(4, "I. Tatbestand", g),
    punkt("1. Objektiver Tatbestand"),
    ...vierSchritte("… müsste … haben.", "… ist jede … .", "Hier … .", "Somit liegt … vor."),
    punkt("2. Subjektiver Tatbestand"),
    ...vierSchritte(
      "… müsste vorsätzlich gehandelt haben.",
      "Vorsatz ist der Wille zur Verwirklichung eines Straftatbestandes in Kenntnis aller seiner objektiven Tatumstände.",
      "… wusste, dass … , und wollte … .",
      "… handelte vorsätzlich.",
    ),
    stufe(4, "II. Rechtswidrigkeit", g),
    satz("Rechtfertigungsgründe sind nicht ersichtlich.", "subsumtion"),
    satz("… handelte rechtswidrig.", "ergebnis"),
    stufe(4, "III. Schuld", g),
    satz("Schuldausschließungs- und Entschuldigungsgründe sind nicht ersichtlich.", "subsumtion"),
    satz("… handelte schuldhaft.", "ergebnis"),
    stufe(4, "IV. Ergebnis", g),
    satz("… hat sich wegen … gem. § … StGB strafbar gemacht.", "ergebnis"),
    stufe(4, "B. Strafbarkeit des … gem. § … StGB", g),
    satz("… könnte sich ferner wegen … gem. § … StGB strafbar gemacht haben, indem … .", "obersatz"),
    empty(),
    stufe(3, "2. Konkurrenzen", g),
    satz("Die Delikte stehen in Tateinheit (§ 52 StGB) / Tatmehrheit (§ 53 StGB), weil … .", "subsumtion"),
    stufe(3, "Gesamtergebnis", g),
    satz("… hat sich wegen … strafbar gemacht.", "ergebnis"),
  ];
}

function oeffKlage(): PMNode[] {
  const g = "oeff";
  const kurz = (label: string, obersatz: string, ergebnis: string) => [punkt(label), satz(obersatz, "obersatz"), satz("Hier … .", "subsumtion"), satz(ergebnis, "ergebnis")];
  return [
    hinweis("Statthafte Klageart bestimmt den Aufbau – hier Anfechtungsklage (§ 42 I Alt. 1 VwGO). Bei Verpflichtungs-, Leistungs- oder Feststellungsklage Punkte anpassen."),
    satz("Die Klage des … hat Erfolg, soweit sie zulässig und begründet ist.", "obersatz"),
    stufe(3, "A. Zulässigkeit", g),
    punkt("I. Eröffnung des Verwaltungsrechtswegs"),
    ...vierSchritte(
      "Mangels aufdrängender Sonderzuweisung müsste eine öffentlich-rechtliche Streitigkeit nichtverfassungsrechtlicher Art vorliegen (§ 40 I 1 VwGO).",
      "Eine Streitigkeit ist öffentlich-rechtlich, wenn die streitentscheidenden Normen solche des öffentlichen Rechts sind.",
      "Hier … .",
      "Der Verwaltungsrechtsweg ist eröffnet.",
    ),
    ...kurz("II. Statthafte Klageart", "Die Anfechtungsklage ist statthaft, wenn der Kläger die Aufhebung eines Verwaltungsakts begehrt (§ 42 I Alt. 1 VwGO).", "Die Anfechtungsklage ist statthaft."),
    ...kurz("III. Klagebefugnis", "… müsste geltend machen, durch den Verwaltungsakt in seinen Rechten verletzt zu sein (§ 42 II VwGO).", "… ist klagebefugt."),
    ...kurz("IV. Vorverfahren", "Vor Erhebung der Anfechtungsklage müsste ein Widerspruchsverfahren durchgeführt worden sein, soweit es nicht entbehrlich ist (§ 68 I VwGO).", "Das Vorverfahren ist durchgeführt bzw. entbehrlich."),
    ...kurz("V. Klagefrist", "Die Klage müsste innerhalb eines Monats erhoben worden sein (§ 74 I VwGO).", "Die Klagefrist ist gewahrt."),
    ...kurz("VI. Beteiligte und Klagegegner", "Die Beteiligten müssten beteiligten- und prozessfähig sein (§§ 61, 62 VwGO); richtiger Klagegegner ist der Rechtsträger der Behörde (§ 78 I Nr. 1 VwGO).", "Beteiligte und Klagegegner sind richtig gewählt."),
    satz("Die Klage ist zulässig.", "ergebnis"),
    stufe(3, "B. Begründetheit", g),
    satz("Die Klage ist begründet, soweit der Verwaltungsakt rechtswidrig und der Kläger dadurch in seinen Rechten verletzt ist (§ 113 I 1 VwGO).", "obersatz"),
    punkt("I. Ermächtigungsgrundlage"),
    satz("Als belastender Verwaltungsakt bedarf … einer Ermächtigungsgrundlage (Vorbehalt des Gesetzes).", "obersatz"),
    satz("In Betracht kommt § … .", "subsumtion"),
    punkt("II. Formelle Rechtmäßigkeit"),
    satz("Die Behörde müsste zuständig gewesen sein sowie Verfahren (insbesondere Anhörung, § 28 I VwVfG) und Form eingehalten haben.", "obersatz"),
    satz("Hier … .", "subsumtion"),
    satz("Der Verwaltungsakt ist formell rechtmäßig.", "ergebnis"),
    punkt("III. Materielle Rechtmäßigkeit"),
    punkt("1. Tatbestandsvoraussetzungen der Ermächtigungsgrundlage"),
    ...vierSchritte(),
    punkt("2. Rechtsfolge: Ermessen und Verhältnismäßigkeit"),
    satz("Die Behörde müsste ihr Ermessen fehlerfrei ausgeübt haben (§ 40 VwVfG, § 114 S. 1 VwGO); die Maßnahme müsste verhältnismäßig sein.", "obersatz"),
    satz("Hier … .", "subsumtion"),
    satz("Der Verwaltungsakt ist materiell rechtmäßig / rechtswidrig.", "ergebnis"),
    punkt("IV. Rechtsverletzung"),
    satz("Als Adressat eines belastenden Verwaltungsakts ist … jedenfalls in seinem Grundrecht aus Art. 2 I GG verletzt.", "subsumtion"),
    stufe(3, "C. Ergebnis", g),
    satz("Die Klage ist zulässig und begründet und hat daher Erfolg.", "ergebnis"),
  ];
}

function oeffVb(): PMNode[] {
  const g = "oeff";
  const kurz = (label: string, obersatz: string, ergebnis: string) => [punkt(label), satz(obersatz, "obersatz"), satz("Hier … .", "subsumtion"), satz(ergebnis, "ergebnis")];
  return [
    satz("Die Verfassungsbeschwerde des … hat Erfolg, soweit sie zulässig und begründet ist.", "obersatz"),
    stufe(3, "A. Zulässigkeit", g),
    ...kurz("I. Zuständigkeit des BVerfG", "Das BVerfG entscheidet über Verfassungsbeschwerden (Art. 93 I Nr. 4a GG, §§ 13 Nr. 8a, 90 ff. BVerfGG).", "Das BVerfG ist zuständig."),
    ...kurz("II. Beschwerdefähigkeit", "… müsste als „jedermann“ Träger von Grundrechten sein (Art. 93 I Nr. 4a GG, § 90 I BVerfGG).", "… ist beschwerdefähig."),
    ...kurz("III. Beschwerdegegenstand", "Tauglicher Beschwerdegegenstand ist jeder Akt öffentlicher Gewalt (§ 90 I BVerfGG).", "Ein tauglicher Beschwerdegegenstand liegt vor."),
    ...kurz("IV. Beschwerdebefugnis", "… müsste behaupten, durch den Akt möglicherweise in einem Grundrecht verletzt zu sein, und selbst, gegenwärtig und unmittelbar betroffen sein.", "… ist beschwerdebefugt."),
    ...kurz("V. Rechtswegerschöpfung und Subsidiarität", "Der Rechtsweg müsste erschöpft sein (§ 90 II 1 BVerfGG) und andere Abhilfemöglichkeiten dürften nicht bestehen.", "Rechtsweg und Subsidiarität stehen nicht entgegen."),
    ...kurz("VI. Form und Frist", "Die Verfassungsbeschwerde müsste schriftlich und begründet (§§ 23 I, 92 BVerfGG) sowie fristgerecht (§ 93 BVerfGG) erhoben werden.", "Form und Frist sind gewahrt."),
    satz("Die Verfassungsbeschwerde ist zulässig.", "ergebnis"),
    stufe(3, "B. Begründetheit", g),
    satz("Die Verfassungsbeschwerde ist begründet, soweit … durch den Akt öffentlicher Gewalt in einem Grundrecht verletzt ist.", "obersatz"),
    stufe(4, "I. Schutzbereich", g),
    ...vierSchritte("Der Schutzbereich des Art. … GG müsste persönlich und sachlich eröffnet sein.", "Art. … GG schützt … .", "Hier … .", "Der Schutzbereich ist eröffnet."),
    stufe(4, "II. Eingriff", g),
    ...vierSchritte(
      "In den Schutzbereich müsste eingegriffen worden sein.",
      "Eingriff ist jedes staatliche Handeln, das dem Einzelnen ein grundrechtlich geschütztes Verhalten ganz oder teilweise unmöglich macht.",
      "Hier … .",
      "Ein Eingriff liegt vor.",
    ),
    stufe(4, "III. Verfassungsrechtliche Rechtfertigung", g),
    satz("Der Eingriff könnte verfassungsrechtlich gerechtfertigt sein.", "obersatz"),
    punkt("1. Schranke"),
    satz("Art. … GG steht unter … .", "subsumtion"),
    punkt("2. Schranken-Schranken"),
    punkt("a) Formelle Verfassungsmäßigkeit des Gesetzes"),
    satz("Hier … .", "subsumtion"),
    punkt("b) Materielle Verfassungsmäßigkeit: Verhältnismäßigkeit"),
    satz("Das Gesetz müsste einen legitimen Zweck verfolgen und zu dessen Erreichung geeignet, erforderlich und angemessen sein.", "obersatz"),
    satz("Hier … .", "subsumtion"),
    satz("Der Eingriff ist gerechtfertigt / nicht gerechtfertigt.", "ergebnis"),
    stufe(4, "IV. Ergebnis", g),
    satz("… ist in seinem Grundrecht aus Art. … GG verletzt / nicht verletzt.", "ergebnis"),
    stufe(3, "C. Ergebnis", g),
    satz("Die Verfassungsbeschwerde ist zulässig und begründet und hat daher Erfolg.", "ergebnis"),
  ];
}

function allgemein(): PMNode[] {
  return [
    h(3, "A. …"),
    satz("… könnte … haben.", "obersatz"),
    h(4, "I. …"),
    ...vierSchritte(),
    h(4, "II. …"),
    ...vierSchritte(),
    h(3, "B. Ergebnis"),
    satz("Somit … .", "ergebnis"),
  ];
}

/** Vollständige Gutachten-Notiz für ein Rechtsgebiet. */
export function gutachtenDoc(title: string, art: GutachtenArt): PMNode {
  const body = { zivil, straf, "oeff-klage": oeffKlage, "oeff-vb": oeffVb, allgemein }[art]();
  return doc(
    ...kopf(title, art),
    ...body,
    hinweis("Standardaufbau zur Orientierung – Aufbau und Schwerpunkte können je nach Lehrstuhl abweichen. Unproblematisches knapp im Urteilsstil, Problematisches ausführlich im Gutachtenstil."),
  );
}
