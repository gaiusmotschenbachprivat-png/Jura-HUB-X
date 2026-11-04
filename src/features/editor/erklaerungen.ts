/**
 * Sprungmarken und „Begriffe & Erklärungen“ in der Mitschrift:
 *
 * - Sprungziel: jede Überschrift und jeder Absatz kann eine Kennung (`anchor`)
 *   tragen. Eine Sprungmarke (Mark `jumpLink`) an beliebiger Stelle springt
 *   dorthin; „zurück“ führt zur Ausgangsstelle.
 * - Bereich „Begriffe & Erklärungen“ (Knoten `erklaerungen`) am Ende der
 *   Mitschrift; ein im Text erklärter Begriff (Mark `termRef`) ist gepunktet
 *   unterstrichen und springt beim Antippen zu seinem Eintrag.
 */
import { Extension, Mark, Node, mergeAttributes } from "@tiptap/core";
import type { Node as PMNodeType } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";

import { parseEntry, SECTION_LABEL, sameTerm } from "../../lib/erklaerungen";
import type { PMNode } from "../../lib/pm";
import { jumpTo } from "./outlineJump";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    erklaerungen: {
      /** Eintrag im Bereich „Begriffe & Erklärungen“ anlegen (Bereich bei Bedarf am Ende der Mitschrift) */
      addExplanation: (term?: string) => ReturnType;
    };
    jumpLink: {
      /** Sprungmarke zum Textblock an `targetPos` (Auswahl wird zur Marke, sonst „→ Ziel“ eingefügt) */
      setJumpLink: (targetPos: number, label: string) => ReturnType;
    };
  }
}

const newAnchor = () => `s-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Textblock mit dieser Kennung (Position) oder null. */
export function findAnchor(doc: PMNodeType, id: string): number | null {
  let hit: number | null = null;
  doc.descendants((n, pos) => {
    if (hit !== null) return false;
    if (n.isTextblock && n.attrs.anchor === id) hit = pos;
    return hit === null;
  });
  return hit;
}

/** Eintrag zu einem Begriff im Bereich „Begriffe & Erklärungen“ (Position) oder null. */
export function findEntry(doc: PMNodeType, term: string): number | null {
  let hit: number | null = null;
  doc.descendants((n, pos) => {
    if (hit !== null) return false;
    if (n.type.name === "erklaerungen") {
      n.descendants((c, rel) => {
        if (hit !== null || c.type.name !== "paragraph") return hit === null;
        const e = parseEntry(c.toJSON() as PMNode);
        if (e && sameTerm(e.term, term)) hit = pos + 1 + rel;
        return false;
      });
      return false;
    }
    return true;
  });
  return hit;
}

/** Sprungziele: alle Überschriften und Absätze mit Text (für die Auswahl). */
export function jumpTargets(doc: PMNodeType): { pos: number; label: string; heading: number }[] {
  const out: { pos: number; label: string; heading: number }[] = [];
  doc.descendants((n, pos) => {
    if (!n.isTextblock) return true;
    const text = n.textContent.replace(/\s+/g, " ").trim();
    if (text && (n.type.name === "heading" || n.type.name === "paragraph")) out.push({ pos, label: text.length > 90 ? `${text.slice(0, 90)} …` : text, heading: n.type.name === "heading" ? Number(n.attrs.level) || 1 : 0 });
    return false;
  });
  return out;
}

/** Kennung für Überschriften und Absätze (Sprungziel). */
export const Anchors = Extension.create({
  name: "anchors",
  addGlobalAttributes() {
    return [
      {
        types: ["heading", "paragraph"],
        attributes: {
          anchor: {
            default: null,
            parseHTML: (el) => el.getAttribute("data-anchor"),
            renderHTML: (a) => (a.anchor ? { "data-anchor": a.anchor } : {}),
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("anchors"),
        // Absatz geteilt oder kopiert: Kennung nur beim ersten behalten
        appendTransaction(trs, _old, state) {
          if (!trs.some((t) => t.docChanged)) return null;
          const seen = new Set<string>();
          const tr = state.tr;
          state.doc.descendants((n, pos) => {
            if (!n.isTextblock) return true;
            const a = n.attrs.anchor as string | null;
            if (a) {
              if (seen.has(a)) tr.setNodeAttribute(pos, "anchor", null);
              seen.add(a);
            }
            return false;
          });
          return tr.docChanged ? tr : null;
        },
        props: {
          handleClick(view, _pos, event) {
            const el = (event.target as HTMLElement | null)?.closest?.("[data-jump], [data-term]");
            if (!el || !view.state.selection.empty) return false;
            const doc = view.state.doc;
            const $from = view.state.selection.$from;
            const fromBlock = $from.depth > 0 ? $from.before($from.depth) : 0;
            const jump = el.getAttribute("data-jump");
            if (jump) {
              const at = findAnchor(doc, jump);
              if (at === null) {
                el.dispatchEvent(new CustomEvent("studium:jump-missing", { bubbles: true }));
                return true;
              }
              jumpTo(view, at, fromBlock, doc.nodeAt(at)?.textContent ?? "", "Zurück zur Sprungmarke");
              return true;
            }
            const term = el.getAttribute("data-term");
            if (term) {
              const at = findEntry(doc, term);
              if (at === null) return false;
              jumpTo(view, at, fromBlock, term, `Zurück zu „${term.length > 30 ? `${term.slice(0, 30)} …` : term}“`);
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});

/** Sprungmarke: springt zu dem Textblock mit der Kennung `target`. */
export const JumpLink = Mark.create({
  name: "jumpLink",
  inclusive: false,
  addAttributes() {
    return {
      target: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-jump") ?? "",
        renderHTML: (a) => ({ "data-jump": a.target }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-jump]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "jump-link", title: "Antippen: zur Stelle springen" }), 0];
  },
  addCommands() {
    return {
      setJumpLink:
        (targetPos, label) =>
        ({ state, tr, dispatch }) => {
          const target = state.doc.nodeAt(targetPos);
          if (!target?.isTextblock) return false;
          if (!dispatch) return true;
          const id = (target.attrs.anchor as string | null) || newAnchor();
          if (!target.attrs.anchor) tr.setNodeAttribute(targetPos, "anchor", id);
          const mark = state.schema.marks.jumpLink!.create({ target: id });
          const { from, to, empty } = state.selection;
          if (!empty) {
            tr.addMark(from, to, mark);
            // Auswahl aufheben – sonst springt das nächste Antippen nicht
            tr.setSelection(TextSelection.create(tr.doc, to));
          } else {
            const text = `→ ${label.length > 60 ? `${label.slice(0, 60)} …` : label}`;
            tr.insert(from, [state.schema.text(text, [mark]), state.schema.text(" ")]);
          }
          return true;
        },
    };
  },
});

/** Im Text erklärter Begriff (gepunktet unterstrichen, springt zum Eintrag). */
export const TermRef = Mark.create({
  name: "termRef",
  inclusive: false,
  addAttributes() {
    return {
      term: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-term") ?? "",
        renderHTML: (a) => ({ "data-term": a.term }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-term]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "term-ref", title: "Antippen: Erklärung anzeigen" }), 0];
  },
});

/** Bereich „Begriffe & Erklärungen“ am Ende der Mitschrift. */
export const Explanations = Node.create({
  name: "erklaerungen",
  group: "block",
  content: "block+",
  defining: true,

  parseHTML() {
    return [{ tag: "section[data-erklaerungen]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["section", mergeAttributes(HTMLAttributes, { "data-erklaerungen": "", class: "erklaerungen", "data-label": SECTION_LABEL }), 0];
  },

  addNodeView() {
    return () => {
      const dom = document.createElement("section");
      dom.className = "erklaerungen";
      dom.setAttribute("data-erklaerungen", "");
      const head = document.createElement("div");
      head.className = "erklaerungen-head";
      head.contentEditable = "false";
      head.textContent = SECTION_LABEL;
      const hint = document.createElement("span");
      hint.className = "erklaerungen-hint";
      hint.textContent = "Begriff fett oder „Begriff – Erklärung“ · erscheint automatisch unter Wissen → Erklärungen";
      head.append(hint);
      const content = document.createElement("div");
      content.className = "erklaerungen-body";
      dom.append(head, content);
      return { dom, contentDOM: content, ignoreMutation: (m) => head.contains(m.target as globalThis.Node), stopEvent: (e) => head.contains(e.target as globalThis.Node) };
    };
  },

  addCommands() {
    return {
      addExplanation:
        (term) =>
        ({ state, tr, dispatch }) => {
          const { schema } = state;
          const { from, to, empty } = state.selection;
          const t = (term ?? (empty ? "" : state.doc.textBetween(from, to, " "))).replace(/\s+/g, " ").trim().slice(0, 80);
          if (!dispatch) return true;
          // im Text: Begriff markieren
          if (!empty && t) tr.addMark(from, to, schema.marks.termRef!.create({ term: t }));
          const entry = t ? schema.nodes.paragraph!.create(null, [schema.text(t, [schema.marks.bold!.create()]), schema.text(" – ")]) : schema.nodes.paragraph!.create();
          let section: { pos: number; node: PMNodeType } | null = null;
          tr.doc.forEach((n, off) => {
            if (n.type.name === this.name) section = { pos: off, node: n };
          });
          const s = section as { pos: number; node: PMNodeType } | null;
          let caret: number;
          if (!s) {
            const at = tr.doc.content.size;
            tr.insert(at, this.type.create(null, entry));
            caret = at + 1 + entry.nodeSize - 1;
          } else if (s.node.childCount === 1 && s.node.firstChild!.content.size === 0) {
            // leerer Bereich: ersten Absatz ersetzen
            tr.replaceWith(s.pos + 1, s.pos + 1 + s.node.firstChild!.nodeSize, entry);
            caret = s.pos + 1 + entry.nodeSize - 1;
          } else {
            const at = s.pos + s.node.nodeSize - 1;
            tr.insert(at, entry);
            caret = at + entry.nodeSize - 1;
          }
          tr.setSelection(TextSelection.create(tr.doc, caret)).scrollIntoView();
          return true;
        },
    };
  },
});

// Aus der Übersicht „Erklärungen“: Mitschrift öffnen und zum Eintrag springen
let pendingEntry: { noteId: string; term: string } | null = null;
export const requestEntryJump = (noteId: string, term: string) => {
  pendingEntry = { noteId, term };
};
export function takeEntryJump(noteId: string): string | null {
  if (pendingEntry?.noteId !== noteId) return null;
  const t = pendingEntry.term;
  pendingEntry = null;
  return t;
}
