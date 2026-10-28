import { useEffect, useState } from "react";

import { api } from "../../api";
import type { AppInfo, Area } from "../../api/types";
import { AREA_COLORS } from "../../lib/kinds";
import { TOP_INSET_AUTO, TOP_INSET_MAX } from "../../lib/safeArea";
import { reportError, useApp, type View } from "../../state/store";
import { Button } from "../../ui/Button";
import { BackupSettings } from "./BackupSettings";
import { WebBackupSettings } from "./WebBackupSettings";
import pkg from "../../../package.json";

const APP_VERSION: string = pkg.version;

type Tab = NonNullable<Extract<View, { type: "settings" }>["tab"]>;
const TABS: { id: Tab; label: string }[] = [
  { id: "allgemein", label: "Darstellung" },
  { id: "bereiche", label: "Studienbereiche" },
  { id: "backup", label: "Backup" },
  { id: "daten", label: "Daten & Sicherheit" },
];

export function SettingsView({ tab = "allgemein" }: { tab?: Tab }) {
  const open = useApp((s) => s.open);
  return (
    <div className="page">
      <header className="page-head">
        <h1 className="page-title-static">
          Einstellungen <span className="small muted">· Version {APP_VERSION}</span>
        </h1>
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? "is-active" : ""}`} onClick={() => open({ type: "settings", tab: t.id })}>
              {t.label}
            </button>
          ))}
        </div>
      </header>
      {tab === "allgemein" && <Appearance />}
      {tab === "bereiche" && <Areas />}
      {tab === "backup" && (api.kind === "web" ? <WebBackupSettings /> : <BackupSettings />)}
      {tab === "daten" && <DataInfo />}
    </div>
  );
}

function Appearance() {
  const theme = useApp((s) => s.theme);
  const fontScale = useApp((s) => s.fontScale);
  const topInset = useApp((s) => s.topInset);
  const editorFont = useApp((s) => s.editorFont);
  const setPref = useApp((s) => s.setPref);
  return (
    <div className="stack settings-section">
      <section className="card">
        <h3>Erscheinungsbild</h3>
        <div className="seg" role="radiogroup" aria-label="Farbschema">
          {(
            [
              ["system", "Wie System"],
              ["light", "Hell"],
              ["dark", "Dunkel"],
            ] as const
          ).map(([v, l]) => (
            <button key={v} role="radio" aria-checked={theme === v} className={theme === v ? "is-active" : ""} onClick={() => setPref("theme", v)}>
              {l}
            </button>
          ))}
        </div>
      </section>
      <section className="card">
        <h3>Abstand oben (iPad)</h3>
        <p className="small muted">
          Liegt die Statusleiste mit Uhrzeit und WLAN über Knöpfen der App, hier den Abstand vergrößern. „Automatisch“ übernimmt den Wert von iPadOS (als App vom Home-Bildschirm mindestens 24 px).
        </p>
        <label className="row small">
          Abstand
          <input
            type="range"
            min={0}
            max={TOP_INSET_MAX}
            step={2}
            value={topInset < 0 ? 24 : topInset}
            onChange={(e) => setPref("topInset", Number(e.target.value))}
            aria-label="Abstand oben in Pixeln"
          />
          <span className="tnum">{topInset < 0 ? "Automatisch" : `${topInset} px`}</span>
          <Button size="sm" variant="ghost" onClick={() => setPref("topInset", TOP_INSET_AUTO)} disabled={topInset < 0}>
            Automatisch
          </Button>
        </label>
      </section>
      <section className="card">
        <h3>Schrift</h3>
        <label className="row small">
          Schriftgröße
          <input type="range" min={0.85} max={1.3} step={0.05} value={fontScale} onChange={(e) => setPref("fontScale", Number(e.target.value))} />
          <span className="tnum">{Math.round(fontScale * 100)} %</span>
          <Button size="sm" variant="ghost" onClick={() => setPref("fontScale", 1)}>
            Zurücksetzen
          </Button>
        </label>
        <div className="seg" role="radiogroup" aria-label="Schrift im Editor">
          <button role="radio" aria-checked={editorFont === "serif"} className={editorFont === "serif" ? "is-active" : ""} onClick={() => setPref("editorFont", "serif")}>
            Serifenschrift (Lesetext)
          </button>
          <button role="radio" aria-checked={editorFont === "sans"} className={editorFont === "sans" ? "is-active" : ""} onClick={() => setPref("editorFont", "sans")}>
            Serifenlos
          </button>
        </div>
      </section>
      <section className="card">
        <h3>Tastaturkürzel</h3>
        <Shortcuts />
      </section>
    </div>
  );
}

export function Shortcuts() {
  const mod = /Mac/.test(navigator.platform) ? "⌘" : "Strg";
  const rows: [string, string][] = [
    [`${mod} K`, "Suche öffnen (außerhalb des Editors)"],
    [`${mod} N`, "Neue Notiz"],
    [`${mod} 1 / 2 / 3`, "Studienbereich wechseln"],
    [`${mod} 0`, "Alle Bereiche"],
    [`${mod} .`, "Kontextbereich ein/aus"],
    [`${mod} \\`, "Seitenleiste ein/aus (Fokusmodus)"],
    [`${mod} [  /  ${mod} ]`, "Zurück / Vorwärts"],
    [`${mod} S`, "Sofort speichern (sonst automatisch)"],
    [`${mod} B / I / U`, "Fett / Kursiv / Unterstrichen"],
    [`${mod} ⇧ H`, "Hervorheben"],
    [`${mod} ⇧ L`, "Interne Verknüpfung einfügen"],
    [`${mod} K (im Text)`, "Weblink einfügen"],
    [`${mod} Z / ${mod} ⇧ Z`, "Rückgängig / Wiederholen"],
    [`${mod} ⌥ 1–4`, "Überschrift 1–4"],
    [`${mod} ⇧ 7 / 8 / 9`, "Nummerierte Liste / Aufzählung / Checkliste"],
  ];
  return (
    <table className="table small shortcuts">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td>
              <kbd className="kbd">{k}</kbd>
            </td>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Areas() {
  const areas = useApp((s) => s.areas);
  const reloadAreas = useApp((s) => s.reloadAreas);
  const [edit, setEdit] = useState<Record<string, { name: string; color: string }>>({});
  const [newName, setNewName] = useState("");
  useEffect(() => setEdit(Object.fromEntries(areas.map((a) => [a.id, { name: a.name, color: a.color }]))), [areas]);
  const save = async (a: Area) => {
    const e = edit[a.id];
    if (!e || (e.name === a.name && e.color === a.color)) return;
    try {
      await api.areaUpdate(a.id, e.name, e.color);
      await reloadAreas();
    } catch (err) {
      reportError(err);
    }
  };
  const move = async (i: number, d: -1 | 1) => {
    const ids = areas.map((a) => a.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    await api.areaReorder(ids).catch(reportError);
    await reloadAreas();
  };
  return (
    <div className="stack settings-section">
      <section className="card">
        <h3>Studienbereiche</h3>
        <p className="small muted">Jeder Bereich hat eine eigene Struktur. Über „Auch in … zeigen“ erscheinen einzelne Inhalte zusätzlich in anderen Bereichen.</p>
        <div className="stack">
          {areas.map((a, i) => (
            <div key={a.id} className="row">
              <input type="color" aria-label="Farbe" value={edit[a.id]?.color ?? a.color} onChange={(e) => setEdit({ ...edit, [a.id]: { ...edit[a.id]!, color: e.target.value } })} onBlur={() => void save(a)} />
              <input className="grow" value={edit[a.id]?.name ?? a.name} onChange={(e) => setEdit({ ...edit, [a.id]: { ...edit[a.id]!, name: e.target.value } })} onBlur={() => void save(a)} />
              <Button size="sm" variant="ghost" onClick={() => void move(i, -1)} disabled={i === 0} aria-label="Nach oben">
                ↑
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void move(i, 1)} disabled={i === areas.length - 1} aria-label="Nach unten">
                ↓
              </Button>
            </div>
          ))}
        </div>
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            await api.areaCreate(newName.trim(), AREA_COLORS[areas.length % AREA_COLORS.length]!).catch(reportError);
            setNewName("");
            await reloadAreas();
          }}
        >
          <input className="grow" placeholder="Neuer Studienbereich, z. B. Master Wirtschaftsrecht" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Button type="submit" variant="primary" disabled={!newName.trim()}>
            Hinzufügen
          </Button>
        </form>
      </section>
    </div>
  );
}

function DataInfo() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    api.appInfo().then(setInfo).catch(reportError);
  }, []);
  if (!info) return <div className="loading">Lade …</div>;
  if (info.platform === "web") return <WebDataInfo info={info} />;
  return (
    <div className="stack settings-section">
      <section className="card">
        <h3>Wo liegen meine Daten?</h3>
        <div className="kv">
          <span className="muted small">Datenordner</span>
          <span className="small path">{info.data_dir}</span>
          <Button size="sm" variant="ghost" onClick={() => void api.revealPath().catch(reportError)}>
            Anzeigen
          </Button>
          <span className="muted small">Datenbank</span>
          <span className="small path">{info.db_path}</span>
          <span />
          <span className="muted small">Dokumente</span>
          <span className="small path">{info.files_dir}</span>
          <span />
          {info.log_dir && (
            <>
              <span className="muted small">Fehlerprotokoll</span>
              <span className="small path">{info.log_dir}</span>
              <span />
            </>
          )}
        </div>
        <p className="xs muted">
          Version {info.version} · Datenbankschema {info.schema_version} · {info.platform}
        </p>
      </section>
      <section className="card prose-ui">
        <h3>Datenschutz und Sicherheit</h3>
        <ul className="small">
          <li>
            <strong>Lokal:</strong> Alle Inhalte liegen nur in diesem Datenordner. Es gibt keine Anmeldung, keinen Server und keine Synchronisierung.
          </li>
          <li>
            <strong>Kein Netzwerk:</strong> Studium OS sendet keine Daten, enthält keine Telemetrie und lädt nichts nach. Weblinks aus Notizen öffnen sich nur auf deinen Klick im Browser.
          </li>
          <li>
            <strong>Verschlüsselung:</strong> Die App verschlüsselt die Daten in dieser Version <em>nicht</em> selbst. Schalte zum Schutz bei Verlust oder Diebstahl des Geräts die
            Festplattenverschlüsselung ein: FileVault (macOS) bzw. BitLocker/Geräteverschlüsselung (Windows).
          </li>
          <li>
            <strong>Backups:</strong> sind ebenfalls unverschlüsselt. Bewahre externe Datenträger mit Backups sicher auf.
          </li>
          <li>
            <strong>Importierte Dateien</strong> werden nie ausgeführt. Deine Originale bleiben unverändert; Studium OS arbeitet mit Kopien.
          </li>
          <li>
            <strong>Inhalte sind nicht geprüft:</strong> Importierte Unterlagen und Vorlagen sind keine geprüften Rechtsinformationen. Gesetzesstände bitte immer selbst prüfen.
          </li>
        </ul>
      </section>
    </div>
  );
}

function WebDataInfo({ info }: { info: AppInfo }) {
  return (
    <div className="stack settings-section">
      <section className="card">
        <h3>Wo liegen meine Daten?</h3>
        <p className="small">
          Im privaten Speicher dieser Web-App auf diesem Gerät. Andere Websites und Apps können nicht darauf zugreifen. Es wird nichts an einen Server geschickt.
        </p>
        <p className="xs muted">
          Version {info.version} · Datenbankschema {info.schema_version} · Browser-Version
        </p>
      </section>
      <section className="card prose-ui">
        <h3>Datenschutz und Sicherheit</h3>
        <ul className="small">
          <li>
            <strong>Lokal:</strong> Keine Anmeldung, kein Konto, keine Synchronisierung. Die Website liefert nur das Programm aus; deine Inhalte verlassen das Gerät nie.
          </li>
          <li>
            <strong>Offline:</strong> Nach dem ersten Öffnen funktioniert Studium OS ohne Internet. Weblinks aus Notizen öffnen sich nur auf deinen Klick.
          </li>
          <li>
            <strong>Verschlüsselung:</strong> Die App verschlüsselt nicht selbst. Auf dem iPad sind die Daten durch die Geräteverschlüsselung geschützt, sobald ein Code gesetzt ist.
          </li>
          <li>
            <strong>Wichtig:</strong> Wenn du die Website-Daten in Safari löschst (Einstellungen → Safari → Erweitert → Website-Daten) oder die App vom Home-Bildschirm entfernst,
            werden auch deine Studiendaten gelöscht. Sichere deshalb regelmäßig ein Backup in der Dateien-App.
          </li>
          <li>
            <strong>Importierte Dateien</strong> werden nie ausgeführt. Deine Originale bleiben unverändert; Studium OS arbeitet mit Kopien.
          </li>
        </ul>
      </section>
    </div>
  );
}
