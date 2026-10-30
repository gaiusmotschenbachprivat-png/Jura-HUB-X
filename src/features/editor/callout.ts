/**
 * Farbige Kästen im Skript: Beispiel, Gesetzestext, Definition, Fall, Merke,
 * Problem/Streitstand, Hinweis – Arten anpassbar und ergänzbar (lib/callouts).
 * Ein Kasten umschließt beliebige Absätze, Listen usw.; oben steht eine kleine
 * Beschriftung (antippen → Art ändern, Überschrift ergänzen, verbinden, Kasten
 * auflösen). „Verbunden“ (`joined`) schließt ohne Lücke an den Kasten darüber an.
 */
import { Node, mergeAttributes } from "@tiptap/core";

import { calloutAttrs, calloutInfo, calloutLabel, CALLOUTS, CALLOUTS_CHANGED, type CalloutKind } from "../../lib/callouts";

const BUILTIN_KINDS = new Set(CALLOUTS.map((c) => c.kind));

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
        renderHTML: (a) => ({ "data-callout": calloutInfo(a.kind, a).kind }),
      },
      title: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-title") || "",
        renderHTML: (a) => (a.title ? { "data-title": String(a.title).slice(0, 120) } : {}),
      },
      // Bezeichnung und Farbe einer eigenen Art (sonst leer)
      label: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-kind-label") || "",
        renderHTML: (a) => (a.label ? { "data-kind-label": String(a.label).slice(0, 40) } : {}),
      },
      color: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-kind-color") || "",
        renderHTML: (a) => (/^#[0-9a-f]{6}$/i.test(String(a.color)) ? { "data-kind-color": a.color } : {}),
      },
      /** schließt ohne Lücke an den Kasten darüber an */
      joined: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-joined") === "1",
        renderHTML: (a) => (a.joined ? { "data-joined": "1" } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    // Beschriftung als Attribut: Druck/Vorschau zeigen sie per CSS an
    const info = calloutInfo(node.attrs.kind, node.attrs);
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        class: `callout callout-${BUILTIN_KINDS.has(info.kind) ? info.kind : "eigen"}${node.attrs.joined ? " is-joined" : ""}`,
        style: `--c: ${info.color}; --f: #${info.fill}`,
        "data-label": calloutLabel(node.attrs.kind, node.attrs.title, node.attrs),
      }),
      0,
    ];
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
      let current = node;
      const render = (n: typeof node) => {
        current = n;
        const info = calloutInfo(n.attrs.kind, n.attrs);
        dom.className = `callout callout-${BUILTIN_KINDS.has(info.kind) ? info.kind : "eigen"}${n.attrs.joined ? " is-joined" : ""}`;
        dom.style.setProperty("--c", info.color);
        dom.setAttribute("data-callout", info.kind);
        const label = calloutLabel(n.attrs.kind, n.attrs.title, n.attrs);
        head.textContent = label;
        head.setAttribute("aria-label", `${label} – Kasten bearbeiten`);
      };
      render(node);
      // Arten wurden umbenannt/umgefärbt: sofort neu zeichnen
      const onChange = () => render(current);
      window.addEventListener(CALLOUTS_CHANGED, onChange);
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
        ignoreMutation: (m) => head.contains(m.target as globalThis.Node) || (m.type === "attributes" && m.target === dom),
        stopEvent: (e) => head.contains(e.target as globalThis.Node),
        destroy: () => window.removeEventListener(CALLOUTS_CHANGED, onChange),
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
              tr.setNodeMarkup($from.before(d), undefined, { ...$from.node(d).attrs, ...calloutAttrs(kind) });
              return true;
            });
          }
          return commands.wrapIn(this.name, calloutAttrs(kind));
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
