/**
 * „Zum Wiederholen“: Bereich in Mitschriften (Überschrift „Zum Wiederholen“,
 * „Wiederholen“ oder „Wiederholung“). Jeder Listenpunkt bzw. Absatz darunter
 * ist ein Eintrag – bis zur nächsten Überschrift gleicher oder höherer Ebene.
 * Die Sammlung „Zum Wiederholen“ führt die Einträge aller Mitschriften zusammen.
 */
import type { PMNode } from "./pm";

export interface ReviewItem {
  text: string;
  /** abgehakt (nur bei Checklisten) */
  done: boolean;
  /** Einrückung in verschachtelten Listen (0 = oberste Ebene) */
  depth: number;
}

export const REVIEW_HEADING = /^(?:zum\s+)?wiederhol(?:en|ung)\b/i;

const inline = (n: PMNode): string => (n.type === "text" ? (n.text ?? "") : n.type === "hardBreak" ? " " : (n.content ?? []).map(inline).join(""));
export const normText = (s: string) => s.replace(/\s+/g, " ").trim();
/** Platzhalter der Vorlage („…“) zählt nicht */
const isPlaceholder = (t: string) => !t || /^[.…\s]+$/.test(t);

function collect(n: PMNode, depth: number, out: ReviewItem[], done = false) {
  switch (n.type) {
    case "paragraph": {
      const t = normText(inline(n));
      if (!isPlaceholder(t)) out.push({ text: t, done, depth });
      return;
    }
    case "listItem":
    case "taskItem": {
      const d = n.type === "taskItem" ? !!n.attrs?.checked : done;
      // eigener Text des Punkts als ein Eintrag, Unterpunkte eingerückt
      const own = normText((n.content ?? []).filter((c) => c.type === "paragraph").map(inline).join(" "));
      if (!isPlaceholder(own)) out.push({ text: own, done: d, depth });
      for (const c of n.content ?? []) if (c.type !== "paragraph") collect(c, depth + 1, out, d);
      return;
    }
    case "heading":
    case "image":
    case "horizontalRule":
      return;
    default:
      for (const c of n.content ?? []) collect(c, depth, out, done);
  }
}

/** Einträge unter „Zum Wiederholen“ einer Mitschrift (alle solchen Bereiche, in Reihenfolge). */
export function reviewItemsOf(doc: PMNode): ReviewItem[] {
  const out: ReviewItem[] = [];
  const walk = (blocks: PMNode[]) => {
    let level = 0;
    for (const n of blocks) {
      if (n.type === "heading") {
        const l = Number(n.attrs?.level) || 1;
        if (REVIEW_HEADING.test(normText(inline(n)))) level = l;
        else if (level && l <= level) level = 0;
        continue;
      }
      if (level) collect(n, 0, out);
      // Bereiche können auch in Kästen o. Ä. stehen
      else if (n.content && n.type !== "paragraph") walk(n.content);
    }
  };
  walk(doc.content ?? []);
  return out;
}

/** Text der Einträge für die Zwischenablage (eingerückte Liste je Mitschrift). */
export function reviewListText(groups: { title: string; items: ReviewItem[] }[]): string {
  return groups
    .map((g) => [g.title, ...g.items.map((i) => `${"  ".repeat(i.depth + 1)}${i.done ? "☑" : "–"} ${i.text}`)].join("\n"))
    .join("\n\n");
}
