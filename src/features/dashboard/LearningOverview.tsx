/**
 * Ruhige Lernübersicht: was steht an? Keine Punkte, keine Abzeichen.
 */
import { GraduationCap } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../api";
import type { DocumentInfo, Exam, LinkView, StudyNode, Task } from "../../api/types";
import { formatDate } from "../../lib/format";
import { useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { openNode } from "../navigation/actions";
import { KindIcon } from "../navigation/icons";
import { useCardStats } from "../learn/CardsView";
import { daysUntil, relDays, todayIso } from "../planning/PlanningView";

export function LearningOverview({ allNodes }: { allNodes: StudyNode[] }) {
  const areaId = useApp((s) => s.areaId);
  const dataVersion = useApp((s) => s.dataVersion);
  const open = useApp((s) => s.open);
  const stats = useCardStats();
  const [exams, setExams] = useState<Exam[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sheets, setSheets] = useState<DocumentInfo[]>([]);
  const scope = areaId === "all" ? null : areaId;

  useEffect(() => {
    api.examsList(scope, todayIso()).then((e) => setExams(e.slice(0, 5))).catch(() => {});
    api.tasksList({ area_id: scope }).then((t) => setTasks(t.slice(0, 8))).catch(() => {});
    // Übungsblätter ohne verknüpfte Notiz gelten als unbearbeitet
    api
      .documentsList(scope ? { kind: "area", id: scope } : { kind: "all" })
      .then(async (docs) => {
        const ex = docs.filter((d) => d.doc_type === "uebungsblatt");
        const withLinks = await Promise.all(ex.map(async (d) => [d, await api.linksFor("document", d.id).catch(() => [] as LinkView[])] as const));
        setSheets(withLinks.filter(([, l]) => l.length === 0).map(([d]) => d).slice(0, 5));
      })
      .catch(() => {});
  }, [scope, dataVersion]);

  // Vorlesungstermine der Vergangenheit/Gegenwart ohne Notiz darunter
  const sessions = allNodes.filter((n) => n.kind === "session" && !n.archived_at && (!scope || n.area_id === scope));
  const unsummarized = sessions.filter((s) => !allNodes.some((c) => c.parent_id === s.id && c.kind === "note")).slice(0, 5);
  const goals = tasks.filter((t) => t.kind === "lernziel");
  const open_ = tasks.filter((t) => t.kind !== "lernziel");

  return (
    <section className="card learn-card">
      <div className="row">
        <h3 className="label grow">Lernübersicht</h3>
        <Button size="sm" variant={stats?.due_now ? "primary" : "secondary"} icon={<GraduationCap size={14} />} onClick={() => open(stats?.due_now ? { type: "learn" } : { type: "cards" })}>
          {stats?.due_now ? `${stats.due_now} Karten wiederholen` : "Karteikarten"}
        </Button>
      </div>
      <div className="lo-grid">
        <div>
          <div className="lo-head">Anstehende Prüfungen</div>
          {exams.length === 0 ? (
            <p className="muted xs">Keine eingetragen.</p>
          ) : (
            exams.map((e) => (
              <button key={e.id} className="lo-row" onClick={() => open({ type: "planning" })}>
                <KindIcon kind="exam" size={14} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="block lo-title">{e.title}</span>
                  <span className="xs muted tnum block">
                    {formatDate(e.date + "T12:00:00")} · {relDays(daysUntil(e.date))}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
        <div>
          <div className="lo-head">Offene Aufgaben und Fragen</div>
          {open_.length === 0 ? (
            <p className="muted xs">Nichts offen.</p>
          ) : (
            open_.map((t) => (
              <button key={t.id} className="lo-row" onClick={() => open({ type: "planning" })}>
                <KindIcon kind="task" size={14} />
                <span className="grow ellipsis">{t.title}</span>
                {t.due_date && <span className="xs muted">{relDays(daysUntil(t.due_date))}</span>}
              </button>
            ))
          )}
        </div>
        <div>
          <div className="lo-head">Noch nicht zusammengefasst</div>
          {unsummarized.length === 0 ? (
            <p className="muted xs">Zu jedem Vorlesungstermin gibt es eine Notiz.</p>
          ) : (
            unsummarized.map((s) => (
              <button key={s.id} className="lo-row" onClick={() => openNode(s)}>
                <KindIcon kind="session" size={14} />
                <span className="grow ellipsis">{s.title}</span>
              </button>
            ))
          )}
        </div>
        <div>
          <div className="lo-head">Unbearbeitete Übungsblätter</div>
          {sheets.length === 0 ? (
            <p className="muted xs">Keine (Übungsblätter ohne verknüpfte Notiz).</p>
          ) : (
            sheets.map((d) => (
              <button key={d.id} className="lo-row" onClick={() => open({ type: "document", id: d.id }, { title: d.title })}>
                <KindIcon kind="document" size={14} />
                <span className="grow ellipsis">{d.title}</span>
              </button>
            ))
          )}
        </div>
        {goals.length > 0 && (
          <div>
            <div className="lo-head">Lernziele</div>
            {goals.map((t) => (
              <button key={t.id} className="lo-row" onClick={() => open({ type: "planning" })}>
                <KindIcon kind="lernziel" size={14} />
                <span className="grow ellipsis">{t.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {stats && stats.total > 0 && (
        <p className="xs muted tnum" style={{ marginTop: 10 }}>
          {stats.reviewed_today} Wiederholungen heute · {stats.due_7d} Karten in den nächsten 7 Tagen fällig
          {stats.retention_30d != null && ` · ${Math.round(stats.retention_30d * 100)} % gewusst (30 Tage)`}
        </p>
      )}
    </section>
  );
}
