/**
 * Optionale Vorlagen. Sie geben eine Struktur vor, schreiben aber keine
 * inhaltlichen Aussagen vor. Platzhaltertexte stehen kursiv in eckigen Klammern.
 */
import { GUTACHTEN_ARTEN, gutachtenDoc } from "./gutachtenVorlagen";
import { b, doc, empty, h, hr, i, ol, p, quote, table, tasks, ul, type PMNode } from "./pm";

export interface Template {
  id: string;
  name: string;
  group: "Allgemein" | "Jura" | "Wirtschaft";
  description: string;
  build: (title: string) => PMNode;
}

const ph = (s: string) => i(`[${s}]`);

export const TEMPLATES: Template[] = [
  {
    id: "leer",
    name: "Leere Notiz",
    group: "Allgemein",
    description: "Ohne Struktur beginnen.",
    build: () => doc(empty()),
  },
  {
    id: "mitschrift",
    name: "Vorlesungsmitschrift",
    group: "Allgemein",
    description: "Datum, Gliederung, Mitschrift, offene Fragen.",
    build: (title) =>
      doc(
        h(1, title),
        p(b("Datum: "), ph("TT.MM.JJJJ"), "   ", b("Folien: "), ph("Seiten")),
        h(2, "Gliederung"),
        ol("…"),
        h(2, "Mitschrift"),
        empty(),
        h(2, "Offene Fragen"),
        tasks("…"),
        h(2, "Zum Wiederholen"),
        ul("…"),
      ),
  },
  {
    id: "zusammenfassung",
    name: "Lernzusammenfassung",
    group: "Allgemein",
    description: "Kernaussagen, Zusammenhänge, Prüfungsrelevanz.",
    build: (title) =>
      doc(h(1, title), h(2, "Kernaussagen"), ul("…"), h(2, "Zusammenhänge"), empty(), h(2, "Typische Fehler"), ul("…"), h(2, "Prüfungsrelevanz"), empty()),
  },
  {
    id: "pruefungsvorbereitung",
    name: "Prüfungsvorbereitung",
    group: "Allgemein",
    description: "Stoffübersicht, Lernplan, Selbsttest.",
    build: (title) =>
      doc(
        h(1, title),
        p(b("Prüfung: "), ph("Fach, Datum, Dauer, Hilfsmittel")),
        h(2, "Stoffübersicht"),
        table(["Thema", "Stand", "Wiederholt am"], [["", "", ""], ["", "", ""], ["", "", ""]]),
        h(2, "Lernplan"),
        tasks("…"),
        h(2, "Selbsttest"),
        ol("…"),
      ),
  },
  {
    id: "wissenschaftlich",
    name: "Wissenschaftliche Arbeit",
    group: "Allgemein",
    description: "Gliederung einer Seminar- oder Hausarbeit.",
    build: (title) =>
      doc(
        h(1, title),
        p(b("Fragestellung: "), ph("…")),
        h(2, "A. Einleitung"),
        empty(),
        h(2, "B. Hauptteil"),
        h(3, "I. …"),
        empty(),
        h(3, "II. …"),
        empty(),
        h(2, "C. Ergebnis"),
        empty(),
        h(2, "Literatur"),
        ul("…"),
      ),
  },
  {
    id: "definition",
    name: "Definition",
    group: "Jura",
    description: "Begriff, Definition, Fundstelle, Beispiel.",
    build: (title) =>
      doc(
        h(1, title),
        quote(p(ph("Definition im Wortlaut"))),
        p(b("Fundstelle: "), ph("z. B. § 133 BGB")),
        p(b("Quelle: "), ph("Vorlesung, Lehrbuch, Urteil")),
        h(2, "Erläuterung"),
        empty(),
        h(2, "Beispiel"),
        empty(),
        h(2, "Abgrenzung / verwandte Begriffe"),
        ul("…"),
      ),
  },
  {
    id: "schema",
    name: "Prüfungsschema",
    group: "Jura",
    description: "Mehrstufige Gliederung zum Ausfüllen.",
    build: (title) =>
      doc(
        h(1, title),
        p(b("Anspruchsgrundlage / Norm: "), ph("…")),
        p(i("Hinweis: Ein Schema ist eine Arbeitshilfe. Prüfe es gegen Vorlesung und Literatur.")),
        ol([p("Prüfungspunkt"), ul("Unterpunkt", "Unterpunkt")], [p("Prüfungspunkt"), ul("Unterpunkt")], "Prüfungspunkt"),
        h(2, "Probleme und Streitstände"),
        ul("…"),
      ),
  },
  ...GUTACHTEN_ARTEN.map(
    (art): Template => ({
      id: art.id === "allgemein" ? "gutachten" : `gutachten-${art.id}`,
      name: art.id === "allgemein" ? "Gutachten (allgemein)" : `Gutachten ${art.label}`,
      group: "Jura",
      description: `${art.description} Farbig: Obersatz, Definition, Subsumtion, Ergebnis.`,
      build: (title) => gutachtenDoc(title, art.id),
    }),
  ),
  {
    id: "fall",
    name: "Falllösung",
    group: "Jura",
    description: "Sachverhalt, Fallfrage, Lösungsskizze, Ausformulierung.",
    build: (title) =>
      doc(
        h(1, title),
        p(b("Rechtsgebiet: "), ph("…"), "   ", b("Schwierigkeit: "), ph("leicht / mittel / schwer")),
        h(2, "Sachverhalt"),
        empty(),
        h(2, "Fallfrage"),
        empty(),
        h(2, "Lösungsskizze"),
        ol("…"),
        h(2, "Ausformulierte Lösung"),
        empty(),
        h(2, "Lernpunkte"),
        ul("…"),
      ),
  },
  {
    id: "streitstand",
    name: "Streitstand / Meinungsübersicht",
    group: "Jura",
    description: "Problem, Ansichten mit Argumenten, Stellungnahme.",
    build: (title) =>
      doc(
        h(1, title),
        p(b("Problem: "), ph("…")),
        p(b("Relevanz: "), ph("Wann stellt sich das Problem in der Klausur?")),
        h(2, "Ansichten"),
        table(["Ansicht", "Vertreter", "Argumente", "Folge im Fall"], [["", "", "", ""], ["", "", "", ""], ["", "", "", ""]]),
        h(2, "Stellungnahme"),
        empty(),
      ),
  },
  {
    id: "wiwi-mitschrift",
    name: "WiWi-Mitschrift",
    group: "Wirtschaft",
    description: "Modelle, Annahmen, Formeln, Beispiele.",
    build: (title) =>
      doc(
        h(1, title),
        p(b("Datum: "), ph("TT.MM.JJJJ")),
        h(2, "Modell / Konzept"),
        empty(),
        h(2, "Annahmen"),
        ul("…"),
        h(2, "Formeln"),
        { type: "codeBlock", attrs: { language: "formel" }, content: [{ type: "text", text: "KW = −I₀ + Σ CFₜ / (1 + i)ᵗ" }] },
        h(2, "Beispiel"),
        empty(),
        h(2, "Offene Fragen"),
        tasks("…"),
      ),
  },
  {
    id: "wiwi-uebung",
    name: "Übungsaufgabe mit Rechenweg",
    group: "Wirtschaft",
    description: "Aufgabe, Gegeben/Gesucht, Rechenweg, Ergebnis.",
    build: (title) =>
      doc(
        h(1, title),
        h(2, "Aufgabe"),
        empty(),
        h(2, "Gegeben / Gesucht"),
        table(["Gegeben", "Wert", "Gesucht"], [["", "", ""], ["", "", ""]]),
        h(2, "Rechenweg"),
        ol("…"),
        h(2, "Ergebnis"),
        p(b("Ergebnis: "), ph("…")),
        hr(),
        h(2, "Fehlerquellen"),
        ul("…"),
      ),
  },
];

export function templateById(id: string | null | undefined): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
