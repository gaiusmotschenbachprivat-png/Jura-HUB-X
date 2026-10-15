import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { CaseSensitive, ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button, IconButton } from "../../ui/Button";
import { searchKey } from "./searchReplace";

/** Suchleiste unter der Werkzeugleiste (⌘F). */
export function FindBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [query, setQuery] = useState(() => {
    const { from, to } = editor.state.selection;
    const sel = editor.state.doc.textBetween(from, to, " ");
    return sel.length < 80 ? sel : "";
  });
  const [replacement, setReplacement] = useState("");
  const [cs, setCs] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const s = searchKey.getState(e.state);
      return { count: s?.matches.length ?? 0, index: s?.index ?? -1 };
    },
  });
  useEffect(() => {
    editor.commands.setSearch(query, cs);
  }, [editor, query, cs]);
  useEffect(() => {
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
  const go = (dir: 1 | -1) => editor.commands.gotoMatch(dir);
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
        <IconButton label="Groß-/Kleinschreibung beachten" active={cs} onClick={() => setCs(!cs)}>
          <CaseSensitive size={16} />
        </IconButton>
        <IconButton label="Suche schließen (Esc)" onClick={close}>
          <X size={16} />
        </IconButton>
      </div>
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
    </div>
  );
}
