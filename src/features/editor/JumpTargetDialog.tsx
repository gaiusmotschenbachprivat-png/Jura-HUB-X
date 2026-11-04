/** Sprungziel wählen: Überschriften und Absätze der Mitschrift, durchsuchbar. */
import type { Editor } from "@tiptap/react";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { jumpTargets } from "./erklaerungen";

export function JumpTargetDialog({ editor, onPick, onClose }: { editor: Editor; onPick: (pos: number, label: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const here = editor.state.selection.$from;
  const herePos = here.depth > 0 ? here.before(here.depth) : -1;
  const all = useMemo(() => jumpTargets(editor.state.doc).filter((t) => t.pos !== herePos), [editor, herePos]);
  const shown = all.filter((t) => !q.trim() || t.label.toLowerCase().includes(q.trim().toLowerCase()));
  const sel = !editor.state.selection.empty;
  return (
    <Dialog title="Sprungmarke setzen" onClose={onClose} width={600} footer={<Button onClick={onClose}>Abbrechen</Button>}>
      <p className="small muted">
        {sel ? "Der markierte Text wird zur Sprungmarke." : "An der Schreibposition wird „→ Ziel“ eingefügt."} Wähle die Stelle, zu der sie springen soll – Überschrift oder Absatz.
        Antippen der Marke springt dorthin, „Zurück“ wieder hierher.
      </p>
      <label className="slide-search">
        <Search size={14} />
        <input autoFocus placeholder="Stelle suchen" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Stelle suchen" />
      </label>
      <div className="jump-targets" role="list">
        {shown.map((t) => (
          <button key={t.pos} role="listitem" className={`jump-target ${t.heading ? `is-h${t.heading}` : ""}`} onClick={() => onPick(t.pos, t.label)}>
            {t.label}
          </button>
        ))}
        {!shown.length && <p className="small muted">Keine passende Stelle.</p>}
      </div>
    </Dialog>
  );
}
