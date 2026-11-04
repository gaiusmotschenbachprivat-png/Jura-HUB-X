/**
 * Kacheln der Übersicht: Jetzt, Heute lernen, Nächste Prüfung, Offene Enden,
 * Veranstaltungen, Gedanke festhalten, Zuletzt bearbeitet.
 */
import { AlarmClock, BookOpenCheck, CircleHelp, ClipboardList, FileText, GraduationCap, Inbox, Mic, NotebookPen, Play, Sparkles, Timer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../api";
import type { StudyNode } from "../../api/types";
import { GOAL_SETTING, isReviewed, lectureNow, lecturesDoneToday, nextOccurrence, streak, whenLabel } from "../../lib/dashboard";
import { formatRelative } from "../../lib/format";
import { descendantIds } from "../../lib/learnStats";
import { lectureDoc, lectureTitle, nextLectureNumber, noteTypeOf, todayIso } from "../../lib/noteTypes";
import { doc as pmDoc, parseDoc, plainText, type PMNode } from "../../lib/pm";
import { buildTree } from "../../lib/tree";
import { lectureOn, slotsOnDate, type Slot } from "../../lib/timetable";
import { reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import type { StudyMode } from "../assistant/StudyTools";
import { requestEntryJump } from "../editor/erklaerungen";
import { requestResume, requestStudy } from "../editor/pending";
import { useCardStats } from "../learn/CardsView";
import { createNode, openNode } from "../navigation/actions";
import { NodeIcon } from "../navigation/icons";
import { daysUntil } from "../planning/PlanningView";
import { PlanBar, planProgress } from "../planning/StudyPlan";
import { startRecording } from "../recording/Recording";
import { notesOfType, type DashboardData } from "./data";

const useNow = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
};

const openNote = (n: { id: string; title: string }) => useApp.getState().open({ type: "note", id: n.id }, { title: n.title });

/** Mitschrift öffnen und direkt eine KI-Lernhilfe anbieten. */
const study = (n: StudyNode, mode: StudyMode) => {
  requestStudy(n.id, mode);
  openNote(n);
};

/** Vorlesung mit einem Tipp: Mitschrift anlegen, letzte Folien daneben, auf Wunsch Aufnahme. */
async function startLecture(course: StudyNode, nodes: StudyNode[], record: boolean) {
  const nr = nextLectureNumber(nodes, course.id, course.area_id);
  const title = lectureTitle(nr, "");
  const date = todayIso();
  const lecturer = typeof course.meta?.lecturer === "string" ? course.meta.lecturer : undefined;
  const prev = nodes
    .filter((n) => n.parent_id === course.id && !n.deleted_at && noteTypeOf(n) === "vorlesung" && n.meta?.slides)
    .sort((a, b) => (Number(b.meta.number) || 0) - (Number(a.meta.number) || 0) || b.created_at.localeCompare(a.created_at))[0];
  const slides = prev?.meta.slides as { document_id: string; page: number } | undefined;
  const n = await createNode({
    areaId: course.area_id,
    parentId: course.id,
    kind: "note",
    title,
    meta: { noteType: "vorlesung", date, number: nr, ...(lecturer ? { lecturer } : {}), ...(slides ? { slides } : {}) },
    templateId: "mitschrift",
    contentJson: JSON.stringify(lectureDoc({ title, date, lecturer, course: course.title })),
  });
  if (!n) return;
  if (slides?.document_id) useApp.getState().openSecondary({ type: "document", id: slides.document_id, page: slides.page || 1 });
  if (record) await startRecording(n.id, title).catch(reportError);
}

// ---------- Jetzt ----------

export function NowWidget({ data }: { data: DashboardData }) {
  const now = useNow();
  const areaId = useApp((s) => s.areaId);
  const scope = areaId === "all" ? null : areaId;
  const [record, setRecord] = useState(false);
  const [busy, setBusy] = useState(false);
  const inScope = useMemo(() => data.nodes.filter((n) => !scope || n.area_id === scope), [data.nodes, scope]);
  const today = todayIso();
  const slotsOn = (iso: string) => slotsOnDate(inScope, iso);
  const todaySlots = slotsOn(today);
  const live = lectureNow(todaySlots, now);
  const pending = lecturesDoneToday(todaySlots, now)
    .map((s) => ({ slot: s, note: lectureOn(data.nodes, s.course.id, today) }))
    .filter((x): x is { slot: Slot; note: StudyNode } => !!x.note && !isReviewed(x.note, null, data.nodes, data.cardSources) && !data.scans.get(x.note.id)?.lernskript);
  const courses = [...new Set(inScope.filter((n) => n.kind === "course").map((n) => n.id))];
  const next = courses
    .map((id) => ({ s: { course: inScope.find((n) => n.id === id)! }, at: nextOccurrence(slotsOn, id, now) }))
    .filter((x) => x.at && x.at.date > now)
    .sort((a, b) => a.at!.date.getTime() - b.at!.date.getTime())[0];
  const last = data.recent[0];

  let body: React.ReactNode;
  if (live) {
    const existing = lectureOn(data.nodes, live.slot.course.id, today);
    body = (
      <>
        <div className="now-title">
          <AlarmClock size={18} />
          <span>
            <strong>{live.slot.course.title}</strong> {live.phase === "bald" ? `beginnt in ${live.minutes} Min.` : `läuft seit ${live.minutes} Min.`}
            {live.slot.room && <span className="muted"> · {live.slot.room}</span>}
          </span>
        </div>
        <div className="row wrap">
          {existing ? (
            <Button variant="primary" icon={<NotebookPen size={15} />} onClick={() => openNode(existing)}>
              Mitschrift öffnen
            </Button>
          ) : (
            <>
              <Button
                variant="primary"
                icon={<Play size={15} />}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await startLecture(live.slot.course, data.nodes, record).finally(() => setBusy(false));
                }}
              >
                Mitschrift starten
              </Button>
              <label className="row small">
                <input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} />
                <Mic size={14} /> mit Aufnahme
              </label>
            </>
          )}
        </div>
        <p className="xs muted">Legt die nächste nummerierte Vorlesung an und öffnet die zuletzt benutzten Folien daneben.</p>
      </>
    );
  } else if (pending.length) {
    body = (
      <>
        <div className="now-title">
          <Sparkles size={18} />
          <span>
            Heute {pending.length === 1 ? "1 Vorlesung" : `${pending.length} Vorlesungen`} – noch nicht nachbereitet
          </span>
        </div>
        {pending.map(({ slot, note }) => (
          <div key={note.id} className="now-row">
            <button className="grow ellipsis link-like" onClick={() => openNode(note)}>
              <strong>{slot.course.title}</strong> · {note.title}
            </button>
            <Button size="sm" onClick={() => study(note, "aufbereiten")}>
              Lernskript
            </Button>
            <Button size="sm" onClick={() => study(note, "karteikarten")}>
              Karteikarten
            </Button>
          </div>
        ))}
      </>
    );
  } else if (last) {
    body = (
      <>
        <div className="now-title">
          <NotebookPen size={18} />
          <span>
            Weiter bei{" "}
            <button
              className="link-like"
              onClick={() => {
                requestResume(last.node_id);
                openNote({ id: last.node_id, title: last.title });
              }}
            >
              <strong>{last.title}</strong>
            </button>{" "}
            <span className="muted small">· {formatRelative(last.updated_at)}</span>
          </span>
        </div>
        <div className="row wrap">
          <Button
            variant="primary"
            icon={<Play size={15} />}
            onClick={() => {
              requestResume(last.node_id);
              openNote({ id: last.node_id, title: last.title });
            }}
          >
            Weiterschreiben
          </Button>
        </div>
      </>
    );
  } else {
    body = <p className="small muted">Noch nichts begonnen. Lege links eine Veranstaltung an oder starte mit „Neu …“.</p>;
  }
  return (
    <section className="card dash-card now-card" aria-label="Jetzt">
      <h3 className="label">Jetzt</h3>
      {body}
      {next && !live && (
        <p className="xs muted now-next">
          Als Nächstes: <strong>{next.s.course.title}</strong> {whenLabel(next.at!.date, now)}
          {next.at!.slot.room ? ` · ${next.at!.slot.room}` : ""}
        </p>
      )}
    </section>
  );
}

// ---------- Heute lernen ----------

const DAY_LETTERS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

export function LearnWidget() {
  const stats = useCardStats();
  const open = useApp((s) => s.open);
  const [goal, setGoal] = useState(20);
  useEffect(() => {
    void api.settingsAll().then((s) => {
      const g = Number(s[GOAL_SETTING]);
      if (g > 0) setGoal(g);
    });
  }, []);
  const days = stats?.reviews_by_day ?? [0, 0, 0, 0, 0, 0, 0];
  const max = Math.max(goal, ...days, 1);
  const today = stats?.reviewed_today ?? 0;
  const s = streak(days);
  const wd = new Date().getDay();
  return (
    <section className="card dash-card" aria-label="Heute lernen">
      <div className="row">
        <h3 className="label grow">Heute lernen</h3>
        <label className="xs muted row">
          Tagesziel
          <select
            aria-label="Tagesziel"
            value={goal}
            onChange={(e) => {
              const g = Number(e.target.value);
              setGoal(g);
              void api.settingSet(GOAL_SETTING, g).catch(() => {});
            }}
          >
            {[10, 20, 30, 50, 100].map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="learn-today">
        <div>
          <div className="big tnum">{stats?.due_now ?? "–"}</div>
          <div className="xs muted">fällig</div>
        </div>
        <div className="grow">
          <div className="goal-bar" title={`${today} von ${goal} Wiederholungen heute`}>
            <span style={{ width: `${Math.min(100, (today / goal) * 100)}%` }} />
          </div>
          <div className="xs muted tnum">
            {today} von {goal} heute{today >= goal ? " – Ziel erreicht" : ""}
          </div>
        </div>
      </div>
      <div className="week-bars" aria-label="Wiederholungen der letzten 7 Tage">
        {days.map((n, i) => (
          <div key={i} className="week-bar" title={`${n} Wiederholungen`}>
            <span className={n >= goal ? "is-goal" : n ? "is-some" : ""} style={{ height: `${Math.max(n ? 12 : 4, (n / max) * 100)}%` }} />
            <em className="xs">{DAY_LETTERS[(wd - 6 + i + 7) % 7]}</em>
          </div>
        ))}
      </div>
      <p className="xs muted">{s ? `${s} ${s === 1 ? "Tag" : "Tage"} in Folge gelernt` : "Heute ist ein guter Tag zum Anfangen."}</p>
      <div className="row wrap">
        <Button variant={stats?.due_now ? "primary" : "secondary"} icon={<GraduationCap size={15} />} onClick={() => open(stats?.due_now ? { type: "learn" } : { type: "cards" })}>
          {stats?.due_now ? `${stats.due_now} wiederholen` : "Karteikarten"}
        </Button>
        <Button icon={<Timer size={15} />} onClick={() => open({ type: "learn", minutes: 15, label: "15 Minuten" })}>
          15 Minuten lernen
        </Button>
      </div>
    </section>
  );
}

// ---------- Nächste Prüfung ----------

export function ExamWidget({ data }: { data: DashboardData }) {
  const open = useApp((s) => s.open);
  const [first, ...rest] = data.exams;
  if (!first)
    return (
      <section className="card dash-card" aria-label="Nächste Prüfung">
        <h3 className="label">Nächste Prüfung</h3>
        <p className="small muted">Keine Prüfung eingetragen.</p>
        <Button size="sm" onClick={() => open({ type: "planning" })}>
          Prüfung eintragen
        </Button>
      </section>
    );
  const days = daysUntil(first.date);
  const pr = planProgress(data.tasks, first.id);
  const scopeIds = first.node_id ? descendantIds(data.nodes, first.node_id) : null;
  const cards = data.cards.filter((c) => !c.suspended && !c.deleted_at && (!scopeIds || (c.node_id != null && scopeIds.has(c.node_id))));
  const safe = cards.filter((c) => c.state === 2).length;
  return (
    <section className="card dash-card exam-widget" aria-label="Nächste Prüfung">
      <h3 className="label">Nächste Prüfung</h3>
      <div className="exam-big">
        <span className={`exam-days tnum ${days <= 28 ? "is-soon" : ""}`}>{days}</span>
        <span className="grow" style={{ minWidth: 0 }}>
          <strong className="block ellipsis">{first.title}</strong>
          <span className="xs muted">{days === 0 ? "heute" : days === 1 ? "morgen" : `in ${days} Tagen`}</span>
        </span>
      </div>
      {pr.total ? <PlanBar {...pr} /> : <p className="xs muted">Noch kein Lernplan.</p>}
      {cards.length > 0 && (
        <div className="xs muted">
          Karteikarten: {safe} von {cards.length} sicher
          <div className="goal-bar thin">
            <span style={{ width: `${(safe / cards.length) * 100}%` }} />
          </div>
        </div>
      )}
      <div className="row wrap">
        <Button size="sm" onClick={() => open({ type: "planning" })}>
          {pr.total ? "Lernplan" : "Lernplan erstellen"}
        </Button>
        {first.node_id && cards.length > 0 && (
          <Button size="sm" onClick={() => open({ type: "learn", node: first.node_id!, label: first.title })}>
            Karten dieses Fachs
          </Button>
        )}
      </div>
      {rest.length > 0 && (
        <ul className="exam-rest">
          {rest.slice(0, 3).map((e) => (
            <li key={e.id} className="xs">
              <span className="tnum muted">{daysUntil(e.date)} T.</span> {e.title}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- Offene Enden ----------

interface OpenItem {
  key: string;
  icon: React.ReactNode;
  text: React.ReactNode;
  actions?: React.ReactNode;
  onOpen: () => void;
}

export function OpenEndsWidget({ data }: { data: DashboardData }) {
  const areaId = useApp((s) => s.areaId);
  const open = useApp((s) => s.open);
  const scope = areaId === "all" ? null : areaId;
  const [all, setAll] = useState(false);
  const items = useMemo(() => {
    const out: OpenItem[] = [];
    const since = Date.now() - 21 * 86400000;
    const notes = data.nodes.filter((n) => n.kind === "note" && !n.deleted_at && !n.archived_at && (!scope || n.area_id === scope));
    // Vorlesungen der letzten drei Wochen und Mitschriften mit Aufnahme, die noch nicht nachbereitet sind
    for (const n of notes) {
      const scan = data.scans.get(n.id);
      const lecture = noteTypeOf(n) === "vorlesung";
      const recent = Date.parse(typeof n.meta?.date === "string" ? n.meta.date : n.created_at) >= since;
      if (!((lecture && recent) || scan?.recording)) continue;
      if (scan?.lernskript || isReviewed(n, null, data.nodes, data.cardSources)) continue;
      out.push({
        key: `r-${n.id}`,
        icon: scan?.recording ? <Mic size={14} /> : <NotebookPen size={14} />,
        text: (
          <>
            {n.title} <span className="muted">· {scan?.recording ? "Aufnahme ohne Lernskript" : "nicht nachbereitet"}</span>
          </>
        ),
        actions: (
          <>
            <Button size="sm" onClick={() => study(n, "aufbereiten")}>
              Lernskript
            </Button>
            <Button size="sm" onClick={() => study(n, "karteikarten")}>
              Karten
            </Button>
          </>
        ),
        onOpen: () => openNode(n),
      });
    }
    for (const n of notes) {
      const scan = data.scans.get(n.id);
      for (const q of scan?.questions ?? [])
        out.push({ key: `q-${n.id}-${q}`, icon: <CircleHelp size={14} />, text: <>{q} <span className="muted">· {n.title}</span></>, onOpen: () => openNode(n) });
      for (const t of scan?.missing ?? [])
        out.push({
          key: `e-${n.id}-${t}`,
          icon: <BookOpenCheck size={14} />,
          text: (
            <>
              „{t}“ <span className="muted">· Erklärung fehlt · {n.title}</span>
            </>
          ),
          onOpen: () => {
            requestEntryJump(n.id, t);
            openNote(n);
          },
        });
    }
    for (const t of data.tasks.filter((x) => !x.done_at && !x.deleted_at && x.kind !== "lernziel").slice(0, 6))
      out.push({
        key: `t-${t.id}`,
        icon: <ClipboardList size={14} />,
        text: (
          <>
            {t.title}
            {t.due_date && <span className="muted"> · fällig {formatRelative(`${t.due_date}T12:00:00`)}</span>}
          </>
        ),
        onOpen: () => open({ type: "planning" }),
      });
    for (const s of data.sheets)
      out.push({ key: `s-${s.id}`, icon: <FileText size={14} />, text: <>{s.title} <span className="muted">· Übungsblatt ohne Lösung</span></>, onOpen: () => open({ type: "document", id: s.id }, { title: s.title }) });
    const sessions = data.nodes.filter((n) => n.kind === "session" && !n.archived_at && !n.deleted_at && (!scope || n.area_id === scope));
    for (const s of sessions.filter((s) => !data.nodes.some((c) => c.parent_id === s.id && c.kind === "note" && !c.deleted_at)).slice(0, 5))
      out.push({ key: `v-${s.id}`, icon: <Inbox size={14} />, text: <>{s.title} <span className="muted">· Termin ohne Mitschrift</span></>, onOpen: () => openNode(s) });
    return out;
  }, [data, scope, open]);
  const shown = all ? items : items.slice(0, 8);
  return (
    <section className="card dash-card" aria-label="Offene Enden">
      <div className="row">
        <h3 className="label grow">Offene Enden{items.length ? ` (${items.length})` : ""}</h3>
      </div>
      {!items.length ? (
        <p className="small muted">{data.scans.size ? "Alles erledigt – nichts liegt herum." : "Sehe Mitschriften durch …"}</p>
      ) : (
        <div className="open-list" role="list">
          {shown.map((it) => (
            <div key={it.key} className="open-row" role="listitem">
              <span className="open-icon">{it.icon}</span>
              <button className="grow open-text" onClick={it.onOpen}>
                {it.text}
              </button>
              {it.actions && <span className="row open-actions">{it.actions}</span>}
            </div>
          ))}
          {items.length > 8 && (
            <button className="link-btn xs" onClick={() => setAll(!all)}>
              {all ? "Weniger zeigen" : `Alle ${items.length} zeigen`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ---------- Veranstaltungen ----------

export function CoursesWidget({ data }: { data: DashboardData }) {
  const now = useNow();
  const areaId = useApp((s) => s.areaId);
  const areas = useApp((s) => s.areas);
  const scope = areaId === "all" ? null : areaId;
  const slotsOn = (iso: string) => slotsOnDate(data.nodes, iso);
  const courses = useMemo(() => {
    // Veranstaltungen des jeweils neuesten Semesters je Bereich, sonst alle nicht archivierten
    const out: StudyNode[] = [];
    for (const a of areas.filter((x) => !x.archived_at && (!scope || x.id === scope))) {
      const mine = data.nodes.filter((n) => n.area_id === a.id && !n.deleted_at);
      const sem = mine.filter((n) => n.kind === "semester" && !n.archived_at).sort((x, y) => y.created_at.localeCompare(x.created_at))[0];
      const tree = buildTree(mine);
      const collect = (items: ReturnType<typeof buildTree>, inside: boolean) => {
        for (const it of items) {
          const here = inside || !sem || it.node.id === sem.id;
          if (here && it.node.kind === "course" && !it.node.archived_at) out.push(it.node);
          else collect(it.children, here);
        }
      };
      collect(tree, false);
    }
    return out.slice(0, 12);
  }, [data.nodes, areas, scope]);
  const lectures = notesOfType(data.nodes, scope, "vorlesung");
  if (!courses.length)
    return (
      <section className="card dash-card" aria-label="Veranstaltungen">
        <h3 className="label">Veranstaltungen</h3>
        <p className="small muted">Noch keine Veranstaltungen. In der Seitenleiste unter einem Semester anlegen – mit Wochentag und Uhrzeit erscheinen sie im Stundenplan.</p>
      </section>
    );
  return (
    <section className="card dash-card" aria-label="Veranstaltungen">
      <h3 className="label">Veranstaltungen</h3>
      <div className="course-tiles">
        {courses.map((c) => {
          const ids = descendantIds(data.nodes, c.id);
          const mine = lectures.filter((l) => ids.has(l.id));
          const done = mine.filter((l) => data.scans.get(l.id)?.lernskript || isReviewed(l, null, data.nodes, data.cardSources)).length;
          const next = nextOccurrence(slotsOn, c.id, now);
          const color = areas.find((a) => a.id === c.area_id)?.color;
          return (
            <button key={c.id} className="course-tile" style={{ ["--area" as string]: color }} onClick={() => openNode(c)}>
              <strong className="ellipsis block">{c.title}</strong>
              <span className="xs muted block">{next ? whenLabel(next.date, now) : "kein fester Termin"}</span>
              <span className="xs muted block tnum">
                {mine.length} {mine.length === 1 ? "Vorlesung" : "Vorlesungen"}
                {mine.length ? ` · ${done} nachbereitet` : ""}
              </span>
              {mine.length > 0 && (
                <span className="goal-bar thin">
                  <span style={{ width: `${(done / mine.length) * 100}%` }} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ---------- Gedanke festhalten ----------

const INBOX = "Eingang";

export function QuickNoteWidget({ data }: { data: DashboardData }) {
  const areaId = useApp((s) => s.areaId);
  const areas = useApp((s) => s.areas);
  const toast = useApp((s) => s.toast);
  const bump = useApp((s) => s.bump);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const target = areaId === "all" ? areas.find((a) => !a.archived_at)?.id : areaId;
  const inbox = data.nodes.find((n) => n.kind === "note" && !n.deleted_at && n.parent_id === null && n.area_id === target && n.title === INBOX);
  const save = async () => {
    const t = text.trim();
    if (!t || !target) return;
    setBusy(true);
    try {
      let id = inbox?.id;
      if (!id) {
        const n = await createNode({ areaId: target, parentId: null, kind: "note", title: INBOX, meta: { noteType: "notiz" }, openAfter: false, contentJson: JSON.stringify(pmDoc({ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: INBOX }] })) });
        id = n?.id;
      }
      if (!id) return;
      const note = await api.noteGet(id);
      const d = parseDoc(note.content_json);
      const now = new Date();
      const stamp = `${now.getDate()}.${now.getMonth() + 1}. ${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")} `;
      const para: PMNode = { type: "paragraph", content: [{ type: "text", text: stamp, marks: [{ type: "bold" }] }, { type: "text", text: t }] };
      const next = { ...d, content: [...(d.content ?? []), para] };
      await api.noteSave(id, JSON.stringify(next), plainText(next));
      setText("");
      bump();
      toast(`In „${INBOX}“ festgehalten.`, "success");
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card dash-card quick-note" aria-label="Gedanke festhalten">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Inbox size={16} className="muted" />
        <input className="grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Gedanke festhalten … (landet in „Eingang“)" aria-label="Gedanke festhalten" maxLength={2000} />
        <Button type="submit" size="sm" variant="primary" disabled={busy || !text.trim()}>
          Festhalten
        </Button>
        {inbox && (
          <Button size="sm" variant="ghost" onClick={() => openNode(inbox)}>
            Eingang öffnen
          </Button>
        )}
      </form>
    </section>
  );
}

// ---------- Zuletzt bearbeitet ----------

export function RecentWidget({ data }: { data: DashboardData }) {
  const open = useApp((s) => s.open);
  return (
    <section className="card dash-card" aria-label="Zuletzt bearbeitet">
      <h3 className="label">Zuletzt bearbeitet</h3>
      {!data.recent.length ? (
        <p className="muted small">Noch keine Notizen.</p>
      ) : (
        <div className="list">
          {data.recent.map((n) => (
            <button key={n.node_id} className="list-row" onClick={() => open({ type: "note", id: n.node_id }, { title: n.title })}>
              <NodeIcon node={data.nodes.find((x) => x.id === n.node_id) ?? { kind: "note", meta: {} }} />
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="ellipsis block">{n.title}</span>
                {n.path && <span className="xs muted ellipsis block">{n.path}</span>}
              </span>
              <span className="xs muted">{formatRelative(n.updated_at)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
