/**
 * Schreibstelle sichtbar halten – nur im Textbereich (.note-scroll).
 * ProseMirror verschiebt sonst jeden umgebenden Bereich bis hin zum Fenster;
 * auf dem iPad schob das bei jedem Zeilenwechsel die ganze App, die sofort
 * wieder zurückgesetzt wurde (lib/viewportGuard.ts) – das Dokument „wackelte“.
 */
import type { EditorView } from "@tiptap/pm/view";

/** Abstand der Schreibstelle zum oberen/unteren Rand (unten: Kurzbefehlsleiste der iPad-Tastatur) */
export const CARET_MARGIN = { top: 40, bottom: 96 };

export function scrollCaretIntoView(view: EditorView, scroller: HTMLElement, margin = CARET_MARGIN): void {
  let c: { top: number; bottom: number };
  try {
    c = view.coordsAtPos(view.state.selection.head);
  } catch {
    return;
  }
  const r = scroller.getBoundingClientRect();
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  const visTop = Math.max(r.top, vv ? vv.offsetTop : 0);
  const visBottom = Math.min(r.bottom, vv ? vv.offsetTop + vv.height : r.bottom);
  const room = visBottom - visTop;
  // bei kleinem Bereich (geteilte Ansicht, Tastatur) Abstände verkleinern
  const top = Math.min(margin.top, room / 4);
  const bottom = Math.min(margin.bottom, room / 3);
  if (c.bottom > visBottom - bottom) scroller.scrollTop += Math.ceil(c.bottom - (visBottom - bottom));
  else if (c.top < visTop + top) scroller.scrollTop -= Math.ceil(visTop + top - c.top);
}

/** ProseMirror-Eigenschaft: eigene Regel statt Verschieben aller umgebenden Bereiche */
export function handleScrollToSelection(view: EditorView): boolean {
  const scroller = (view.dom as HTMLElement).closest(".note-scroll") as HTMLElement | null;
  if (!scroller) return false;
  scrollCaretIntoView(view, scroller);
  return true;
}
