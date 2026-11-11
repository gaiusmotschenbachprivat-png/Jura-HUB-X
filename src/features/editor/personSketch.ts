/**
 * Personenskizze als Baustein im Text (Knoten `personSketch`, Daten als JSON
 * im Attribut). Antippen öffnet den Skizzen-Editor (Ereignis an die Mitschrift).
 */
import { Node, mergeAttributes } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

import { emptySketch, parseSketch, sketchFromText, sketchSpec, type Sketch } from "../../lib/personenskizze";

export const SKETCH_EDIT_EVENT = "studium:edit-sketch";
export interface SketchEditDetail {
  pos: number;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    personSketch: {
      /** Skizze hinter dem aktuellen Absatz einfügen (leer oder vorgegeben) */
      insertPersonSketch: (sketch?: Sketch) => ReturnType;
      /** Skizze aus markierten Zeilen der Kurzschreibweise („A —§ 433 I BGB→ G“) */
      personSketchFromSelection: () => ReturnType;
    };
  }
}

export const PersonSketch = Node.create({
  name: "personSketch",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      data: {
        default: JSON.stringify(emptySketch()),
        parseHTML: (el) => el.getAttribute("data-sketch") || JSON.stringify(emptySketch()),
        renderHTML: (a) => ({ "data-sketch": a.data }),
      },
    };
  },

  parseHTML: () => [{ tag: "figure.person-sketch[data-sketch]" }],

  renderHTML({ node, HTMLAttributes }) {
    const s = parseSketch(node.attrs.data);
    return ["figure", mergeAttributes(HTMLAttributes, { class: "person-sketch", "data-label": "Personenskizze" }), sketchSpec(s) as never];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("figure");
      dom.className = "person-sketch is-editable";
      dom.setAttribute("data-label", "Personenskizze");
      const draw = (data: string) => {
        dom.replaceChildren();
        const s = parseSketch(data);
        dom.appendChild(DOMSerializer.renderSpec(document, sketchSpec(s) as never).dom);
        const hint = document.createElement("figcaption");
        hint.className = "ps-hint";
        hint.textContent = s.persons.length ? "Antippen zum Bearbeiten" : "Leere Personenskizze – antippen, um Personen und Ansprüche einzutragen";
        dom.appendChild(hint);
      };
      draw(node.attrs.data);
      const openEditor = (e: Event) => {
        e.preventDefault();
        if (!editor.isEditable) return;
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (typeof pos === "number") dom.dispatchEvent(new CustomEvent<SketchEditDetail>(SKETCH_EDIT_EVENT, { bubbles: true, detail: { pos } }));
      };
      dom.addEventListener("click", openEditor);
      return {
        dom,
        update: (n) => {
          if (n.type.name !== "personSketch") return false;
          draw(n.attrs.data);
          return true;
        },
        stopEvent: (e) => e.type === "click" || e.type === "mousedown",
        ignoreMutation: () => true,
      };
    };
  },

  addCommands() {
    return {
      insertPersonSketch:
        (sketch) =>
        ({ state, tr, dispatch }) => {
          const { $to } = state.selection;
          const at = $to.depth ? $to.after(1) : $to.pos;
          if (dispatch) {
            tr.insert(at, state.schema.nodes.personSketch!.create({ data: JSON.stringify(sketch ?? emptySketch()) }));
            tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.doc.content.size, at + 1))));
            tr.scrollIntoView();
          }
          return true;
        },
      personSketchFromSelection:
        () =>
        ({ state, commands }) => {
          const { from, to, empty } = state.selection;
          if (empty) return false;
          const s = sketchFromText(state.doc.textBetween(from, to, "\n", "\n"));
          if (!s.relations.length) return false;
          return commands.insertPersonSketch(s);
        },
    };
  },
});
