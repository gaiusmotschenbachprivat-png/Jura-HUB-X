import { useEffect, useMemo, useState } from "react";

import { api } from "../../api";
import type { Exam, Task } from "../../api/types";
import { formatDate } from "../../lib/format";
import { buildStudyPlan, PLAN_MARK } from "../../lib/timetable";
import { todayIso } from "../../lib/noteTypes";
import { reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/misc";

/** Fortschritt des Lernplans einer Klausur. */
export function planProgress(tasks: Task[], examId: string): { done: number; total: number } {
  const mine = tasks.filter((t) => !t.deleted_at && t.notes.includes(PLAN_MARK(examId)));
  return { done: mine.filter((t) => t.done_at).length, total: mine.length };
}

export function PlanBar({ done, total }: { done: number; total: number }) {
  if (!total) return null;
  return (
    <span className="plan-bar" title={`Lernplan: ${done} von ${total} erledigt`}>
      <span className="plan-bar-fill" style={{ width: `${Math.round((done / total) * 100)}%` }} />
      <span className="plan-bar-text xs tnum">
        {done}/{total}
      </span>
    </span>
  );
}

/** Lernplan bis zur Klausur: Vorschau, dann als Aufgaben mit Datum anlegen. */
export function StudyPlanDialog({ exam, tasks, onClose }: { exam: Exam; tasks: Task[]; onClose: () => void }) {
  const nodes = useApp((s) => s.nodes);
  const bump = useApp((s) => s.bump);
  const [rest, setRest] = useState(7);
  const [busy, setBusy] = useState(false);
  const plan = useMemo(() => buildStudyPlan({ exam, nodes, today: todayIso(), restDay: rest }), [exam, nodes, rest]);
  const existing = tasks.filter((t) => t.notes.includes(PLAN_MARK(exam.id)));
  const course = nodes.find((n) => n.id === exam.node_id);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [rest]);

  const create = async () => {
    setBusy(true);
    try {
      // offene Aufgaben eines alten Plans ersetzen, erledigte bleiben
      for (const t of existing) if (!t.done_at) await api.taskTrash(t.id);
      for (const p of plan) {
        await api.taskCreate({ kind: "lernziel", title: p.title, due_date: p.due_date, node_id: p.node_id, area_id: p.node_id ? null : exam.area_id, notes: PLAN_MARK(exam.id) });
      }
      bump();
      useApp.getState().toast(`Lernplan mit ${plan.length} Schritten angelegt – siehe „Aufgaben & Prüfungen“.`, "success");
      onClose();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`Lernplan: ${exam.title}`}
      onClose={onClose}
      width={600}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={busy || !plan.length} onClick={() => void create()}>
            {existing.length ? "Lernplan ersetzen" : "Lernplan anlegen"}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="small">
          Klausur am <strong>{formatDate(exam.date + "T12:00:00")}</strong>.{" "}
          {course ? (
            <>
              Alle Inhalte aus „{course.title}“ werden gleichmäßig bis drei Tage vorher verteilt – frühe Vorlesungen zuerst –, danach Probeklausur und Schlusswiederholung.
            </>
          ) : (
            <>Die Klausur ist keiner Veranstaltung zugeordnet – der Plan enthält daher nur Probeklausur und Schlusswiederholung. Ordne sie im Prüfungstermin einer Veranstaltung zu.</>
          )}
        </p>
        <Field label="Lernfreier Tag">
          <select value={rest} onChange={(e) => setRest(Number(e.target.value))}>
            <option value={7}>Sonntag</option>
            <option value={6}>Samstag</option>
            <option value={0}>keiner</option>
          </select>
        </Field>
        {existing.length > 0 && (
          <p className="small notice notice-warn">
            Es gibt schon einen Lernplan ({existing.filter((t) => t.done_at).length} von {existing.length} erledigt). Offene Schritte werden ersetzt, erledigte bleiben.
          </p>
        )}
        {error && <p className="error-text small">{error}</p>}
        <div className="list plan-preview">
          {plan.map((p, i) => (
            <div key={i} className="list-row">
              <span className="tnum small muted plan-date">{formatDate(p.due_date + "T12:00:00")}</span>
              <span className="grow ellipsis">{p.title}</span>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
