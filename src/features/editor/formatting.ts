/**
 * Word-ähnliche Formatierung für den Editor: Zeilenabstand und Einzug je Absatz,
 * Fußnoten und Seitenumbrüche. Alles wird im ProseMirror-JSON der Notiz
 * gespeichert und beim Word-Export übernommen.
 */
import { Extension, Node, mergeAttributes, type Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

import { cssLengthToPt } from "../../lib/textFormat";

export const FOOTNOTE_EDIT_EVENT = "studium:edit-footnote";
export interface FootnoteEditDetail {
  text: string;
  pos: number;
  source?: string | null;
  pin?: string | null;
}

export const MAX_INDENT = 8;
/** Einzugsstufe in em (Bildschirm); im Word-Export 1,27 cm je Stufe. */
const INDENT_EM = 2.5;
const PARAGRAPH_TYPES = ["paragraph", "heading"];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphFormat: {
      /** Zeilenabstand der markierten Absätze, z. B. "1.5"; null = Standard. */
      setParagraphLineHeight: (lineHeight: string | null) => ReturnType;
      /** Einzug der markierten Absätze ändern (+1 / -1). */
      changeIndent: (delta: number) => ReturnType;
      /** Zeilenabstand und Einzug zurücksetzen. */
      resetParagraphFormat: () => ReturnType;
    };
    pageBreak: {
      insertPageBreak: () => ReturnType;
    };
    footnote: {
      insertFootnote: (text: string, cite?: { source: string; pin: string } | null) => ReturnType;
    };
  }
}

export const ParagraphFormat = Extension.create({
  name: "paragraphFormat",
  // Nach Listen und Tabellen: deren Tab-Belegung hat Vorrang
  priority: 50,

  addGlobalAttributes() {
    return [
      {
        types: PARAGRAPH_TYPES,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (el) => {
              const v = el.style.lineHeight;
              return /^\d+(\.\d+)?$/.test(v) && Number(v) >= 0.8 && Number(v) <= 4 ? v : null;
            },
            renderHTML: (attrs) => (attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {}),
          },
          indent: {
            default: 0,
            parseHTML: (el) => {
              const d = Number(el.getAttribute("data-indent"));
              if (Number.isInteger(d) && d > 0) return Math.min(d, MAX_INDENT);
              // Eingefügter Text aus Word: Einzug in pt/cm → Stufen zu 36 pt
              const pt = el.style.marginLeft ? cssLengthToPt(el.style.marginLeft) : null;
              return pt && pt > 0 ? Math.min(MAX_INDENT, Math.round(pt / 36)) : 0;
            },
            renderHTML: (attrs) => {
              const n = Number(attrs.indent) || 0;
              return n > 0 ? { "data-indent": String(n), style: `margin-left: ${n * INDENT_EM}em` } : {};
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setParagraphLineHeight:
        (lineHeight) =>
        ({ tr, state, dispatch }) => {
          const { from, to } = state.selection;
          let changed = false;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!PARAGRAPH_TYPES.includes(node.type.name)) return;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, lineHeight });
            changed = true;
          });
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
      changeIndent:
        (delta) =>
        ({ tr, state, dispatch }) => {
          const { from, to } = state.selection;
          let changed = false;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!PARAGRAPH_TYPES.includes(node.type.name)) return;
            const cur = Number(node.attrs.indent) || 0;
            const next = Math.max(0, Math.min(MAX_INDENT, cur + delta));
            if (next !== cur) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
              changed = true;
            }
          });
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
      resetParagraphFormat:
        () =>
        ({ tr, state, dispatch }) => {
          const { from, to } = state.selection;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!PARAGRAPH_TYPES.includes(node.type.name)) return;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, lineHeight: null, indent: 0, textAlign: null });
          });
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    const inList = (e: Editor) => e.isActive("listItem") || e.isActive("taskItem");
    return {
      // Tab rückt wie in Word ein; in Listen und Tabellen gilt deren eigene Belegung.
      Tab: ({ editor }) => {
        if (editor.isActive("table") || editor.isActive("codeBlock")) return false;
        if (inList(editor)) return true;
        editor.commands.changeIndent(1);
        return true;
      },
      "Shift-Tab": ({ editor }) => {
        if (editor.isActive("table") || editor.isActive("codeBlock")) return false;
        if (inList(editor)) return true;
        editor.commands.changeIndent(-1);
        return true;
      },
    };
  },
});

/** Einzug vergrößern/verkleinern – in Listen als Ebene, sonst als Absatzeinzug. */
export function indent(editor: Editor, delta: 1 | -1) {
  const item = editor.isActive("taskItem") ? "taskItem" : editor.isActive("listItem") ? "listItem" : null;
  const c = editor.chain().focus();
  if (item) {
    if (delta > 0) c.sinkListItem(item).run();
    else c.liftListItem(item).run();
  } else {
    c.changeIndent(delta).run();
  }
}

export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: "div[data-page-break]" }, { tag: "hr[data-page-break]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-page-break": "", class: "page-break", contenteditable: "false" })];
  },
  addCommands() {
    return {
      insertPageBreak:
        () =>
        ({ tr, state, dispatch }) => {
          const type = state.schema.nodes.pageBreak!;
          if (!dispatch) return true;
          tr.deleteSelection();
          const pos = tr.selection.from;
          const $pos = tr.doc.resolve(pos);
          if (!$pos.parent.isTextblock) {
            tr.replaceSelectionWith(type.create());
          } else {
            // Absatz am Cursor teilen, Umbruch dazwischen, Cursor an den Anfang des neuen Absatzes
            tr.split(pos);
            tr.insert(pos + 1, type.create());
            tr.setSelection(TextSelection.create(tr.doc, pos + 3));
          }
          dispatch(tr.scrollIntoView());
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    // Wie in Word: Strg/⌘ + Enter
    return { "Mod-Enter": () => this.editor.commands.insertPageBreak() };
  },
});

export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      text: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-footnote") ?? "",
        renderHTML: (attrs) => ({ "data-footnote": String(attrs.text ?? "") }),
      },
      /** Zitierte Quelle (Wissenseintrag „quelle“) – für das Literaturverzeichnis */
      source: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-source"),
        renderHTML: (attrs) => (attrs.source ? { "data-source": String(attrs.source) } : {}),
      },
      /** Fundstelle in der Quelle, z. B. „§ 119 Rn. 10“ */
      pin: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-pin"),
        renderHTML: (attrs) => (attrs.pin ? { "data-pin": String(attrs.pin) } : {}),
      },
    };
  },
  parseHTML() {
    // Vor der Hochstellung (<sup>) prüfen
    return [
      { tag: "sup[data-footnote]", priority: 100 },
      { tag: "span[data-footnote]", priority: 100 },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["sup", mergeAttributes(HTMLAttributes, { class: "footnote-ref" })];
  },
  renderText({ node }) {
    return ` (Fn.: ${String(node.attrs.text ?? "")})`;
  },
  addNodeView() {
    return ({ node, getPos }) => {
      const dom = document.createElement("sup");
      dom.className = "footnote-ref";
      dom.contentEditable = "false";
      dom.setAttribute("role", "button");
      const set = (text: string) => {
        dom.title = text ? `Fußnote: ${text}` : "Fußnote (leer)";
        dom.setAttribute("aria-label", dom.title);
        dom.dataset.footnote = text;
      };
      set(String(node.attrs.text ?? ""));
      dom.addEventListener("click", (ev) => {
        ev.preventDefault();
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (typeof pos !== "number") return;
        window.dispatchEvent(new CustomEvent<FootnoteEditDetail>(FOOTNOTE_EDIT_EVENT, { detail: { text: dom.dataset.footnote ?? "", pos } }));
      });
      return {
        dom,
        update(n) {
          if (n.type.name !== "footnote") return false;
          set(String(n.attrs.text ?? ""));
          return true;
        },
      };
    };
  },
  addCommands() {
    return {
      insertFootnote:
        (text, cite) =>
        ({ state, chain }) =>
          chain()
            .insertContentAt(state.selection.to, { type: "footnote", attrs: { text, source: cite?.source ?? null, pin: cite?.pin ?? null } })
            .run(),
    };
  },
});

/** Alle Fußnoten eines Editors in Dokumentreihenfolge. */
export function footnotesOf(editor: Editor): FootnoteEditDetail[] {
  const out: FootnoteEditDetail[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "footnote")
      out.push({ text: String(node.attrs.text ?? ""), pos, source: (node.attrs.source as string | null) ?? null, pin: (node.attrs.pin as string | null) ?? null });
  });
  return out;
}

// ---- Auswahllisten für die Werkzeugleiste ----

/** Schriften, die auf dem iPad (und in Word) vorhanden sind. */
export const FONTS: { label: string; value: string }[] = [
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Avenir Next", value: '"Avenir Next", Avenir, sans-serif' },
  { label: "Baskerville", value: 'Baskerville, "Baskerville Old Face", serif' },
  { label: "Courier New", value: '"Courier New", Courier, monospace' },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Gill Sans", value: '"Gill Sans", "Gill Sans MT", sans-serif' },
  { label: "Helvetica Neue", value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { label: "Optima", value: "Optima, Candara, sans-serif" },
  { label: "Palatino", value: 'Palatino, "Palatino Linotype", serif' },
  { label: "Times New Roman", value: '"Times New Roman", Times, serif' },
  { label: "Trebuchet MS", value: '"Trebuchet MS", sans-serif' },
  { label: "Verdana", value: "Verdana, sans-serif" },
];

export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

export const LINE_HEIGHTS = ["1", "1.15", "1.5", "2", "2.5", "3"];

export const TEXT_COLORS = [
  "#000000", "#44546a", "#7f7f7f", "#c00000", "#ff0000", "#ffc000",
  "#00b050", "#0070c0", "#002060", "#7030a0", "#c55a11", "#2e75b6",
];

export const HIGHLIGHT_COLORS = ["#fff59d", "#c5f5c1", "#b3ecff", "#ffc9de", "#ffd8a8", "#d7c8ff", "#e2e5ea"];

