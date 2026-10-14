/**
 * Gliederungseditor für Prüfungsschemata.
 * Enter: neuer Punkt · Tab / ⇧Tab: ein-/ausrücken · Alt+↑/↓: verschieben ·
 * Rücktaste in leerem Punkt: löschen.
 */
import { ArrowDown, ArrowUp, IndentDecrease, IndentIncrease, MessageSquare, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { SchemaItem } from "../../api/types";
import { gliederung } from "../../lib/gliederung";
import { flatten, indent, insertAfter, move, outdent, remove, update } from "../../lib/schemaTree";
import { IconButton } from "../../ui/Button";

export function SchemaEditor({ items, onChange }: { items: SchemaItem[]; onChange: (items: SchemaItem[]) => void }) {
  const [focusId, setFocusId] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState<Record<string, boolean>>({});
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  const rows = flatten(items);

  useEffect(() => {
    if (focusId) refs.current[focusId]?.focus();
  }, [focusId, items]);

  const set = (next: SchemaItem[], focus?: string) => {
    onChange(next);
    if (focus) setFocusId(focus);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, item: SchemaItem, i: number) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const r = insertAfter(items, item.id);
      set(r.items, r.id);
    } else if (e.key === "Tab") {
      e.preventDefault();
      set(e.shiftKey ? outdent(items, item.id) : indent(items, item.id), item.id);
    } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      set(move(items, item.id, e.key === "ArrowUp" ? -1 : 1), item.id);
    } else if (e.key === "ArrowUp" && i > 0) {
      e.preventDefault();
      setFocusId(rows[i - 1]!.item.id);
    } else if (e.key === "ArrowDown" && i < rows.length - 1) {
      e.preventDefault();
      setFocusId(rows[i + 1]!.item.id);
    } else if (e.key === "Backspace" && item.text === "" && rows.length > 1) {
      e.preventDefault();
      set(remove(items, item.id), rows[Math.max(0, i - 1)]!.item.id);
    }
  };

  return (
    <div className="schema-editor">
      {rows.length === 0 && <p className="muted small">Noch keine Prüfungspunkte.</p>}
      {rows.map(({ item, depth, n }, i) => (
        <div key={item.id} className={`schema-row ${focusId === item.id ? "is-focus" : ""}`} style={{ paddingLeft: depth * 28 }}>
          <div className="schema-line">
            <span className="schema-num tnum">{gliederung(depth, n)}</span>
            <input
              ref={(el) => {
                refs.current[item.id] = el;
              }}
              className="schema-input"
              value={item.text}
              placeholder="Prüfungspunkt"
              aria-label={`Prüfungspunkt ${gliederung(depth, n)}`}
              onFocus={() => setFocusId(item.id)}
              onChange={(e) => onChange(update(items, item.id, { text: e.target.value }))}
              onKeyDown={(e) => onKey(e, item, i)}
            />
            <span className="schema-tools">
              <IconButton label="Anmerkung" active={!!notesOpen[item.id] || !!item.note} onClick={() => setNotesOpen({ ...notesOpen, [item.id]: !notesOpen[item.id] })}>
                <MessageSquare size={14} />
              </IconButton>
              <IconButton label="Ausrücken (⇧Tab)" disabled={depth === 0} onClick={() => set(outdent(items, item.id), item.id)}>
                <IndentDecrease size={14} />
              </IconButton>
              <IconButton label="Einrücken (Tab)" disabled={n === 1} onClick={() => set(indent(items, item.id), item.id)}>
                <IndentIncrease size={14} />
              </IconButton>
              <IconButton label="Nach oben (Alt+↑)" onClick={() => set(move(items, item.id, -1), item.id)}>
                <ArrowUp size={14} />
              </IconButton>
              <IconButton label="Nach unten (Alt+↓)" onClick={() => set(move(items, item.id, 1), item.id)}>
                <ArrowDown size={14} />
              </IconButton>
              <IconButton label="Punkt löschen" onClick={() => set(remove(items, item.id))}>
                <Trash2 size={14} />
              </IconButton>
            </span>
          </div>
          {(notesOpen[item.id] || item.note) && (
            <textarea
              className="schema-note"
              rows={2}
              placeholder="Anmerkung, Definition, Problem, Fundstelle …"
              value={item.note}
              onChange={(e) => onChange(update(items, item.id, { note: e.target.value }))}
            />
          )}
        </div>
      ))}
      <button
        className="side-empty schema-add"
        onClick={() => {
          const r = insertAfter(items, rows.length ? items[items.length - 1]!.id : null);
          set(r.items, r.id);
        }}
      >
        <Plus size={13} /> Prüfungspunkt
      </button>
      <p className="xs muted">Enter: neuer Punkt · Tab / ⇧Tab: ein- und ausrücken · Alt+↑/↓: verschieben · Rücktaste im leeren Punkt: löschen</p>
    </div>
  );
}
