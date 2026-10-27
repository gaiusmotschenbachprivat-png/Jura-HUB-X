import type { Editor } from "@tiptap/react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../api";
import type { Knowledge, SchemaData } from "../../api/types";
import { PLACEHOLDER, schemaToNodes } from "../../lib/gutachten";
import { gebietOf, type Rechtsgebiet } from "../../lib/schemaLibrary";
import { SchemaDiagram } from "../knowledge/SchemaDiagram";
import { SchemaLibrary } from "../knowledge/SchemaLibrary";
import type { PMNode } from "../../lib/pm";
import { reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/misc";

/** Fügt Bausteine an der Cursorposition ein und markiert den ersten Platzhalter „…“. */
export function insertWithPlaceholder(editor: Editor, nodes: PMNode[]) {
  const start = editor.state.selection.from;
  editor.chain().focus().insertContent(nodes).run();
  const end = editor.state.selection.to;
  let hit: { from: number; to: number } | null = null;
  editor.state.doc.nodesBetween(Math.max(0, start - 1), Math.min(editor.state.doc.content.size, end), (node, pos) => {
    if (hit || !node.isText) return !hit;
    const i = (node.text ?? "").indexOf(PLACEHOLDER);
    if (i >= 0 && pos + i >= start - 1) hit = { from: pos + i, to: pos + i + PLACEHOLDER.length };
    return false;
  });
  if (hit) editor.chain().focus().setTextSelection(hit).run();
}

/** Prüfungsschema aus „Wissen → Prüfungsschemata“ als Gliederung einfügen. */
export function SchemaPickerDialog({ editor, onClose, gebiet }: { editor: Editor; onClose: () => void; gebiet?: Rechtsgebiet | null }) {
  const open = useApp((s) => s.open);
  const [tab, setTab] = useState<"vorlagen" | "eigene">("vorlagen");
  const [list, setList] = useState<Knowledge<SchemaData>[] | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [space, setSpace] = useState(true);
  useEffect(() => {
    api
      .knowledgeList({ type: "schema" })
      .then((l) => {
        setList(l as unknown as Knowledge<SchemaData>[]);
        if (l.length) setTab("eigene");
      })
      .catch(reportError);
  }, []);
  const shown = useMemo(
    () => (list ?? []).filter((k) => !q.trim() || `${k.title} ${k.field} ${k.data.norm ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())),
    [list, q],
  );
  const chosen = shown.find((k) => k.id === sel) ?? null;
  const insert = () => {
    if (!chosen) return;
    insertWithPlaceholder(
      editor,
      schemaToNodes({
        title: chosen.title,
        norm: chosen.data.norm,
        items: chosen.data.items ?? [],
        space,
        gebiet: gebietOf(`${chosen.field} ${chosen.title}`),
      }),
    );
    onClose();
  };
  return (
    <Dialog
      title="Prüfungsschema einfügen"
      onClose={onClose}
      width={tab === "vorlagen" ? 980 : 640}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              onClose();
              open({ type: "knowledge-list", kind: "schema" });
            }}
          >
            Schemata verwalten
          </Button>
          <span className="grow" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!chosen} onClick={insert}>
            Einfügen
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="seg" role="tablist" aria-label="Schemata">
          <button role="tab" aria-selected={tab === "vorlagen"} className={tab === "vorlagen" ? "is-active" : ""} onClick={() => setTab("vorlagen")}>
            Vorlagen
          </button>
          <button role="tab" aria-selected={tab === "eigene"} className={tab === "eigene" ? "is-active" : ""} onClick={() => setTab("eigene")}>
            Meine Schemata{list ? ` (${list.length})` : ""}
          </button>
        </div>
        {tab === "vorlagen" ? (
          <SchemaLibrary
            initial={gebiet ?? "zivil"}
            compact
            onInsert={(s) => {
              insertWithPlaceholder(
                editor,
                schemaToNodes({
                  title: s.title,
                  norm: s.norm,
                  items: s.items,
                  space,
                  gebiet: s.gebiet,
                  notes: s.notes,
                }),
              );
              onClose();
            }}
          />
        ) : (
          <>
            <Field label="Suchen">
              <input autoFocus value={q} placeholder="z. B. Kaufvertrag, § 433, Diebstahl" onChange={(e) => setQ(e.target.value)} />
            </Field>
            {list === null ? (
              <div className="loading">Lade …</div>
            ) : shown.length === 0 ? (
              <p className="muted small">
                {list.length ? "Kein Schema passt zur Suche." : "Noch keine Prüfungsschemata. Lege sie unter „Wissen → Prüfungsschemata“ an."}
              </p>
            ) : (
              <div className="list pick-list" role="listbox" aria-label="Prüfungsschemata">
                {shown.map((k) => (
                  <button
                    key={k.id}
                    role="option"
                    aria-selected={sel === k.id}
                    className={`list-row ${sel === k.id ? "is-active" : ""}`}
                    onClick={() => setSel(k.id)}
                    onDoubleClick={() => {
                      setSel(k.id);
                      setTimeout(insert);
                    }}
                  >
                    <span className="grow ellipsis">{k.title}</span>
                    {k.data.norm && <span className="muted small">{k.data.norm}</span>}
                  </button>
                ))}
              </div>
            )}
            {chosen && (
              <SchemaDiagram title={chosen.title} norm={chosen.data.norm} items={chosen.data.items ?? []} gebiet={gebietOf(`${chosen.field} ${chosen.title}`)} compact />
            )}
          </>
        )}
        <label className="row small">
          <input type="checkbox" checked={space} onChange={(e) => setSpace(e.target.checked)} /> Leerzeilen zum Ausformulieren unter jedem Prüfungspunkt
        </label>
      </div>
    </Dialog>
  );
}
