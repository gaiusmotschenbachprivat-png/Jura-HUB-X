/** Absatz mit einem bestimmten Text finden (für Sprünge aus Sammlungen wie „Zum Wiederholen“). */
import type { Node as PMNodeType } from "@tiptap/pm/model";

import { normText, REVIEW_HEADING } from "../../lib/wiederholen";

/** Position des Absatzes, dessen Text passt – im Bereich „Zum Wiederholen“ bevorzugt, sonst irgendwo. */
export function findTextBlock(doc: PMNodeType, text: string): number | null {
  const want = normText(text);
  let inSection: number | null = null;
  let anywhere: number | null = null;
  let level = 0;
  doc.descendants((n, pos, parent) => {
    if (inSection !== null) return false;
    if (n.type.name === "heading") {
      const l = Number(n.attrs.level) || 1;
      if (REVIEW_HEADING.test(normText(n.textContent))) level = l;
      else if (level && l <= level) level = 0;
      return false;
    }
    if (!n.isTextblock) return true;
    const t = normText(n.textContent);
    const hit = t && (t === want || (want.startsWith(t) && parent?.type.name !== "doc"));
    if (hit) {
      if (level) inSection = pos;
      else anywhere ??= pos;
    }
    return false;
  });
  return inSection ?? anywhere;
}
