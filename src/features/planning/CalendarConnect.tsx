/** Stundenplan: Uni-Kalender verbinden (Abo-Link) oder Kalenderdatei importieren, mit Vorschau. */
import { CalendarSync, FileUp, Link2, RefreshCw, Unlink } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../api";
import type { StudyNode } from "../../api/types";
import { formatRelative } from "../../lib/format";
import { weekdayText, type ImportCourse, type ImportPlan } from "../../lib/stundenplanImport";
import { fmtTime } from "../../lib/timetable";
import { reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/misc";
import { applyPlan, calendarArea, connectLink, coursesFromIcs, disconnect, loadCalendarState, planFor, rememberChoice, syncCalendarIfDue, type CalendarState } from "./calendarSync";

export function CalendarConnect() {
  const [state, setState] = useState<CalendarState | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ courses: ImportCourse[]; link?: URL } | null>(null);
  const toast = useApp((s) => s.toast);
  const reload = () => void loadCalendarState().then(setState, reportError);
  useEffect(reload, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      reload();
    }
  };

  const importFile = () =>
    run(async () => {
      const p = (await api.pickFiles({ multiple: false, extensions: ["ics"], title: "Kalenderdatei (.ics) importieren" }))?.[0];
      if (!p) return;
      setPreview({ courses: coursesFromIcs(new TextDecoder().decode(await api.readExternalFile(p))) });
    });

  const connected = !!state?.link;
  return (
    <section className="card calendar-connect" aria-label="Uni-Kalender">
      <div className="row">
        <CalendarSync size={16} />
        <h3 className="label grow">Uni-Kalender</h3>
      </div>
      {connected ? (
        <>
          <p className="small">
            Verbunden mit <strong>{state!.host}</strong>
            {state!.lastSync && <> · aktualisiert {formatRelative(state!.lastSync)}</>}. Die App lädt den Stundenplan beim Start neu (höchstens alle sechs Stunden): neue
            Veranstaltungen, verschobene und ausfallende Termine, Raumänderungen.
          </p>
          <div className="row wrap">
            <Button
              size="sm"
              icon={<RefreshCw size={14} />}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await syncCalendarIfDue(true);
                  toast(r && (r.created || r.updated) ? `Stundenplan aktualisiert: ${r.created} neu, ${r.updated} geändert.` : "Stundenplan ist aktuell.", "success");
                })
              }
            >
              Jetzt aktualisieren
            </Button>
            <Button size="sm" variant="ghost" icon={<Unlink size={14} />} disabled={busy} onClick={() => run(async () => void (await disconnect()))}>
              Trennen
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="small muted">
            Abo-Link aus dem Uni-Portal einfügen (beginnt mit <code>webcal://</code>). Studium OS legt daraus deine Veranstaltungen mit Wochentag, Uhrzeit und Raum an und hält sie
            aktuell. Der Link enthält einen persönlichen Schlüssel – er wird nur verschlüsselt auf diesem Gerät gespeichert.
          </p>
          {api.kind === "web" && (
            <form
              className="row wrap"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const r = await connectLink(link);
                  setLink("");
                  setPreview(r);
                });
              }}
            >
              <input className="grow" type="url" inputMode="url" autoComplete="off" value={link} onChange={(e) => setLink(e.target.value)} placeholder="webcal://…" aria-label="Abo-Link des Uni-Kalenders" />
              <Button type="submit" variant="primary" icon={<Link2 size={14} />} disabled={busy || !link.trim()}>
                Verbinden
              </Button>
            </form>
          )}
        </>
      )}
      <div className="row wrap">
        <Button size="sm" variant="ghost" icon={<FileUp size={14} />} disabled={busy} onClick={() => void importFile()}>
          Kalenderdatei (.ics) importieren
        </Button>
        {busy && <span className="xs muted">Lade …</span>}
      </div>
      {(error || state?.lastError) && <p className="small notice notice-warn">{error ?? state?.lastError}</p>}
      {preview && (
        <ImportPreview
          courses={preview.courses}
          link={preview.link}
          ignored={state?.ignored ?? []}
          initialArea={state?.areaId}
          onClose={() => {
            setPreview(null);
            reload();
          }}
        />
      )}
    </section>
  );
}

function ImportPreview({ courses, link, ignored, initialArea, onClose }: { courses: ImportCourse[]; link?: URL; ignored: string[]; initialArea?: string; onClose: () => void }) {
  const areas = useApp((s) => s.areas).filter((a) => !a.archived_at);
  const toast = useApp((s) => s.toast);
  const [areaId, setAreaId] = useState(initialArea ?? calendarArea() ?? areas[0]?.id ?? "");
  const [plan, setPlan] = useState<{ plan: ImportPlan; nodes: StudyNode[] } | null>(null);
  const [skip, setSkip] = useState<Set<string>>(() => new Set(ignored));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (areaId) void planFor(courses, areaId).then(setPlan, reportError);
  }, [courses, areaId]);
  const status = (c: ImportCourse) => {
    const u = plan?.plan.update.find((x) => x.course.key === c.key);
    return u ? (u.changed ? "wird aktualisiert" : "unverändert") : "neu";
  };
  return (
    <Dialog
      title="Stundenplan übernehmen"
      onClose={onClose}
      width={620}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button
            variant="primary"
            disabled={busy || !plan}
            onClick={async () => {
              if (!plan) return;
              setBusy(true);
              try {
                const r = await applyPlan(plan.plan, areaId, plan.nodes, skip);
                await rememberChoice([...skip], areaId, link);
                toast(`Stundenplan übernommen: ${r.created} neu, ${r.updated} aktualisiert.`, "success");
                onClose();
              } catch (e) {
                reportError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Übernehmen
          </Button>
        </>
      }
    >
      {!courses.length ? (
        <p className="small">In der Kalenderdatei wurden keine Lehrveranstaltungen gefunden.</p>
      ) : (
        <>
          <Field label="Studienbereich">
            <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <p className="xs muted">Abgewählte Einträge (z. B. Sprechstunden) bleiben auch beim automatischen Aktualisieren außen vor.</p>
          <div className="list" role="list" aria-label="Veranstaltungen aus dem Kalender">
            {courses.map((c) => (
              <label key={c.key} className="list-row" role="listitem">
                <input
                  type="checkbox"
                  checked={!skip.has(c.key)}
                  onChange={(e) => {
                    const next = new Set(skip);
                    if (e.target.checked) next.delete(c.key);
                    else next.add(c.key);
                    setSkip(next);
                  }}
                />
                <span className="grow" style={{ minWidth: 0 }}>
                  <strong className="block ellipsis">{c.title}</strong>
                  <span className="xs muted">
                    {c.weekdays.length ? `${weekdayText(c.weekdays)} ${fmtTime(c.start)}–${fmtTime(c.end)}` : "einzelne Termine"}
                    {c.room ? ` · ${c.room}` : ""} · {c.termine.filter((t) => !t.cancelled).length} Termine
                  </span>
                </span>
                <span className="chip xs">{status(c)}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </Dialog>
  );
}
