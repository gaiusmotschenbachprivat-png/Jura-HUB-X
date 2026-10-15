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
