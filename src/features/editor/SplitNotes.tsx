/**
 * Zwei Mitschriften nebeneinander (iPad hochkant: untereinander). Beide sind
 * voll bearbeitbar; jede speichert für sich. Dieselbe Notiz wird nie in beiden
 * Hälften geöffnet, damit sich Änderungen nicht gegenseitig überschreiben.
 */
import { Columns2, Search } from "lucide-react";
import { useMemo, useState } from "react";

import type { StudyNode } from "../../api/types";
import { compareNodes, noteTypeOf, NOTE_TYPES } from "../../lib/noteTypes";
const typeLabel = (t: string) => NOTE_TYPES.find((x) => x.id === t)?.label ?? "Notiz";
import { useApp } from "../../state/store";
import { Button, IconButton } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { NoteTypeIcon } from "../navigation/icons";

/** Öffnet eine Notiz in der zweiten Hälfte neben der aktuellen Notiz. */
export function openNoteBeside(id: string) {
  const st = useApp.getState();
  if (st.view.type !== "note") return st.open({ type: "note", id });
  if (st.view.id === id) return st.toast("Diese Notiz ist bereits geöffnet. Wähle eine andere für die zweite Hälfte.", "info");
  st.openSecondary({ type: "note", id });
}

/** Hauptnotiz und zweite Notiz tauschen. */
export function swapNotes() {
  const st = useApp.getState();
  if (st.view.type !== "note" || st.secondary?.type !== "note") return;
  const main = st.view.id;
  const other = st.secondary.id;
  st.open({ type: "note", id: other });
  st.openSecondary({ type: "note", id: main });
}

/** Nebeneinander ↔ untereinander (bleibt „automatisch“, wenn das Ziel der Automatik entspricht). */
export function useSplitLayoutToggle() {
  const stacked = useApp((s) => s.splitLayout === "stacked" || (s.splitLayout === "auto" && s.splitAutoStacked));
  const toggle = () => {
    const st = useApp.getState();
    const target = stacked ? "side" : "stacked";
    st.setPref("splitLayout", (target === "stacked") === st.splitAutoStacked ? "auto" : target);
  };
  return { stacked, toggle };
}

/** Knopf im Notizkopf: zweite Notiz daneben öffnen bzw. schließen. */
export function SecondNoteButton({ node }: { node: StudyNode }) {
  const secondary = useApp((s) => s.secondary);
  const [picking, setPicking] = useState(false);
  const isOpen = secondary?.type === "note";
  return (
    <>
      <IconButton
        label={isOpen ? "Zweite Notiz schließen" : "Zweite Notiz daneben öffnen"}
        active={isOpen}
        onClick={() => (isOpen ? useApp.getState().openSecondary(null) : setPicking(true))}
      >
        <Columns2 size={16} />
      </IconButton>
      {picking && (
        <NotePicker
          current={node}
          onClose={() => setPicking(false)}
          onPick={(n) => {
            setPicking(false);
            openNoteBeside(n.id);
          }}
        />
      )}
    </>
  );
}

/** Auswahl: zuerst die Mitschriften derselben Veranstaltung, dann alle anderen. */
export function NotePicker({ current, onPick, onClose }: { current: StudyNode; onPick: (n: StudyNode) => void; onClose: () => void }) {
  const nodes = useApp((s) => s.nodes);
  const [q, setQ] = useState("");
  const { near, rest, parentTitle } = useMemo(() => {
    const t = q.trim().toLowerCase();
    const notes = nodes.filter((n) => n.kind === "note" && !n.deleted_at && n.id !== current.id && (!t || n.title.toLowerCase().includes(t)));
    const sort = compareNodes("auto");
    const near = notes.filter((n) => n.parent_id === current.parent_id).sort(sort);
    const rest = notes.filter((n) => n.parent_id !== current.parent_id).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return { near, rest: rest.slice(0, 60), parentTitle: nodes.find((n) => n.id === current.parent_id)?.title };
  }, [nodes, current, q]);
  const path = (n: StudyNode) => nodes.find((x) => x.id === n.parent_id)?.title ?? "";
  const row = (n: StudyNode) => {
    const type = noteTypeOf(n) ?? "notiz";
    return (
      <button key={n.id} className="slide-pick" onClick={() => onPick(n)}>
        <NoteTypeIcon type={type} size={16} />
        <span className="grow ellipsis">{n.title}</span>
        <span className="xs muted ellipsis" style={{ maxWidth: 180 }}>
          {near.includes(n) ? typeLabel(type) : path(n)}
        </span>
      </button>
    );
  };
  return (
    <Dialog title="Zweite Notiz daneben öffnen" onClose={onClose} width={540} footer={<Button onClick={onClose}>Abbrechen</Button>}>
      <div className="stack">
        <label className="slide-search">
          <Search size={14} />
          <input autoFocus placeholder="Notiz suchen …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Notiz suchen" />
        </label>
        <div className="slide-list">
          {near.length > 0 && <div className="label">{parentTitle ? `Ebenfalls in ${parentTitle}` : "Daneben"}</div>}
          {near.map(row)}
          {rest.length > 0 && <div className="label">{near.length ? "Weitere Notizen" : "Notizen"}</div>}
          {rest.map(row)}
          {!near.length && !rest.length && <p className="small muted">{q.trim() ? "Kein Treffer." : "Es gibt noch keine weitere Notiz."}</p>}
        </div>
      </div>
    </Dialog>
  );
}
