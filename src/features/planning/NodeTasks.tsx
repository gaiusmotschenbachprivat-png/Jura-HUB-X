import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../api";
import type { Knowledge, Task, TaskKind } from "../../api/types";
import { reportError, useApp } from "../../state/store";
import { IconButton } from "../../ui/Button";
import { KindIcon } from "../navigation/icons";
import { daysUntil, relDays, TASK_KIND_LABEL } from "./PlanningView";

/** Aufgaben, offene Fragen und Wissensobjekte eines Strukturknotens (Veranstaltung, Termin, Thema). */
export function NodeTasks({ nodeId }: { nodeId: string }) {
  const dataVersion = useApp((s) => s.dataVersion);
  const bump = useApp((s) => s.bump);
  const open = useApp((s) => s.open);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<TaskKind>("frage");

  useEffect(() => {
    api.tasksList({ node_id: nodeId, include_done: false }).then(setTasks).catch(() => {});
    api.knowledgeList({ node_id: nodeId }).then(setKnowledge).catch(() => {});
  }, [nodeId, dataVersion]);

  return (
    <>
      <section className="section">
        <h3 className="label">Offene Fragen und Aufgaben</h3>
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim()) return;
            await api.taskCreate({ node_id: nodeId, kind, title }).catch(reportError);
            setTitle("");
            bump();
          }}
        >
          <select value={kind} onChange={(e) => setKind(e.target.value as TaskKind)} aria-label="Art" style={{ width: 150, flex: "none" }}>
            {Object.entries(TASK_KIND_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <input className="grow" value={title} placeholder="Hinzufügen …" onChange={(e) => setTitle(e.target.value)} />
          <IconButton label="Hinzufügen" type="submit" disabled={!title.trim()}>
            <Plus size={15} />
          </IconButton>
        </form>
        <div className="stack" style={{ gap: 2, marginTop: 6 }}>
          {tasks.map((t) => (
            <div key={t.id} className="task-mini">
              <input
                type="checkbox"
                aria-label="Erledigt"
                onChange={async () => {
                  await api.taskUpdate(t.id, { done: true }).catch(reportError);
                  bump();
                }}
              />
              <span className="grow small">{t.title}</span>
              {t.due_date && <span className="xs muted">{relDays(daysUntil(t.due_date))}</span>}
              <IconButton
                label="Löschen"
                className="ctx-remove"
                onClick={async () => {
                  await api.taskTrash(t.id).catch(reportError);
                  bump();
                }}
              >
                <Trash2 size={13} />
              </IconButton>
            </div>
          ))}
        </div>
      </section>
      {knowledge.length > 0 && (
        <section className="section">
          <h3 className="label">Wissen zu diesem Thema</h3>
          {knowledge.map((k) => (
            <button key={k.id} className="lo-row" onClick={() => open({ type: "knowledge", id: k.id }, { title: k.title })}>
              <KindIcon kind={k.type} size={14} />
              <span className="grow ellipsis">{k.title}</span>
            </button>
          ))}
        </section>
      )}
    </>
  );
}
