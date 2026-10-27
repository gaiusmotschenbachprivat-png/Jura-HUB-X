import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { CaseSensitive, ChevronDown, ChevronUp, List, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";

import { Button, IconButton } from "../../ui/Button";
import { findMatches, matchContexts, searchKey } from "./searchReplace";

/** Suchauftrag aus der globalen Suche: Notiz öffnen und dort das Stichwort anspringen. */
export const useFindRequest = create<{ req: { noteId: string; query: string } | null; request: (noteId: string, query: string) => void; clear: () => void }>((set) => ({
  req: null,
  request: (noteId, query) => set({ req: { noteId, query } }),
  clear: () => set({ req: null }),
}));

/** Suchbegriff, der in der Notiz tatsächlich vorkommt: ganze Eingabe, sonst das längste vorkommende Wort. */
export function bestQuery(doc: Parameters<typeof findMatches>[0], q: string): string {
  const t = q.replace(/["„“]/g, "").trim();
  if (!t || findMatches(doc, t, false).length) return t;
  const words = t.split(/\s+/).filter((w) => w.length >= 2).sort((a, b) => b.length - a.length);
  return words.find((w) => findMatches(doc, w, false).length) ?? t;
}

/**
 * Suchleiste unter der Werkzeugleiste (⌘F oder Lupe): Stichwort eingeben, alle
 * Fundstellen erscheinen als Liste mit Ausschnitt und Abschnitt – antippen
 * springt hin. Mit `initialQuery` (aus der globalen Suche) wird gleich der
 * erste Treffer angesprungen.
 */
export function FindBar({ editor, onClose, initialQuery, readOnly }: { editor: Editor; onClose: () => void; initialQuery?: string; readOnly?: boolean }) {
  const [query, setQuery] = useState(() => {
    if (initialQuery) return initialQuery;
    const { from, to } = editor.state.selection;
    const sel = editor.state.doc.textBetween(from, to, " ");
    return sel.length < 80 ? sel : "";
  });
  const [showList, setShowList] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const [replacement, setReplacement] = useState("");
  const [cs, setCs] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const s = searchKey.getState(e.state);
      return { count: s?.matches.length ?? 0, index: s?.index ?? -1, doc: e.state.doc, matches: s?.matches ?? [] };
    },
  });
  const contexts = useMemo(() => (showList && query ? matchContexts(st.doc, st.matches.slice(0, 200)) : []), [st.doc, st.matches, showList, query]);
  useEffect(() => {
    editor.commands.setSearch(query, cs);
  }, [editor, query, cs]);
  // aus der globalen Suche: ersten Treffer anspringen
  const jumped = useRef(false);
  useEffect(() => {
    if (!initialQuery || jumped.current || !st.count) return;
    jumped.current = true;
    editor.commands.gotoMatchIndex(0);
    requestAnimationFrame(() => scrollToCurrent(editor));
  }, [initialQuery, st.count, editor]);
  useEffect(() => {
    listRef.current?.querySelector(".is-current")?.scrollIntoView?.({ block: "nearest" });
  }, [st.index]);
  useEffect(() => {
    if (initialQuery) return;
    input.current?.focus();
    input.current?.select();
    return () => {
      if (!editor.isDestroyed) editor.commands.clearSearch();
    };
  }, [editor]);
  const close = () => {
    onClose();
    editor.commands.focus();
  };
  const go = (dir: 1 | -1) => {
    editor.commands.gotoMatch(dir);
    requestAnimationFrame(() => scrollToCurrent(editor));
  };
  const jump = (i: number) => {
    editor.commands.gotoMatchIndex(i);
    requestAnimationFrame(() => scrollToCurrent(editor));
  };
  return (
    <div className="find-bar" role="search" aria-label="Suchen und Ersetzen">
      <div className="find-row">
        <input
          ref={input}
          value={query}
          placeholder="Suchen im Text"
          aria-label="Suchen im Text"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              go(e.shiftKey ? -1 : 1);
            } else if (e.key === "Escape") close();
          }}
        />
        <span className="find-count small muted tnum" aria-live="polite">
          {query ? (st.count ? `${st.index + 1}/${st.count}` : "0 Treffer") : ""}
        </span>
        <IconButton label="Vorheriger Treffer (⇧Enter)" disabled={!st.count} onClick={() => go(-1)}>
          <ChevronUp size={16} />
        </IconButton>
        <IconButton label="Nächster Treffer (Enter)" disabled={!st.count} onClick={() => go(1)}>
          <ChevronDown size={16} />
        </IconButton>
        <IconButton label="Trefferliste" active={showList} onClick={() => setShowList(!showList)}>
          <List size={16} />
        </IconButton>
        <IconButton label="Groß-/Kleinschreibung beachten" active={cs} onClick={() => setCs(!cs)}>
          <CaseSensitive size={16} />
        </IconButton>
        <IconButton label="Suche schließen (Esc)" onClick={close}>
          <X size={16} />
        </IconButton>
      </div>
      {showList && query && st.count > 0 && (
        <div className="find-list" ref={listRef} role="list" aria-label="Fundstellen">
          {contexts.map((c) => (
            <button key={c.index} role="listitem" className={`find-hit ${c.index === st.index ? "is-current" : ""}`} onClick={() => jump(c.index)}>
              <span className="find-hit-num tnum">{c.index + 1}</span>
              <span className="grow" style={{ minWidth: 0 }}>
                {c.heading && <span className="find-hit-head ellipsis">{c.heading}</span>}
                <span className="find-hit-text">
                  {c.before}
                  <mark>{c.hit}</mark>
                  {c.after}
                </span>
              </span>
            </button>
          ))}
          {st.count > contexts.length && <p className="xs muted">… und {st.count - contexts.length} weitere Treffer</p>}
        </div>
      )}
      {!readOnly && (
      <div className="find-row">
        <input
          value={replacement}
          placeholder="Ersetzen durch"
          aria-label="Ersetzen durch"
          onChange={(e) => setReplacement(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              editor.commands.replaceMatch(replacement);
            } else if (e.key === "Escape") close();
          }}
        />
        <Button size="sm" disabled={!st.count} onClick={() => editor.commands.replaceMatch(replacement)}>
          Ersetzen
        </Button>
        <Button size="sm" disabled={!st.count} onClick={() => editor.commands.replaceAll(replacement)}>
          Alle ersetzen
        </Button>
      </div>
      )}
    </div>
  );
}

/** Aktuellen Treffer mittig in den sichtbaren Bereich holen (auch im iPad-Scrollbereich). */
function scrollToCurrent(editor: Editor) {
  if (editor.isDestroyed) return;
  const el = editor.view.dom.querySelector(".search-hit.is-current");
  el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
}
