/**
 * Farbige Kästen im Skript: Beispiel, Gesetzestext, Definition, Fall, Merke,
 * Problem/Streitstand, Hinweis. Ein Kasten umschließt beliebige Absätze,
 * Listen usw.; oben steht eine kleine Beschriftung (antippen → Art ändern,
 * Überschrift ergänzen, Kasten auflösen).
 */
import { Node, mergeAttributes } from "@tiptap/core";

import { calloutInfo, calloutLabel, type CalloutKind } from "../../lib/callouts";

export const CALLOUT_EDIT_EVENT = "studium:edit-callout";
export interface CalloutEditDetail {
  pos: number;
  x: number;
  y: number;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      /** Auswahl in einen Kasten legen bzw. die Art des umgebenden Kastens ändern */
      setCallout: (kind: CalloutKind) => ReturnType;
      /** umgebenden Kasten auflösen (Inhalt bleibt) */
      unsetCallout: () => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      kind: {
        default: "beispiel",
        parseHTML: (el) => el.getAttribute("data-callout") || "beispiel",
        renderHTML: (a) => ({ "data-callout": calloutInfo(a.kind).kind }),
      },
      title: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-title") || "",
        renderHTML: (a) => (a.title ? { "data-title": String(a.title).slice(0, 120) } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    // Beschriftung als Attribut: Druck/Vorschau zeigen sie per CSS an
    return ["div", mergeAttributes(HTMLAttributes, { class: `callout callout-${calloutInfo(node.attrs.kind).kind}`, "data-label": calloutLabel(node.attrs.kind, node.attrs.title) }), 0];
  },

  addNodeView() {
    return ({ node, getPos }) => {
      const dom = document.createElement("div");
      const head = document.createElement("button");
      head.type = "button";
      head.contentEditable = "false";
      head.className = "callout-label";
      const content = document.createElement("div");
      content.className = "callout-body";
      dom.append(head, content);
      const render = (n: typeof node) => {
        const info = calloutInfo(n.attrs.kind);
        dom.className = `callout callout-${info.kind}`;
        dom.setAttribute("data-callout", info.kind);
        head.textContent = calloutLabel(n.attrs.kind, n.attrs.title);
        head.setAttribute("aria-label", `${calloutLabel(n.attrs.kind, n.attrs.title)} – Kasten bearbeiten`);
      };
      render(node);
      head.addEventListener("mousedown", (e) => e.preventDefault());
      head.addEventListener("click", (e) => {
        e.preventDefault();
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (typeof pos !== "number") return;
        const r = head.getBoundingClientRect();
        dom.dispatchEvent(new CustomEvent<CalloutEditDetail>(CALLOUT_EDIT_EVENT, { bubbles: true, detail: { pos, x: r.left, y: r.bottom } }));
      });
      return {
        dom,
        contentDOM: content,
        update: (n) => {
          if (n.type.name !== "callout") return false;
          render(n);
          return true;
        },
        ignoreMutation: (m) => head.contains(m.target as globalThis.Node),
        stopEvent: (e) => head.contains(e.target as globalThis.Node),
      };
    };
  },

  addCommands() {
    return {
      setCallout:
        (kind) =>
        ({ state, commands }) => {
          const { $from } = state.selection;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === this.name) return commands.command(({ tr }) => {
              tr.setNodeMarkup($from.before(d), undefined, { ...$from.node(d).attrs, kind });
              return true;
            });
          }
          return commands.wrapIn(this.name, { kind });
        },
      unsetCallout:
        () =>
        ({ state, tr, dispatch }) => {
          // ganzen Kasten auflösen: Inhalt bleibt an seiner Stelle
          const { $from } = state.selection;
          for (let d = $from.depth; d > 0; d--) {
            const n = $from.node(d);
            if (n.type.name !== this.name) continue;
            if (dispatch) tr.replaceWith($from.before(d), $from.after(d), n.content);
            return true;
          }
          return false;
        },
    };
  },

  addKeyboardShortcuts() {
    // Enter im leeren letzten Absatz bzw. Rücktaste am Anfang des leeren ersten: aus dem Kasten heraus
    const leave = (where: "last" | "first") => () => {
      const { $from, empty } = this.editor.state.selection;
      if (!empty || $from.parent.type.name !== "paragraph" || $from.parent.content.size > 0) return false;
      const box = $from.node($from.depth - 1);
      if (box?.type.name !== this.name) return false;
      const idx = $from.index($from.depth - 1);
      if (where === "last" ? idx !== box.childCount - 1 : idx !== 0 || box.childCount < 2) return false;
      return this.editor.commands.lift(this.name);
    };
    return { Enter: leave("last"), Backspace: leave("first") };
  },
});
