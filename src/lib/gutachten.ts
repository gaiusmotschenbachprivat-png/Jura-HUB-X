/**
 * Bausteine für den Gutachtenstil und das Einfügen von Prüfungsschemata in
 * eine Notiz. Platzhalter sind „…“ – nach dem Einfügen wird der erste markiert,
 * sodass man ihn direkt überschreiben kann.
 */
import type { SchemaItem } from "../api/types";
import { gliederung } from "./gliederung";
import { b, i, p, type PMNode } from "./pm";

export const PLACEHOLDER = "…";

export interface Baustein {
  id: string;
  label: string;
  group: "Obersatz" | "Prüfung" | "Abschluss";
  build: () => PMNode[];
}

const para = (text: string) => p(text);

export const BAUSTEINE: Baustein[] = [
  { id: "obersatz-zivil", label: "Obersatz Zivilrecht (Anspruch)", group: "Obersatz", build: () => [para("… könnte gegen … einen Anspruch auf … aus § … haben.")] },
  {
    id: "obersatz-straf",
    label: "Obersatz Strafrecht",
    group: "Obersatz",
    build: () => [para("… könnte sich wegen … gemäß § … StGB strafbar gemacht haben, indem … .")],
  },
  {
    id: "obersatz-oeff",
    label: "Obersatz Öffentliches Recht (Klage)",
    group: "Obersatz",
    build: () => [para("Die Klage des … hat Erfolg, soweit sie zulässig und begründet ist.")],
  },
  { id: "voraussetzung", label: "Voraussetzung („Dazu müsste …“)", group: "Prüfung", build: () => [para("Dazu müsste … vorliegen.")] },
  { id: "definition", label: "Definition", group: "Prüfung", build: () => [para("… ist … .")] },
  { id: "subsumtion", label: "Subsumtion", group: "Prüfung", build: () => [para("Hier … . ")] },
  {
    id: "streit",
    label: "Streitstand",
    group: "Prüfung",
    build: () => [
      para("Fraglich ist, ob … ."),
      p(b("Eine Ansicht "), "… . Danach … ."),
      p(b("Nach anderer Ansicht "), "… . Danach … ."),
      para("Die Ansichten kommen zu unterschiedlichen Ergebnissen, sodass ein Streitentscheid erforderlich ist."),
      p(b("Stellungnahme: "), "Für … spricht … . Gegen … spricht … . Daher ist … zu folgen."),
    ],
  },
  { id: "zwischenergebnis", label: "Zwischenergebnis", group: "Abschluss", build: () => [para("Folglich liegt … vor.")] },
  { id: "ergebnis", label: "Ergebnis", group: "Abschluss", build: () => [p(b("Ergebnis: "), "… hat gegen … einen Anspruch auf … aus § … .")] },
];

export function bausteinById(id: string): Baustein | undefined {
  return BAUSTEINE.find((x) => x.id === id);
}

/**
 * Prüfungsschema als Gliederung in der Notiz: Ebenen A./I./1. als Überschriften,
 * tiefere Ebenen als fette Absätze mit Einzug. Hinweise kursiv darunter.
 */
export function schemaToNodes(o: { title: string; norm?: string; items: SchemaItem[]; space?: boolean }): PMNode[] {
  const out: PMNode[] = [];
  out.push({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: o.norm ? `${o.title} (${o.norm})` : o.title }] });
  const walk = (items: SchemaItem[], depth: number) => {
    items.forEach((it, idx) => {
      const label = `${gliederung(depth, idx + 1)} ${it.text || "…"}`;
      if (depth <= 1) out.push({ type: "heading", attrs: { level: depth + 3 }, content: [{ type: "text", text: label }] });
      else out.push({ type: "paragraph", attrs: { indent: Math.min(8, depth - 1) }, content: [b(label)] });
      if (it.note) out.push({ type: "paragraph", attrs: { indent: Math.min(8, Math.max(0, depth - 1)) }, content: [i(it.note)] });
      if (it.children.length) walk(it.children, depth + 1);
      else if (o.space !== false) out.push({ type: "paragraph", attrs: { indent: Math.min(8, Math.max(0, depth - 1)) } });
    });
  };
  walk(o.items, 0);
  return out;
}
