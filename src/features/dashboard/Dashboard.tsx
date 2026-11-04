import { ArrowDown, ArrowUp, Eye, EyeOff, FilePlus2, FileUp, HardDriveDownload, Search, ShieldAlert, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../api";
import type { BackupRecord } from "../../api/types";
import { DASHBOARD_SETTING, dashboardConfig, moveWidget, WIDGETS, type DashboardConfig, type WidgetId } from "../../lib/dashboard";
import { formatDateTime, formatRelative } from "../../lib/format";
import { useApp } from "../../state/store";
import { Button, IconButton } from "../../ui/Button";
import { MOD } from "../../ui/misc";
import { useImport } from "../documents/ImportDialog";
import { NoteTypeIcon } from "../navigation/icons";
import { NewNodeDialog, type NewNodeRequest } from "../navigation/NewNodeDialog";
import { useDashboardData } from "./data";
import { CoursesWidget, ExamWidget, LearnWidget, NowWidget, OpenEndsWidget, QuickNoteWidget, RecentWidget } from "./widgets";

export function Dashboard() {
  const areas = useApp((s) => s.areas);
  const areaId = useApp((s) => s.areaId);
  const open = useApp((s) => s.open);
  const setPalette = useApp((s) => s.setPalette);
  const dataVersion = useApp((s) => s.dataVersion);
  const startImport = useImport();
  const data = useDashboardData();
  const [backups, setBackups] = useState<BackupRecord[] | null>(null);
  const [lastExport, setLastExport] = useState<string | null>(null);
  const [config, setConfig] = useState<DashboardConfig>(() => dashboardConfig(null));
  const [editing, setEditing] = useState(false);
  const scope = areaId === "all" ? null : areaId;

  useEffect(() => {
    void api.backupHistory().then(setBackups).catch(() => setBackups([]));
    void api
      .settingsAll()
      .then((s) => {
        setConfig(dashboardConfig(s[DASHBOARD_SETTING]));
        if (api.kind === "web") setLastExport(typeof s["backup.last_export"] === "string" ? (s["backup.last_export"] as string) : null);
      })
      .catch(() => {});
  }, [scope, dataVersion]);

  const saveConfig = (c: DashboardConfig) => {
    setConfig(c);
    void api.settingSet(DASHBOARD_SETTING, c).catch(() => {});
  };

  const visibleAreas = areas.filter((a) => !a.archived_at);
  const lastOk = backups?.find((b) => b.status === "ok" || b.status === "warnung");
  const backupAge = lastOk ? (Date.now() - Date.parse(lastOk.created_at)) / 86400000 : Infinity;
  const lastFailed = backups?.[0]?.status === "fehler" ? backups[0] : null;

  const [newReq, setNewReq] = useState<NewNodeRequest | null>(null);
  const newItem = (extra: Partial<NewNodeRequest> = {}) => setNewReq({ parentId: null, areaId: scope ?? visibleAreas[0]?.id ?? null, ...extra });

  const render = (id: WidgetId) => {
    switch (id) {
      case "jetzt":
        return <NowWidget data={data} />;
      case "lernen":
        return <LearnWidget />;
      case "pruefung":
        return <ExamWidget data={data} />;
      case "offen":
        return <OpenEndsWidget data={data} />;
      case "veranstaltungen":
        return <CoursesWidget data={data} />;
      case "notiz":
        return <QuickNoteWidget data={data} />;
      case "zuletzt":
        return <RecentWidget data={data} />;
    }
  };
  const shown = config.order.filter((id) => !config.hidden.includes(id));

  return (
    <div className="page dashboard">
      {api.kind === "web" && <InstallHint />}
      <header className="page-head">
        <div className="small muted">{scope ? visibleAreas.find((a) => a.id === scope)?.name : "Alle Studienbereiche"}</div>
        <div className="row">
          <h1 className="page-title-static grow">Übersicht</h1>
          <Button size="sm" variant={editing ? "primary" : "ghost"} icon={<SlidersHorizontal size={14} />} onClick={() => setEditing(!editing)}>
            {editing ? "Fertig" : "Anpassen"}
          </Button>
        </div>
        <div className="row wrap">
          <Button variant="primary" icon={<FilePlus2 size={15} />} onClick={() => newItem()}>
            Neu …
          </Button>
          <Button icon={<NoteTypeIcon type="vorlesung" size={15} plain />} onClick={() => newItem({ noteType: "vorlesung" })}>
            Vorlesung
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

      {editing && (
        <div className="notice small">
          Reihenfolge mit den Pfeilen ändern, Kacheln aus- oder einblenden.
          {config.hidden.length > 0 && (
            <div className="row wrap" style={{ marginTop: 6 }}>
              Ausgeblendet:
              {config.hidden.map((id) => (
                <Button key={id} size="sm" icon={<Eye size={13} />} onClick={() => saveConfig({ ...config, hidden: config.hidden.filter((x) => x !== id) })}>
                  {WIDGETS.find((w) => w.id === id)?.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="dash2">
        {shown.map((id, i) => (
          <div key={id} className={`dash-slot dash-${id} ${editing ? "is-editing" : ""}`}>
            {editing && (
              <div className="dash-edit row">
                <strong className="grow small">{WIDGETS.find((w) => w.id === id)?.label}</strong>
                <IconButton label="Nach vorn" disabled={i === 0} onClick={() => saveConfig(moveWidget(config, id, -1))}>
                  <ArrowUp size={15} />
                </IconButton>
                <IconButton label="Nach hinten" disabled={i === shown.length - 1} onClick={() => saveConfig(moveWidget(config, id, 1))}>
                  <ArrowDown size={15} />
                </IconButton>
                <IconButton label="Ausblenden" onClick={() => saveConfig({ ...config, hidden: [...config.hidden, id] })}>
                  <EyeOff size={15} />
                </IconButton>
              </div>
            )}
            {render(id)}
          </div>
        ))}
      </div>

      <p className="xs muted dash-backup row">
        <HardDriveDownload size={13} />
        <span className="grow">
          {lastOk ? <>Letztes Backup {formatRelative(lastOk.created_at)}</> : "Noch kein Backup"}
          {api.kind === "web" && lastExport ? <> · aus der App gesichert {formatRelative(lastExport)}</> : null}
        </span>
        <button className="link-btn xs" onClick={() => open({ type: "settings", tab: "backup" })}>
          Backup verwalten
        </button>
      </p>
      {newReq && <NewNodeDialog req={newReq} onClose={() => setNewReq(null)} />}
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
