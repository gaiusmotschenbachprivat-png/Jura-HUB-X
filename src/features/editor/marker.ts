/**
 * Textmarker mit Plätzen (lib/highlights): die Markierung speichert Farbe und
 * Platz; dargestellt wird über `--hl`, damit Farbänderungen eines Platzes
 * sofort überall gelten und der dunkle Modus die Farbe lesbar abdunkeln kann.
 */
import Highlight from "@tiptap/extension-highlight";

import { highlightColor, highlightLabel, highlightSlots, slotOf } from "../../lib/highlights";

export const Marker = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-color") || el.style.backgroundColor || null,
        renderHTML: () => ({}),
      },
      slot: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-hl") || null,
        renderHTML: () => ({}),
      },
    };
  },
  addKeyboardShortcuts() {
    // ⌘⇧H: mit der ersten Markerfarbe
    return {
      "Mod-Shift-h": () => {
        const first = highlightSlots()[0]!;
        return this.editor.commands.toggleHighlight({ color: first.color, slot: first.slot } as { color: string });
      },
    };
  },
  renderHTML({ mark }) {
    const { color, slot } = mark.attrs as { color: string | null; slot: string | null };
    const s = slotOf(color, slot);
    const label = highlightLabel(color, slot);
    return [
      "mark",
      {
        "data-color": color ?? highlightColor(null),
        ...(s ? { "data-hl": s } : {}),
        ...(label ? { title: label } : {}),
        style: `--hl: ${highlightColor(color, slot)}`,
      },
      0,
    ];
  },
}).configure({ multicolor: true });
