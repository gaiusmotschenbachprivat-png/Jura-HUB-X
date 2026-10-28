/**
 * Bausteine für den Gutachtenstil und das Einfügen von Prüfungsschemata in
 * eine Notiz. Platzhalter sind „…“ – nach dem Einfügen wird der erste markiert,
 * sodass man ihn direkt überschreiben kann.
 */
import type { SchemaItem } from "../api/types";
import { gliederung } from "./gliederung";
import { gebietInfo, isProblem, PROBLEM, RECHTSGEBIETE, stageColor, type Rechtsgebiet } from "./schemaLibrary";
import { gs } from "./gutachtenstil";
import { b, i, p, type PMNode } from "./pm";

export const PLACEHOLDER = "…";

export type BausteinGruppe = "zivil" | "straf" | "oeff" | "allgemein";

export interface Baustein {
  id: string;
  label: string;
  group: BausteinGruppe;
  build: () => PMNode[];
}

export const BAUSTEIN_GRUPPEN: { id: BausteinGruppe; label: string; color?: string }[] = [
  ...RECHTSGEBIETE.map((g) => ({ id: g.id as BausteinGruppe, label: g.label, color: g.color })),
  { id: "allgemein", label: "Für jedes Gutachten" },
];

const para = (text: string) => p(text);
/** Gliederungspunkt in der Farbe seiner Prüfungsstufe (wie in den Schemata). */
const stufe = (label: string, gebiet: Rechtsgebiet) => p({ type: "text", text: label, marks: [{ type: "bold" }, { type: "textStyle", attrs: { color: stageColor(gebiet, label.replace(/^[A-Z]+\.\s*|^[IVX]+\.\s*|^\d+\.\s*/, "")) } }] });

export const BAUSTEINE: Baustein[] = [
  // Zivilrecht
  { id: "obersatz-zivil", label: "Obersatz Zivilrecht (Anspruch)", group: "zivil", build: () => [p(gs("… könnte gegen … einen Anspruch auf … aus § … haben.", "obersatz"))] },
  {
    id: "anspruchsaufbau",
    label: "Anspruchsaufbau: entstanden – untergegangen – durchsetzbar",
    group: "zivil",
    build: () => [
      para("… könnte gegen … einen Anspruch auf … aus § … BGB haben."),
      stufe("I. Anspruch entstanden", "zivil"),
      para("…"),
      stufe("II. Anspruch nicht untergegangen", "zivil"),
      para("…"),
      stufe("III. Anspruch durchsetzbar", "zivil"),
      para("…"),
      p(b("Ergebnis: "), "… hat gegen … einen Anspruch auf … aus § … BGB."),
    ],
  },
  {
    id: "willenserklaerung",
    label: "Willenserklärung prüfen",
    group: "zivil",
    build: () => [
      para("Fraglich ist, ob … eine wirksame Willenserklärung abgegeben hat."),
      p(b("Objektiver Tatbestand: "), "Aus Sicht eines objektiven Empfängers (§§ 133, 157 BGB) … ."),
      p(b("Subjektiver Tatbestand: "), "Handlungswille, Erklärungsbewusstsein und Geschäftswille … ."),
      p(b("Abgabe und Zugang: "), "… (§ 130 I 1 BGB)."),
    ],
  },
  { id: "ergebnis", label: "Ergebnis Zivilrecht", group: "zivil", build: () => [p(gs("… hat gegen … einen Anspruch auf … aus § … .", "ergebnis"))] },
  // Strafrecht
  {
    id: "obersatz-straf",
    label: "Obersatz Strafrecht",
    group: "straf",
    build: () => [p(gs("… könnte sich wegen … gemäß § … StGB strafbar gemacht haben, indem … .", "obersatz"))],
  },
  {
    id: "deliktsaufbau",
    label: "Deliktsaufbau: Tatbestand – Rechtswidrigkeit – Schuld",
    group: "straf",
    build: () => [
      para("… könnte sich wegen … gemäß § … StGB strafbar gemacht haben, indem … ."),
      stufe("I. Tatbestand", "straf"),
      p(b("1. Objektiver Tatbestand")),
      para("…"),
      p(b("2. Subjektiver Tatbestand")),
      para("… handelte vorsätzlich, … ."),
      stufe("II. Rechtswidrigkeit", "straf"),
      para("Rechtfertigungsgründe sind nicht ersichtlich; … handelte rechtswidrig."),
      stufe("III. Schuld", "straf"),
      para("… handelte auch schuldhaft."),
      p(b("IV. Ergebnis: "), "… hat sich wegen … gemäß § … StGB strafbar gemacht."),
    ],
  },
  {
    id: "rw-schuld-kurz",
    label: "Rechtswidrigkeit und Schuld (unproblematisch)",
    group: "straf",
    build: () => [para("… handelte mangels Rechtfertigungs- und Entschuldigungsgründen rechtswidrig und schuldhaft. …")],
  },
  {
    id: "konkurrenzen",
    label: "Konkurrenzen und Gesamtergebnis",
    group: "straf",
    build: () => [
      stufe("Konkurrenzen", "straf"),
      para("Die Taten stehen zueinander in Tateinheit (§ 52 StGB) / Tatmehrheit (§ 53 StGB), weil … ."),
      stufe("Gesamtergebnis", "straf"),
      para("… ist strafbar gemäß … ."),
    ],
  },
  // Öffentliches Recht
  {
    id: "obersatz-oeff",
    label: "Obersatz Öffentliches Recht (Klage)",
    group: "oeff",
    build: () => [p(gs("Die Klage des … hat Erfolg, soweit sie zulässig und begründet ist.", "obersatz"))],
  },
  {
    id: "obersatz-vb",
    label: "Obersatz Verfassungsbeschwerde",
    group: "oeff",
    build: () => [p(gs("Die Verfassungsbeschwerde des … hat Erfolg, soweit sie zulässig und begründet ist.", "obersatz"))],
  },
  {
    id: "zulaessig-begruendet",
    label: "Zulässigkeit – Begründetheit",
    group: "oeff",
    build: () => [
      stufe("A. Zulässigkeit", "oeff"),
      para("…"),
      stufe("B. Begründetheit", "oeff"),
      para("…"),
      p(b("C. Ergebnis: "), "Die … ist zulässig und begründet und hat daher Erfolg."),
    ],
  },
  {
    id: "grundrechtspruefung",
    label: "Grundrechtsprüfung: Schutzbereich – Eingriff – Rechtfertigung",
    group: "oeff",
    build: () => [
      stufe("I. Schutzbereich", "oeff"),
      para("…"),
      stufe("II. Eingriff", "oeff"),
      para("…"),
      stufe("III. Verfassungsrechtliche Rechtfertigung", "oeff"),
      para("…"),
      p(b("IV. Ergebnis: "), "… ist in seinem Grundrecht aus Art. … GG verletzt / nicht verletzt."),
    ],
  },
  {
    id: "verhaeltnismaessigkeit",
    label: "Verhältnismäßigkeit",
    group: "oeff",
    build: () => [
      para("Der Eingriff müsste verhältnismäßig sein."),
      p(b("1. Legitimer Zweck: "), "… ."),
      p(b("2. Geeignetheit: "), "… ."),
      p(b("3. Erforderlichkeit: "), "Ein milderes, gleich wirksames Mittel … ."),
      p(b("4. Angemessenheit: "), "… ."),
    ],
  },
  // für jedes Gutachten
  {
    id: "vier-schritte",
    label: "Obersatz – Definition – Subsumtion – Ergebnis (farbig)",
    group: "allgemein",
    build: () => [p(gs("Dazu müsste … vorliegen.", "obersatz")), p(gs("… ist … .", "definition")), p(gs("Hier … .", "subsumtion")), p(gs("Somit liegt … vor.", "ergebnis"))],
  },
  { id: "voraussetzung", label: "Voraussetzung („Dazu müsste …“)", group: "allgemein", build: () => [p(gs("Dazu müsste … vorliegen.", "obersatz"))] },
  { id: "definition", label: "Definition", group: "allgemein", build: () => [p(gs("… ist … .", "definition"))] },
  { id: "subsumtion", label: "Subsumtion", group: "allgemein", build: () => [p(gs("Hier … .", "subsumtion"))] },
  {
    id: "streit",
    label: "Streitstand",
    group: "allgemein",
    build: () => [
      para("Fraglich ist, ob … ."),
      p(b("Eine Ansicht "), "… . Danach … ."),
      p(b("Nach anderer Ansicht "), "… . Danach … ."),
      para("Die Ansichten kommen zu unterschiedlichen Ergebnissen, sodass ein Streitentscheid erforderlich ist."),
      p(b("Stellungnahme: "), "Für … spricht … . Gegen … spricht … . Daher ist … zu folgen."),
    ],
  },
  { id: "zwischenergebnis", label: "Zwischenergebnis", group: "allgemein", build: () => [p(gs("Folglich liegt … vor.", "ergebnis"))] },
];

export function bausteinById(id: string): Baustein | undefined {
  return BAUSTEINE.find((x) => x.id === id);
}

const colored = (text: string, color: string, extra: { type: string }[] = []) => ({ type: "text", text, marks: [...extra, { type: "textStyle", attrs: { color } }] });
const PROBLEM_COLOR = "#b4471f";

/**
 * Prüfungsschema als Gliederung in der Notiz: Ebenen A./I./1. als Überschriften,
 * tiefere Ebenen als fette Absätze mit Einzug. Hinweise kursiv darunter.
 * Mit `gebiet` farbig: Titel in der Farbe des Rechtsgebiets, Prüfungsstufen
 * (Tatbestand, Rechtswidrigkeit, Schuld …) in ihrer Stufenfarbe, „(P)“-Punkte
 * als Klausurproblem hervorgehoben.
 */
export function schemaToNodes(o: { title: string; norm?: string; items: SchemaItem[]; space?: boolean; gebiet?: Rechtsgebiet | null; notes?: string }): PMNode[] {
  const out: PMNode[] = [];
  const titleText = o.norm ? `${o.title} (${o.norm})` : o.title;
  const color = o.gebiet !== undefined;
  out.push({ type: "heading", attrs: { level: 2 }, content: [color && o.gebiet ? colored(titleText, gebietInfo(o.gebiet).color) : { type: "text", text: titleText }] });
  const walk = (items: SchemaItem[], depth: number, stage: string | null) => {
    // (P)-Punkte zählen nicht mit, damit die Gliederung lückenlos bleibt
    let n = 0;
    items.forEach((it) => {
      const problem = isProblem(it.text);
      if (!problem) n++;
      const text = problem ? it.text.replace(PROBLEM, "") || "…" : it.text || "…";
      const label = problem ? text : `${gliederung(depth, Math.max(1, n))} ${text}`;
      const tone = depth === 0 ? (problem ? PROBLEM_COLOR : stageColor(o.gebiet ?? null, it.text)) : stage;
      const indent = Math.min(8, Math.max(0, depth - 1));
      if (problem) {
        // „P“ als Marke, Text kursiv in der Problemfarbe
        const content = color ? [colored("(P) ", PROBLEM_COLOR, [{ type: "bold" }]), colored(label, PROBLEM_COLOR, [{ type: "italic" }])] : [b("(P) "), i(label)];
        out.push(depth <= 1 ? { type: "heading", attrs: { level: depth + 3 }, content } : { type: "paragraph", attrs: { indent }, content });
      } else if (depth <= 1) {
        out.push({ type: "heading", attrs: { level: depth + 3 }, content: [color && tone ? colored(label, tone) : { type: "text", text: label }] });
      } else out.push({ type: "paragraph", attrs: { indent }, content: [b(label)] });
      if (it.note) out.push({ type: "paragraph", attrs: { indent }, content: [i(it.note)] });
      if (it.children.length) walk(it.children, depth + 1, tone);
      else if (o.space !== false && !problem) out.push({ type: "paragraph", attrs: { indent } });
    });
  };
  walk(o.items, 0, null);
  if (o.notes) out.push({ type: "paragraph", content: [i(o.notes)] });
  return out;
}
