import { useMemo, useState } from "react";

import type { StudyNode } from "../../api/types";
import { courseSlots, fmtTime, isoWeekday, lectureOn, WEEKDAYS, type Slot } from "../../lib/timetable";
import { todayIso } from "../../lib/noteTypes";
import { areaById, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { NewNodeDialog, type NewNodeRequest } from "../navigation/NewNodeDialog";
import { NoteTypeIcon } from "../navigation/icons";
import { openNode } from "../navigation/actions";

const HOUR = 72; // Pixel je Stunde (90 Minuten reichen für Titel, Zeit und Knopf)

/** Knopf „Mitschrift starten/öffnen“ für die heutige Vorlesung einer Veranstaltung. */
export function TodayLectureButton({ course, onNew }: { course: StudyNode; onNew: (r: NewNodeRequest) => void }) {
  const nodes = useApp((s) => s.nodes);
  const existing = lectureOn(nodes, course.id, todayIso());
  return existing ? (
    <Button size="sm" icon={<NoteTypeIcon type="vorlesung" size={13} plain />} onClick={() => openNode(existing)}>
      Mitschrift öffnen
    </Button>
  ) : (
    <Button size="sm" variant="primary" icon={<NoteTypeIcon type="vorlesung" size={13} plain />} onClick={() => onNew({ parentId: course.id, areaId: course.area_id, noteType: "vorlesung" })}>
      Mitschrift starten
    </Button>
  );
}

/** Heutige Veranstaltungen (für die Übersicht). */
export function useTodaySlots(): Slot[] {
  const nodes = useApp((s) => s.nodes);
  const areaId = useApp((s) => s.areaId);
  return useMemo(() => {
    const day = isoWeekday(todayIso());
    return courseSlots(nodes).slots.filter((s) => s.day === day && (areaId === "all" || s.course.area_id === areaId));
  }, [nodes, areaId]);
}

export function TimetableView() {
  const nodes = useApp((s) => s.nodes);
  const areaId = useApp((s) => s.areaId);
  const [newReq, setNewReq] = useState<NewNodeRequest | null>(null);
  const { slots, unscheduled } = useMemo(() => {
    const r = courseSlots(nodes);
    const inScope = (n: StudyNode) => areaId === "all" || n.area_id === areaId;
    return { slots: r.slots.filter((s) => inScope(s.course)), unscheduled: r.unscheduled.filter(inScope) };
  }, [nodes, areaId]);
  const today = isoWeekday(todayIso());
  const days = [1, 2, 3, 4, 5, ...[6, 7].filter((d) => slots.some((s) => s.day === d))];
  const from = Math.min(8 * 60, ...slots.map((s) => Math.floor(s.start / 60) * 60));
  const to = Math.max(18 * 60, ...slots.map((s) => Math.ceil(s.end / 60) * 60));
  const hours = Array.from({ length: (to - from) / 60 }, (_, i) => from / 60 + i);

  return (
    <div className="page timetable-page">
      <header className="page-head">
        <div className="small muted">Planung</div>
        <h1 className="page-title-static">Stundenplan</h1>
        <p className="small muted">Aus Wochentag, Uhrzeit und Ort deiner Veranstaltungen. Am Vorlesungstag: „Mitschrift starten“.</p>
      </header>
      <div className="timetable" style={{ gridTemplateColumns: `48px repeat(${days.length}, minmax(0, 1fr))` }}>
        <div />
        {days.map((d) => (
          <div key={d} className={`tt-day ${d === today ? "is-today" : ""}`}>
            {WEEKDAYS[d - 1]}
          </div>
        ))}
        <div className="tt-hours" style={{ height: hours.length * HOUR }}>
          {hours.map((h) => (
            <div key={h} className="tt-hour tnum" style={{ top: (h * 60 - from) * (HOUR / 60) }}>
              {h}:00
            </div>
          ))}
        </div>
        {days.map((d) => (
          <div key={d} className={`tt-col ${d === today ? "is-today" : ""}`} style={{ height: hours.length * HOUR }}>
            {hours.map((h) => (
              <div key={h} className="tt-line" style={{ top: (h * 60 - from) * (HOUR / 60) }} />
            ))}
            {slots
              .filter((s) => s.day === d)
              .map((s) => {
                const color = areaById(s.course.area_id)?.color ?? "#5b6170";
                return (
                  <div
                    key={`${s.course.id}-${d}`}
                    className="tt-slot"
                    style={{ top: (s.start - from) * (HOUR / 60), height: Math.max(34, (s.end - s.start) * (HOUR / 60) - 2), "--slot": color } as React.CSSProperties}
                  >
                    <button className="tt-slot-main" onClick={() => openNode(s.course)}>
                      <strong className="ellipsis block">{s.course.title}</strong>
                      <span className="xs block tnum">
                        {fmtTime(s.start)}–{fmtTime(s.end)}
                        {s.room ? ` · ${s.room}` : ""}
                      </span>
                    </button>
                    {d === today && <TodayLectureButton course={s.course} onNew={setNewReq} />}
                  </div>
                );
              })}
          </div>
        ))}
      </div>
      {unscheduled.length > 0 && (
        <section className="section" style={{ marginTop: 20 }}>
          <h3 className="label">Ohne Termin</h3>
          <p className="small muted">Bei diesen Veranstaltungen fehlen Wochentag oder Uhrzeit (unter „Angaben“, z. B. „Mo, Do“ und „10:15–11:45“).</p>
          <div className="chips">
            {unscheduled.map((n) => (
              <button key={n.id} className="chip chip-btn" onClick={() => openNode(n)}>
                {n.title}
              </button>
            ))}
          </div>
        </section>
      )}
      {newReq && <NewNodeDialog req={newReq} onClose={() => setNewReq(null)} />}
    </div>
  );
}
