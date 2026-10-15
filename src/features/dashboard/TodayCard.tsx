import { CalendarDays, GraduationCap } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../api";
import type { Exam, Task } from "../../api/types";
import { isoWeekday, fmtTime, WEEKDAYS } from "../../lib/timetable";
import { todayIso } from "../../lib/noteTypes";
import { useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { NewNodeDialog, type NewNodeRequest } from "../navigation/NewNodeDialog";
import { openNode } from "../navigation/actions";
import { daysUntil } from "../planning/PlanningView";
import { PlanBar, planProgress } from "../planning/StudyPlan";
import { TodayLectureButton, useTodaySlots } from "../planning/TimetableView";

/** Übersicht: heutige Veranstaltungen und Klausurenphase (Klausur in ≤ 28 Tagen). */
export function TodayCard() {
  const slots = useTodaySlots();
  const open = useApp((s) => s.open);
  const areaId = useApp((s) => s.areaId);
  const dataVersion = useApp((s) => s.dataVersion);
  const [newReq, setNewReq] = useState<NewNodeRequest | null>(null);
  const [exams, setExams] = useState<Exam[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  useEffect(() => {
    const scope = areaId === "all" ? null : areaId;
    api.examsList(scope, todayIso()).then((e) => setExams(e.filter((x) => daysUntil(x.date) <= 28))).catch(() => {});
    api.tasksList({ area_id: null, include_done: true }).then(setTasks).catch(() => {});
  }, [areaId, dataVersion]);

  if (!slots.length && !exams.length) return null;
  return (
    <>
      {exams.length > 0 && (
        <section className="today-card" aria-label="Klausurenphase">
          <h3 className="label row">
            <GraduationCap size={14} /> Klausurenphase
          </h3>
          {exams.map((e) => {
            const n = daysUntil(e.date);
            const pr = planProgress(tasks, e.id);
            return (
              <div key={e.id} className="today-row phase-banner">
                <span className="exam-days tnum is-soon">{n}</span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <strong className="ellipsis block">{e.title}</strong>
                  <span className="xs muted">{n === 0 ? "heute" : n === 1 ? "morgen" : `in ${n} Tagen`}</span>
                  <PlanBar {...pr} />
                </span>
                <Button size="sm" onClick={() => open({ type: "planning" })}>
                  {pr.total ? "Lernplan ansehen" : "Lernplan erstellen"}
                </Button>
              </div>
            );
          })}
        </section>
      )}
      {slots.length > 0 && (
        <section className="today-card" aria-label="Heute">
          <h3 className="label row">
            <CalendarDays size={14} /> Heute · {WEEKDAYS[isoWeekday(todayIso()) - 1]}
          </h3>
          {slots.map((s) => (
            <div key={s.course.id} className="today-row">
              <span className="today-time tnum">
                {fmtTime(s.start)}–{fmtTime(s.end)}
              </span>
              <button className="grow ellipsis today-course" onClick={() => openNode(s.course)}>
                <strong>{s.course.title}</strong>
                {s.room && <span className="muted small"> · {s.room}</span>}
              </button>
              <TodayLectureButton course={s.course} onNew={setNewReq} />
            </div>
          ))}
        </section>
      )}
      {newReq && <NewNodeDialog req={newReq} onClose={() => setNewReq(null)} />}
    </>
  );
}
