/**
 * Mark „gutachten“: Textstelle als Obersatz, Definition, Subsumtion oder
 * Ergebnis – farbig hinterlegt und unterstrichen (siehe lib/gutachtenstil.ts).
 * Befehle zum Markieren, Entfernen und automatischen Einfärben; in Notizen der
 * Art „Fall / Gutachten“ wird eingefügter Text automatisch eingefärbt.
 */
import { Mark, mergeAttributes } from "@tiptap/core";
import type { Node as PMNodeType } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";

import { einfaerben, isSchritt, type GutachtenSchritt } from "../../lib/gutachtenstil";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    gutachten: {
      /** Auswahl als Schritt markieren. */
      setGutachten: (step: GutachtenSchritt) => ReturnType;
      /** Gutachten-Farben in der Auswahl (bzw. der ganzen Notiz) entfernen. */
      unsetGutachten: () => ReturnType;
      /** Sätze der Auswahl (bzw. der ganzen Notiz) automatisch zuordnen. */
      colorizeGutachten: () => ReturnType;
    };
  }
  interface Storage {
    gutachten: { autoPaste: boolean };
  }
}

/** Textblöcke, die eingefärbt werden (keine Überschriften, Code oder Tabellenköpfe). */
const COLORIZABLE = new Set(["paragraph"]);
/** Gliederungen (Lösungsskizze) und Tabellenköpfe bleiben ungefärbt. */
const SKIP_PARENTS = new Set(["tableHeader", "listItem", "taskItem"]);

/** Hinweise (ganz kursiv) und reine Platzhalter („…“) werden nicht eingefärbt. */
function isHint(node: PMNodeType): boolean {
  if (!/[A-Za-zÄÖÜäöüß]/.test(node.textContent)) return true;
  let texts = 0;
  let italic = 0;
  node.forEach((c) => {
    if (!c.isText || !c.text?.trim()) return;
    texts++;
    if (c.marks.some((m) => m.type.name === "italic")) italic++;
  });
  return texts > 0 && italic === texts;
}

/**
 * Färbt alle Sätze der Absätze zwischen from und to neu ein. Ganze Absätze
 * werden betrachtet, damit Satzgrenzen stimmen. Eingefügter Text (`pasted`)
 * wird immer eingefärbt, sonst bleiben Hinweise und Listen ausgenommen. Gibt die Zahl der Sätze zurück.
 */
export function colorizeRange(tr: Transaction, from: number, to: number, opts: { pasted?: boolean } = {}): number {
  const type = tr.doc.type.schema.marks.gutachten;
  if (!type) return 0;
  let count = 0;
  const blocks: { node: PMNodeType; pos: number }[] = [];
  tr.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (node.type.name === "heading" || node.type.name === "codeBlock") return false;
    if (node.isTextblock) {
      if (COLORIZABLE.has(node.type.name) && (opts.pasted || (!SKIP_PARENTS.has(parent?.type.name ?? "") && !isHint(node)))) blocks.push({ node, pos });
      return false;
    }
    return true;
  });
  for (const { node, pos } of blocks) {
    // Text mit Positionszuordnung (Inline-Knoten wie Fußnoten zählen als Leerstelle)
    let text = "";
    const at: number[] = [];
    node.forEach((child, offset) => {
      const base = pos + 1 + offset;
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) at.push(base + i);
        text += child.text;
      } else {
        at.push(base);
        text += " ";
      }
    });
    if (!text.trim()) continue;
    const start = pos + 1;
    const end = pos + node.nodeSize - 1;
    tr.removeMark(start, end, type);
    for (const s of einfaerben(text)) {
      tr.addMark(at[s.from]!, at[s.to - 1]! + 1, type.create({ step: s.step }));
      count++;
    }
  }
  return count;
}

export const GutachtenMark = Mark.create({
  name: "gutachten",
  inclusive: false,

  addStorage() {
    return { autoPaste: false };
  },

  addAttributes() {
    return {
      step: {
        default: "subsumtion",
        parseHTML: (el) => {
          const v = el.getAttribute("data-gs");
          return isSchritt(v) ? v : "subsumtion";
        },
        renderHTML: (attrs) => ({ "data-gs": attrs.step, class: `gs gs-${attrs.step}` }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-gs]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    const range = (state: { selection: { from: number; to: number; empty: boolean }; doc: PMNodeType }) =>
      state.selection.empty ? { from: 0, to: state.doc.content.size } : { from: state.selection.from, to: state.selection.to };
    return {
      setGutachten:
        (step) =>
        ({ commands }) =>
          commands.setMark(this.name, { step }),
      unsetGutachten:
        () =>
        ({ state, tr, dispatch }) => {
          const r = range(state);
          if (dispatch) tr.removeMark(r.from, r.to, state.schema.marks[this.name]);
          return true;
        },
      colorizeGutachten:
        () =>
        ({ state, tr, dispatch }) => {
          const r = range(state);
          if (dispatch) colorizeRange(tr, r.from, r.to);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage as { autoPaste: boolean };
    return [
      new Plugin({
        key: new PluginKey("gutachtenPaste"),
        appendTransaction(trs, _old, state) {
          if (!storage.autoPaste) return null;
          const pasted = trs.filter((t) => t.getMeta("uiEvent") === "paste" && t.docChanged);
          if (!pasted.length) return null;
          // Eingefügten Bereich im neuen Dokument bestimmen
          let from = Infinity;
          let to = -Infinity;
          for (const t of pasted)
            t.mapping.maps.forEach((map, i) =>
              map.forEach((_a, _b, nFrom, nTo) => {
                const rest = t.mapping.slice(i + 1);
                from = Math.min(from, rest.map(nFrom, -1));
                to = Math.max(to, rest.map(nTo, 1));
              }),
            );
          if (!(to > from)) return null;
          const tr = state.tr;
          // Nur einfärben, wenn der eingefügte Text noch keine Gutachten-Farben trägt (z. B. aus einer anderen Notiz)
          let colored = false;
          state.doc.nodesBetween(from, Math.min(to, state.doc.content.size), (n) => {
            if (n.marks.some((m) => m.type.name === "gutachten")) colored = true;
            return !colored;
          });
          if (colored) return null;
          return colorizeRange(tr, from, Math.min(to, state.doc.content.size), { pasted: true }) ? tr : null;
        },
      }),
    ];
  },
});
