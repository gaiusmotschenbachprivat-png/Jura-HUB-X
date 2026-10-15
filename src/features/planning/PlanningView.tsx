import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api, errorMessage } from "../../api";
import type { Exam, ExamInput, Task, TaskKind } from "../../api/types";
import { formatDate } from "../../lib/format";
import { buildTree, type TreeItem } from "../../lib/tree";
import { areaById, reportError, useApp } from "../../state/store";
import { Button, IconButton } from "../../ui/Button";
import { confirmDialog, Dialog } from "../../ui/Dialog";
import { AreaDot, Field } from "../../ui/misc";
import { PlanBar, planProgress, StudyPlanDialog } from "./StudyPlan";

export const TASK_KIND_LABEL: Record<TaskKind, string> = { aufgabe: "Aufgabe", frage: "Offene Frage", lernziel: "Lernziel" };

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function daysUntil(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(y!, m! - 1, d!);
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - t.getTime()) / 86400000);
}

export function relDays(n: number): string {
  if (n === 0) return "heute";
  if (n === 1) return "morgen";
  if (n === -1) return "gestern";
  return n > 0 ? `in ${n} Tagen` : `vor ${-n} Tagen`;
}

function flattenNodes(items: TreeItem[], out: { id: string; label: string }[] = []) {
  for (const it of items) {
    if (it.node.kind !== "note") out.push({ id: it.node.id, label: `${" ".repeat(it.depth)}${it.node.title}` });
    flattenNodes(it.children, out);
  }
  return out;
}

export function PlanningView() {
  const areaId = useApp((s) => s.areaId);
  const dataVersion = useApp((s) => s.dataVersion);
  const nodes = useApp((s) => s.nodes);
  const bump = useApp((s) => s.bump);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<TaskKind>("aufgabe");
  const [due, setDue] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [examEdit, setExamEdit] = useState<Exam | "new" | null>(null);
  const [planFor, setPlanFor] = useState<Exam | null>(null);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const scope = areaId === "all" ? null : areaId;

  useEffect(() => {
    api.tasksList({ area_id: scope, include_done: showDone }).then(setTasks).catch(reportError);
    api.examsList(scope, showPast ? null : todayIso()).then(setExams).catch(reportError);
    api.tasksList({ area_id: null, include_done: true }).then(setAllTasks).catch(reportError);
  }, [scope, showDone, showPast, dataVersion]);

  const nodeOptions = useMemo(() => flattenNodes(buildTree(nodes)), [nodes]);
  const nodeTitle = (id: string | null) => nodes.find((n) => n.id === id)?.title;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await api.taskCreate({ title, kind, due_date: due || null, node_id: nodeId || null, area_id: nodeId ? null : scope });
      setTitle("");
      setDue("");
      bump();
    } catch (err) {
      reportError(err);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div className="small muted">Planung</div>
        <h1 className="page-title-static">Aufgaben, Fragen und Prüfungen</h1>
      </header>
      <div className="page-grid">
        <section className="page-main">
          <form className="task-add" onSubmit={add}>
            <select value={kind} onChange={(e) => setKind(e.target.value as TaskKind)} aria-label="Art">
              {Object.entries(TASK_KIND_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <input className="grow" value={title} placeholder="Neue Aufgabe oder offene Frage …" onChange={(e) => setTitle(e.target.value)} />
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Fällig am" />
            <select value={nodeId} onChange={(e) => setNodeId(e.target.value)} aria-label="Zuordnung" className="task-node">
              <option value="">– ohne Zuordnung –</option>
              {nodeOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <Button type="submit" variant="primary" icon={<Plus size={15} />} disabled={!title.trim()}>
              Hinzufügen
            </Button>
          </form>
          <div className="row" style={{ margin: "14px 0 6px" }}>
            <h3 className="label grow">Offen</h3>
            <label className="small row">
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> erledigte zeigen
            </label>
          </div>
          {tasks.length === 0 ? (
            <p className="muted small">Keine offenen Aufgaben oder Fragen.</p>
          ) : (
            <div className="list">
              {tasks.map((t) => {
                const n = t.due_date ? daysUntil(t.due_date) : null;
                return (
                  <div key={t.id} className={`list-row task-row ${t.done_at ? "is-done" : ""}`}>
                    <input
                      type="checkbox"
                      checked={!!t.done_at}
                      aria-label="Erledigt"
                      onChange={async (e) => {
                        await api.taskUpdate(t.id, { done: e.target.checked }).catch(reportError);
                        bump();
                      }}
                    />
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="ellipsis block">{t.title}</span>
                      <span className="xs muted ellipsis block">
                        {TASK_KIND_LABEL[t.kind]}
                        {t.node_id && nodeTitle(t.node_id) ? ` · ${nodeTitle(t.node_id)}` : ""}
                      </span>
                    </span>
                    {n !== null && <span className={`status-pill ${n < 0 && !t.done_at ? "is-danger" : n <= 2 ? "is-warn" : "is-pending"}`}>{relDays(n)}</span>}
                    {areaById(t.area_id) && <AreaDot color={areaById(t.area_id)!.color} size={6} />}
                    <IconButton
                      label="In den Papierkorb"
                      onClick={async () => {
                        await api.taskTrash(t.id).catch(reportError);
                        bump();
                      }}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        <aside className="page-side">
          <div className="row">
            <h3 className="label grow">Prüfungstermine</h3>
            <Button size="sm" icon={<Plus size={13} />} onClick={() => setExamEdit("new")}>
              Termin
            </Button>
          </div>
          <div className="stack" style={{ marginTop: 8 }}>
            {exams.length === 0 && <p className="muted small">Keine anstehenden Prüfungen eingetragen.</p>}
            {exams.map((e) => {
              const n = daysUntil(e.date);
              return (
                <div key={e.id} className="exam-card">
                  <span className={`exam-days tnum ${n >= 0 && n <= 14 ? "is-soon" : ""}`}>{n >= 0 ? n : "–"}</span>
                  <button className="grow exam-main" style={{ minWidth: 0 }} onClick={() => setExamEdit(e)}>
                    <strong className="ellipsis block">{e.title}</strong>
                    <span className="xs muted block">
                      {formatDate(e.date + "T12:00:00")} {e.time && `· ${e.time}`} {e.place && `· ${e.place}`}
                    </span>
                    <span className="xs muted block">{n >= 0 ? `noch ${n} ${n === 1 ? "Tag" : "Tage"}` : "vorbei"}</span>
                    <PlanBar {...planProgress(allTasks, e.id)} />
                  </button>
                  {n >= 0 && (
                    <Button size="sm" onClick={() => setPlanFor(e)}>
                      Lernplan
                    </Button>
                  )}
                </div>
              );
            })}
            <label className="small row">
              <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> vergangene zeigen
            </label>
          </div>
        </aside>
      </div>
      {planFor && <StudyPlanDialog exam={planFor} tasks={allTasks} onClose={() => setPlanFor(null)} />}
      {examEdit && <ExamDialog exam={examEdit === "new" ? null : examEdit} nodeOptions={nodeOptions} onClose={() => setExamEdit(null)} />}
    </div>
  );
}

function ExamDialog({ exam, nodeOptions, onClose }: { exam: Exam | null; nodeOptions: { id: string; label: string }[]; onClose: () => void }) {
  const areaId = useApp((s) => s.areaId);
  const bump = useApp((s) => s.bump);
  const [v, setV] = useState<ExamInput>({
    title: exam?.title ?? "",
    date: exam?.date ?? "",
    time: exam?.time ?? "",
    place: exam?.place ?? "",
    kind: exam?.kind ?? "Klausur",
    notes: exam?.notes ?? "",
    node_id: exam?.node_id ?? null,
    area_id: exam?.area_id ?? (areaId === "all" ? null : areaId),
  });
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await api.examSave(exam?.id ?? null, { ...v, area_id: v.node_id ? null : v.area_id });
      bump();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Dialog
      title={exam ? "Prüfungstermin" : "Neuer Prüfungstermin"}
      onClose={onClose}
      footer={
        <>
          {exam && (
            <Button
              variant="ghost"
              onClick={async () => {
                if (!(await confirmDialog({ title: "Termin löschen?", message: "Der Termin kommt in den Papierkorb.", confirm: "In den Papierkorb", danger: true }))) return;
                await api.examTrash(exam.id).catch(reportError);
                bump();
                onClose();
              }}
            >
              Löschen
            </Button>
          )}
          <span className="grow" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save} disabled={!v.title.trim() || !v.date}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Bezeichnung">
          <input autoFocus value={v.title} placeholder="z. B. Klausur BGB AT" onChange={(e) => setV({ ...v, title: e.target.value })} />
        </Field>
        <div className="row3">
          <Field label="Datum">
            <input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
          </Field>
          <Field label="Uhrzeit">
            <input value={v.time} placeholder="10:00" onChange={(e) => setV({ ...v, time: e.target.value })} />
          </Field>
          <Field label="Art">
            <input value={v.kind} placeholder="Klausur, Hausarbeit, mündlich …" onChange={(e) => setV({ ...v, kind: e.target.value })} />
          </Field>
        </div>
        <Field label="Ort">
          <input value={v.place} onChange={(e) => setV({ ...v, place: e.target.value })} />
        </Field>
        <Field label="Veranstaltung">
          <select value={v.node_id ?? ""} onChange={(e) => setV({ ...v, node_id: e.target.value || null })}>
            <option value="">– keine –</option>
            {nodeOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notizen" hint="Hilfsmittel, Stoffeingrenzung, Anmeldung …">
          <textarea rows={3} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </Field>
        <p className="xs muted row">
          <CalendarClock size={13} /> Trage nur Termine ein, die du sicher kennst. Studium OS erfindet oder importiert keine Termine.
        </p>
        {error && <p className="error-text small">{error}</p>}
      </div>
    </Dialog>
  );
}
