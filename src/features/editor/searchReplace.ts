/**
 * Suchen und Ersetzen im Editor: Treffer werden markiert (Dekorationen), der
 * aktuelle Treffer hervorgehoben. Gesucht wird blockweise im Text, auch über
 * Formatierungswechsel hinweg (z. B. „Gestaltungs**recht**“).
 */
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface SearchState {
  query: string;
  caseSensitive: boolean;
  matches: { from: number; to: number }[];
  index: number;
}

export const searchKey = new PluginKey<SearchState>("searchReplace");

const EMPTY: SearchState = { query: "", caseSensitive: false, matches: [], index: -1 };

/** Alle Treffer im Dokument (Positionen im Dokument). */
export function findMatches(doc: PMNode, query: string, caseSensitive: boolean): { from: number; to: number }[] {
  if (!query) return [];
  const out: { from: number; to: number }[] = [];
  const q = caseSensitive ? query : query.toLocaleLowerCase("de");
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // Text des Blocks mit Zuordnung Zeichen → Dokumentposition
    let text = "";
    const map: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        const t = child.text ?? "";
        for (let i = 0; i < t.length; i++) map.push(pos + 1 + offset + i);
        text += t;
      } else {
        // Fußnoten, Formeln usw. trennen Wörter
        map.push(-1);
        text += "\u0000";
      }
    });
    const hay = caseSensitive ? text : text.toLocaleLowerCase("de");
    let i = hay.indexOf(q);
    while (i >= 0) {
      const from = map[i]!;
      const to = map[i + q.length - 1]!;
      if (from >= 0 && to >= 0) out.push({ from, to: to + 1 });
      i = hay.indexOf(q, i + Math.max(1, q.length));
    }
    return false;
  });
  return out;
}

function compute(state: EditorState, query: string, caseSensitive: boolean, keepIndex: number): SearchState {
  const matches = findMatches(state.doc, query, caseSensitive);
  let index = matches.length ? Math.min(Math.max(keepIndex, 0), matches.length - 1) : -1;
  if (keepIndex < 0 && matches.length) {
    // erster Treffer ab dem Cursor
    const from = state.selection.from;
    const next = matches.findIndex((m) => m.from >= from);
    index = next >= 0 ? next : 0;
  }
  return { query, caseSensitive, matches, index };
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    searchReplace: {
      setSearch: (query: string, caseSensitive?: boolean) => ReturnType;
      clearSearch: () => ReturnType;
      gotoMatch: (dir: 1 | -1) => ReturnType;
      /** zu Treffer Nr. `index` springen (Trefferliste) */
      gotoMatchIndex: (index: number) => ReturnType;
      replaceMatch: (replacement: string) => ReturnType;
      replaceAll: (replacement: string) => ReturnType;
    };
  }
}

function select(tr: Transaction, m: { from: number; to: number } | undefined) {
  if (m) tr.setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView();
  return tr;
}

export const SearchReplace = Extension.create({
  name: "searchReplace",

  addCommands() {
    return {
      setSearch:
        (query, caseSensitive = false) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(searchKey, { query, caseSensitive, index: -1 }));
          return true;
        },
      clearSearch:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(searchKey, { query: "", caseSensitive: false, index: -1 }));
          return true;
        },
      gotoMatch:
        (dir) =>
        ({ state, tr, dispatch }) => {
          const s = searchKey.getState(state);
          if (!s || !s.matches.length) return false;
          const index = (s.index + dir + s.matches.length) % s.matches.length;
          if (dispatch) dispatch(select(tr.setMeta(searchKey, { query: s.query, caseSensitive: s.caseSensitive, index }), s.matches[index]));
          return true;
        },
      gotoMatchIndex:
        (index) =>
        ({ state, tr, dispatch }) => {
          const s = searchKey.getState(state);
          const m = s?.matches[index];
          if (!s || !m) return false;
          if (dispatch) dispatch(select(tr.setMeta(searchKey, { query: s.query, caseSensitive: s.caseSensitive, index }), m));
          return true;
        },
      replaceMatch:
        (replacement) =>
        ({ state, tr, dispatch }) => {
          const s = searchKey.getState(state);
          const m = s?.matches[s.index];
          if (!s || !m) return false;
          if (dispatch) {
            tr.insertText(replacement, m.from, m.to);
            tr.setMeta(searchKey, { query: s.query, caseSensitive: s.caseSensitive, index: s.index });
            dispatch(tr);
          }
          return true;
        },
      replaceAll:
        (replacement) =>
        ({ state, tr, dispatch }) => {
          const s = searchKey.getState(state);
          if (!s || !s.matches.length) return false;
          if (dispatch) {
            // von hinten, damit Positionen gültig bleiben
            for (const m of [...s.matches].reverse()) tr.insertText(replacement, m.from, m.to);
            tr.setMeta(searchKey, { query: s.query, caseSensitive: s.caseSensitive, index: -1 });
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => EMPTY,
          apply(tr, prev, _old, state) {
            const meta = tr.getMeta(searchKey) as { query: string; caseSensitive: boolean; index: number } | undefined;
            if (meta) return meta.query ? compute(state, meta.query, meta.caseSensitive, meta.index) : EMPTY;
            if (tr.docChanged && prev.query) return compute(state, prev.query, prev.caseSensitive, prev.index);
            return prev;
          },
        },
        props: {
          decorations(state) {
            const s = searchKey.getState(state);
            if (!s || !s.matches.length) return null;
            return DecorationSet.create(
              state.doc,
              s.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.index ? "search-hit is-current" : "search-hit" })),
            );
          },
        },
      }),
    ];
  },
});

export interface MatchContext {
  index: number;
  /** Text vor dem Treffer, Treffer, Text danach (gekürzt) */
  before: string;
  hit: string;
  after: string;
  /** nächste Überschrift oberhalb (Abschnitt der Mitschrift) */
  heading: string;
}

/** Trefferliste: jeder Treffer mit Ausschnitt und dem Abschnitt, in dem er steht. */
export function matchContexts(doc: PMNode, matches: { from: number; to: number }[], around = 48): MatchContext[] {
  // Überschriften mit Position, in Dokumentreihenfolge
  const heads: { pos: number; text: string }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") heads.push({ pos, text: node.textContent.trim() });
    return !node.isTextblock;
  });
  return matches.map((m, index) => {
    const $from = doc.resolve(m.from);
    const block = $from.parent;
    const start = $from.start();
    const text = block.textBetween(0, block.content.size, " ", " ");
    const a = Math.max(0, m.from - start);
    const b = Math.min(text.length, a + (m.to - m.from));
    let heading = "";
    for (const h of heads) if (h.pos < m.from) heading = h.text;
    else break;
    const before = text.slice(Math.max(0, a - around), a);
    const after = text.slice(b, b + around);
    return {
      index,
      before: (a - around > 0 ? "…" : "") + before,
      hit: text.slice(a, b),
      after: after + (b + around < text.length ? "…" : ""),
      heading: block.type.name === "heading" ? "" : heading,
    };
  });
}
