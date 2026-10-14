import { FilePlus2, FileUp, HardDriveDownload, Search, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../api";
import type { BackupRecord, DocumentInfo, RecentNote, StudyNode } from "../../api/types";
import { formatDateTime, formatRelative } from "../../lib/format";
import { buildTree } from "../../lib/tree";
import { useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { AreaDot, MOD } from "../../ui/misc";
import { DocIcon } from "../documents/DocumentList";
import { useImport } from "../documents/ImportDialog";
import { createNode, openNode } from "../navigation/actions";
import { KindIcon } from "../navigation/icons";
import { LearningOverview } from "./LearningOverview";

export function Dashboard() {
  const areas = useApp((s) => s.areas);
  const areaId = useApp((s) => s.areaId);
  const selectArea = useApp((s) => s.selectArea);
  const open = useApp((s) => s.open);
  const setPalette = useApp((s) => s.setPalette);
  const dataVersion = useApp((s) => s.dataVersion);
  const startImport = useImport();
  const [allNodes, setAllNodes] = useState<StudyNode[]>([]);
  const [recentNotes, setRecentNotes] = useState<RecentNote[]>([]);
  const [recentDocs, setRecentDocs] = useState<DocumentInfo[]>([]);
  const [backups, setBackups] = useState<BackupRecord[] | null>(null);
  const [lastExport, setLastExport] = useState<string | null>(null);
  const scope = areaId === "all" ? null : areaId;

  useEffect(() => {
    void api.nodesList(null).then(setAllNodes).catch(() => {});
    void api.notesRecent(scope, 8).then(setRecentNotes).catch(() => {});
    void api.documentsRecent(scope, 6).then(setRecentDocs).catch(() => {});
    void api.backupHistory().then(setBackups).catch(() => setBackups([]));
    if (api.kind === "web")
      void api
        .settingsAll()
        .then((s) => setLastExport(typeof s["backup.last_export"] === "string" ? (s["backup.last_export"] as string) : null))
        .catch(() => {});
  }, [scope, dataVersion]);

  const visibleAreas = areas.filter((a) => !a.archived_at);
  const stats = useMemo(() => {
    const m = new Map<string, { notes: number; courses: number }>();
    for (const n of allNodes) {
      const s = m.get(n.area_id) ?? { notes: 0, courses: 0 };
      if (n.kind === "note") s.notes++;
      if (n.kind === "course") s.courses++;
      m.set(n.area_id, s);
    }
    return m;
  }, [allNodes]);

  // Aktuelles Semester: das zuletzt angelegte, nicht archivierte Semester je Bereich
  const semesters = useMemo(() => {
    const out: { semester: StudyNode; courses: StudyNode[] }[] = [];
    for (const a of visibleAreas) {
      if (scope && a.id !== scope) continue;
      const sems = allNodes.filter((n) => n.area_id === a.id && n.kind === "semester" && !n.archived_at && !n.parent_id);
      const cur = sems.sort((x, y) => y.created_at.localeCompare(x.created_at))[0];
      if (!cur) continue;
      const tree = buildTree(allNodes.filter((n) => n.area_id === a.id));
      const find = (items: ReturnType<typeof buildTree>): ReturnType<typeof buildTree>[number] | undefined => {
        for (const it of items) {
          if (it.node.id === cur.id) return it;
          const f = find(it.children);
          if (f) return f;
        }
      };
      const sub = find(tree);
      const courses: StudyNode[] = [];
      const walk = (items: ReturnType<typeof buildTree>) => {
        for (const it of items) {
          if (it.node.kind === "course" || it.node.kind === "module") courses.push(it.node);
          else walk(it.children);
        }
      };
      walk(sub?.children ?? []);
      out.push({ semester: cur, courses: courses.slice(0, 10) });
    }
    return out;
  }, [allNodes, visibleAreas, scope]);

  const lastOk = backups?.find((b) => b.status === "ok" || b.status === "warnung");
  const backupAge = lastOk ? (Date.now() - Date.parse(lastOk.created_at)) / 86400000 : Infinity;
  const lastFailed = backups?.[0]?.status === "fehler" ? backups[0] : null;

  const newNote = () => {
    const target = scope ?? visibleAreas[0]?.id;
    if (target) void createNode({ areaId: target, parentId: null, kind: "note", title: "Neue Notiz" });
  };

  return (
    <div className="page dashboard">
      {api.kind === "web" && <InstallHint />}
      <header className="page-head">
        <div className="small muted">{scope ? visibleAreas.find((a) => a.id === scope)?.name : "Alle Studienbereiche"}</div>
        <h1 className="page-title-static">Übersicht</h1>
        <div className="row wrap">
          <Button variant="primary" icon={<FilePlus2 size={15} />} onClick={newNote}>
            Neue Notiz
          </Button>
          <Button icon={<FileUp size={15} />} onClick={() => void startImport({})}>
            Dokumente importieren
          </Button>
          <Button icon={<Search size={15} />} onClick={() => setPalette(true)}>
            Suchen <kbd className="kbd">{MOD} K</kbd>
          </Button>
        </div>
      </header>

      {backups && (backupAge > 7 || lastFailed) && (
        <div className="notice notice-warn row">
          <ShieldAlert size={16} />
          <span className="grow small">
            {lastFailed
              ? `Das letzte Backup ist fehlgeschlagen (${formatDateTime(lastFailed.created_at)}): ${lastFailed.message ?? ""}`
              : lastOk
                ? `Dein letztes Backup ist ${Math.floor(backupAge)} Tage alt.`
                : "Es gibt noch kein Backup deiner Daten."}
          </span>
          <Button size="sm" icon={<HardDriveDownload size={14} />} onClick={() => open({ type: "settings", tab: "backup" })}>
            Zum Backup
          </Button>
        </div>
      )}

      <div className="area-cards">
        {visibleAreas.map((a) => {
          const s = stats.get(a.id) ?? { notes: 0, courses: 0 };
          return (
            <button key={a.id} className={`area-card ${scope === a.id ? "is-active" : ""}`} style={{ "--area": a.color } as React.CSSProperties} onClick={() => void selectArea(a.id)}>
              <span className="row">
                <AreaDot color={a.color} />
                <strong className="ellipsis">{a.name}</strong>
              </span>
              <span className="small muted tnum">
                {s.courses} Veranstaltungen · {s.notes} Notizen
              </span>
            </button>
          );
        })}
      </div>

      <div className="dash-grid">
        <LearningOverview allNodes={allNodes} />
        <section className="card">
          <h3 className="label">Zuletzt bearbeitet</h3>
          {recentNotes.length === 0 ? (
            <p className="muted small">Noch keine Notizen. Lege links in der Seitenleiste eine Struktur an oder beginne mit einer neuen Notiz.</p>
          ) : (
            <div className="list">
              {recentNotes.map((n) => (
                <button key={n.node_id} className="list-row" onClick={() => open({ type: "note", id: n.node_id }, { title: n.title })}>
                  <KindIcon kind="note" />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="ellipsis block">{n.title}</span>
                    {n.path && <span className="xs muted ellipsis block">{n.path}</span>}
                  </span>
                  {areaId === "all" && <AreaDot color={areas.find((a) => a.id === n.area_id)?.color ?? "#999"} size={6} />}
                  <span className="xs muted">{formatRelative(n.updated_at)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h3 className="label">Aktuelles Semester</h3>
          {semesters.length === 0 ? (
            <p className="muted small">Noch kein Semester angelegt. Über „+ Semester anlegen“ in der Seitenleiste beginnst du, z. B. mit „Wintersemester 2026/27“.</p>
          ) : (
            semesters.map(({ semester, courses }) => (
              <div key={semester.id} className="sem-block">
                <button className="sem-title" onClick={() => openNode(semester)}>
                  <AreaDot color={areas.find((a) => a.id === semester.area_id)?.color ?? "#999"} size={6} />
                  {semester.title}
                </button>
                {courses.length ? (
                  <div className="list">
                    {courses.map((c) => (
                      <button key={c.id} className="list-row" onClick={() => openNode(c)}>
                        <KindIcon kind={c.kind} />
                        <span className="grow ellipsis">{c.title}</span>
                        {(c.meta.weekday || c.meta.time) && (
                          <span className="xs muted tnum">
                            {[c.meta.weekday, c.meta.time].filter(Boolean).join(", ")}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="muted xs">Noch keine Veranstaltungen.</p>
                )}
              </div>
            ))
          )}
        </section>

        <section className="card">
          <h3 className="label">Kürzlich importiert</h3>
          {recentDocs.length === 0 ? (
            <p className="muted small">Noch keine Unterlagen. Ziehe PDFs einfach ins Fenster.</p>
          ) : (
            <div className="list">
              {recentDocs.map((d) => (
                <button key={d.id} className="list-row" onClick={() => open({ type: "document", id: d.id }, { title: d.title })}>
                  <DocIcon ext={d.ext} />
                  <span className="grow ellipsis">{d.title}</span>
                  <span className="xs muted">{formatRelative(d.created_at)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h3 className="label">Datensicherung</h3>
          <p className="small">
            {lastOk ? (
              <>
                Letztes Backup: <strong>{formatDateTime(lastOk.created_at)}</strong>
                {lastOk.kind === "auto" ? " (automatisch)" : ""}
              </>
            ) : (
              "Noch kein Backup."
            )}
          </p>
          {api.kind === "web" && (
            <p className="small">{lastExport ? <>Zuletzt aus der App gesichert: <strong>{formatDateTime(lastExport)}</strong></> : "Noch kein Backup aus der App gesichert."}</p>
          )}
          <p className="xs muted">
            {api.kind === "web"
              ? "Alle Daten liegen nur auf diesem Gerät. Sichere Backups regelmäßig mit „In Dateien sichern“ – das schützt vor Verlust."
              : "Alle Daten liegen nur auf diesem Rechner. Ein Backup auf einem externen Datenträger schützt vor Verlust."}
          </p>
          <Button size="sm" icon={<HardDriveDownload size={14} />} onClick={() => open({ type: "settings", tab: "backup" })}>
            Backup verwalten
          </Button>
        </section>
      </div>
    </div>
  );
}

/** Hinweis in der Browser-Version, solange die App nicht vom Home-Bildschirm gestartet wurde. */
function InstallHint() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem("studium.installHint") === "aus";
    } catch {
      return false;
    }
  });
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia?.("(display-mode: standalone)").matches;
  if (standalone || hidden) return null;
  return (
    <div className="card install-hint small">
      <strong>Als App installieren:</strong> In Safari auf <em>Teilen</em> tippen und <em>Zum Home-Bildschirm</em> wählen. Dann startet Studium OS wie eine App, funktioniert
      offline und Safari bewahrt deine Daten dauerhaft auf.
      <button
        className="link-button xs"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem("studium.installHint", "aus");
          } catch {
            /* egal */
          }
        }}
      >
        Ausblenden
      </button>
    </div>
  );
}
