import { useEffect, useState } from "react";

import { api } from "../../api";
import type { StudyNode } from "../../api/types";
import { NOTE_TYPES, noteTypeOf, type NoteType } from "../../lib/noteTypes";
import { reportError, useApp } from "../../state/store";
import { NoteTypeIcon } from "../navigation/icons";

/** Art der Notiz und – bei Vorlesungen – Nummer, Datum, Dozent/in. Direkt änderbar. */
export function NoteMetaBar({ node }: { node: StudyNode }) {
  const reload = useApp((s) => s.reloadNodes);
  const type = noteTypeOf(node) ?? "notiz";
  const [nr, setNr] = useState(String(node.meta?.number ?? ""));
  const [date, setDate] = useState(typeof node.meta?.date === "string" ? node.meta.date : "");
  const [lecturer, setLecturer] = useState(typeof node.meta?.lecturer === "string" ? node.meta.lecturer : "");
  useEffect(() => {
    setNr(String(node.meta?.number ?? ""));
    setDate(typeof node.meta?.date === "string" ? node.meta.date : "");
    setLecturer(typeof node.meta?.lecturer === "string" ? node.meta.lecturer : "");
  }, [node.id, node.meta]);

  const save = async (patch: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...node.meta, ...patch };
    for (const k of Object.keys(next)) if (next[k] === "" || next[k] === undefined) delete next[k];
    if (JSON.stringify(next) === JSON.stringify(node.meta)) return;
    try {
      await api.nodeUpdate(node.id, { meta: next });
      await reload();
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <div className="note-meta">
      <label className="note-type-chip" title="Art der Notiz">
        <NoteTypeIcon type={type} size={14} />
        <select aria-label="Art der Notiz" value={type} onChange={(e) => void save({ noteType: e.target.value as NoteType })}>
          {NOTE_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      {type === "vorlesung" && (
        <>
          <label className="note-meta-field">
            <span>Nr.</span>
            <input
              className="tnum"
              inputMode="numeric"
              value={nr}
              aria-label="Nummer der Vorlesung"
              onChange={(e) => setNr(e.target.value.replace(/\D/g, "").slice(0, 3))}
              onBlur={() => void save({ number: nr ? Number(nr) : undefined })}
              style={{ width: 42 }}
            />
          </label>
          <label className="note-meta-field">
            <span>Datum</span>
            <input type="date" value={date} aria-label="Datum der Vorlesung" onChange={(e) => setDate(e.target.value)} onBlur={() => void save({ date })} />
          </label>
          <label className="note-meta-field grow-field">
            <span>Dozent/in</span>
            <input value={lecturer} maxLength={200} placeholder="–" aria-label="Dozent/in" onChange={(e) => setLecturer(e.target.value)} onBlur={() => void save({ lecturer })} />
          </label>
        </>
      )}
    </div>
  );
}
