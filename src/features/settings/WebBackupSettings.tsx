import { CheckCircle2, HardDriveDownload, RotateCcw, Share, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { api, errorMessage } from "../../api";
import type { BackupSettings as BS, VerifyReport } from "../../api/types";
import { formatBytes, formatDateTime } from "../../lib/format";
import { reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { confirmDialog, Dialog } from "../../ui/Dialog";
import { flushAll } from "../editor/saveQueue";

interface StoredBackup {
  name: string;
  size: number;
  created_at: string;
  file: File | null;
}

/**
 * Backups in der Browser-/iPad-Version. Ein Backup entsteht zuerst im
 * App-Speicher und wird dann über „In Dateien sichern“ (Teilen-Menü) aus der
 * App herausgegeben – erst dann schützt es auch bei Verlust des Geräts.
 */
export function WebBackupSettings() {
  const wb = api.webBackups!;
  const [cfg, setCfg] = useState<BS | null>(null);
  const [list, setList] = useState<StoredBackup[]>([]);
  const [lastExport, setLastExport] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<{ path: string; label: string; report: VerifyReport; forRestore: boolean } | null>(null);
  const toast = useApp((s) => s.toast);

  const load = async () => {
    try {
      const [c, files, settings] = await Promise.all([api.backupSettings(), wb.list(), api.settingsAll()]);
      setCfg(c);
      setLastExport(typeof settings["backup.last_export"] === "string" ? (settings["backup.last_export"] as string) : null);
      // Dateien vorab holen: Das Teilen-Menü muss direkt im Tippen geöffnet werden.
      setList(await Promise.all(files.map(async (f) => ({ ...f, file: await wb.file(f.name).catch(() => null) }))));
      setPersisted(await wb.persisted());
    } catch (e) {
      reportError(e);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const set = async (key: string, value: unknown) => {
    try {
      await api.settingSet(key, value);
      await load();
    } catch (e) {
      reportError(e);
    }
  };

  const create = async () => {
    setBusy("create");
    try {
      await flushAll();
      const info = await api.backupCreate();
      toast(`Backup erstellt und geprüft (${formatBytes(info.size)}, ${info.file_count} Dateien). Sichere es jetzt mit „In Dateien sichern“.`, "success");
    } catch (e) {
      toast(`Backup fehlgeschlagen: ${errorMessage(e)}`, "error");
    } finally {
      setBusy(null);
      void load();
    }
  };

  const save = (b: StoredBackup) => {
    if (!b.file) return;
    // bewusst ohne vorheriges await (Safari verlangt den direkten Klick)
    void wb
      .save(b.file)
      .then(async () => {
        await api.settingSet("backup.last_export", new Date().toISOString());
        await load();
      })
      .catch((e) => toast(`Sichern fehlgeschlagen: ${errorMessage(e)}`, "error"));
  };

  const remove = async (b: StoredBackup) => {
    const ok = await confirmDialog({
      title: "Backup aus dem App-Speicher löschen?",
      message: `„${b.name}“ wird nur hier gelöscht. Bereits gesicherte Kopien (z. B. in der Dateien-App) bleiben erhalten.`,
      confirm: "Löschen",
      danger: true,
    });
    if (!ok) return;
    await wb.remove(b.name).catch(reportError);
    void load();
  };

  const verify = async (forRestore: boolean, stored?: StoredBackup) => {
    let path: string | null = stored?.name ?? null;
    if (!path) path = (await api.pickFiles({ multiple: false, title: "Backup auswählen" }))?.[0] ?? null;
    if (!path) return;
    setBusy("verify");
    try {
      const label = stored?.name ?? path.split("/").pop() ?? path;
      setReport({ path, label, report: await api.backupVerify(path), forRestore });
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  };

  const restore = async (path: string) => {
    const ok = await confirmDialog({
      title: "Backup wiederherstellen?",
      message: (
        <>
          <p>Alle aktuellen Daten in Studium OS werden durch den Stand dieses Backups ersetzt.</p>
          <p>
            Dein jetziger Stand wird vorher <strong>nicht gelöscht</strong>, sondern als eigenes Backup „…vor-Wiederherstellung…“ im App-Speicher aufbewahrt.
          </p>
        </>
      ),
      confirm: "Wiederherstellen",
      danger: true,
    });
    if (!ok) return;
    setBusy("restore");
    try {
      await flushAll();
      const res = await api.backupRestore(path);
      setReport(null);
      toast(`Wiederhergestellt. Vorheriger Stand: ${res.previous_state_dir}`, "success");
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      toast(`Wiederherstellung fehlgeschlagen: ${errorMessage(e)}`, "error");
    } finally {
      setBusy(null);
    }
  };

  if (!cfg) return <div className="loading">Lade …</div>;

  return (
    <div className="stack settings-section">
      <section className="card">
        <h3>Backup erstellen und sichern</h3>
        <p className="small muted">
          Ein Backup enthält die Datenbank und alle Dokumente in einer Datei – im selben Format wie die Desktop-App. Du kannst es am Mac oder Windows-PC wiederherstellen und
          umgekehrt.
        </p>
        <ol className="small steps">
          <li>„Jetzt Backup erstellen“ – es entsteht im App-Speicher und wird sofort geprüft.</li>
          <li>
            „In Dateien sichern“ – über das Teilen-Menü z. B. <strong>In Dateien sichern</strong> auf einen USB-Stick oder in einen Ordner deiner Wahl.
          </li>
        </ol>
        <div className="row wrap">
          <Button variant="primary" icon={<HardDriveDownload size={15} />} onClick={create} disabled={!!busy}>
            {busy === "create" ? "Erstelle Backup …" : "Jetzt Backup erstellen"}
          </Button>
        </div>
        <p className="xs muted">
          {lastExport ? `Zuletzt aus der App gesichert: ${formatDateTime(lastExport)}.` : "Noch kein Backup aus der App heraus gesichert."} Studium OS lädt nie selbst etwas in eine
          Cloud. Wählst du im Teilen-Menü iCloud Drive o. Ä., ist das deine bewusste Entscheidung.
        </p>
      </section>

      <section className="card">
        <h3>Backups im App-Speicher</h3>
        {list.length === 0 ? (
          <p className="small muted">Noch keine Backups.</p>
        ) : (
          <table className="table small">
            <thead>
              <tr>
                <th>Name</th>
                <th>Größe</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((b) => (
                <tr key={b.name}>
                  <td className="path">{b.name}</td>
                  <td className="tnum">{formatBytes(b.size)}</td>
                  <td>
                    <span className="row">
                      <Button size="sm" icon={<Share size={13} />} onClick={() => save(b)} disabled={!b.file}>
                        In Dateien sichern
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void verify(false, b)}>
                        Prüfen
                      </Button>
                      <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} aria-label="Löschen" onClick={() => void remove(b)} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="xs muted">Backups im App-Speicher schützen vor Bedienfehlern, aber nicht vor Verlust oder Defekt des Geräts. Dafür das Backup aus der App sichern.</p>
      </section>

      <section className="card">
        <h3>Automatische Backups</h3>
        <label className="row small">
          <input type="checkbox" checked={cfg.auto_enabled} onChange={(e) => void set("backup.auto_enabled", e.target.checked)} />
          Einmal täglich automatisch im App-Speicher sichern (während die App geöffnet ist)
        </label>
        <label className="row small">
          Aufbewahren:
          <select value={cfg.keep} onChange={(e) => void set("backup.keep", Number(e.target.value))} disabled={!cfg.auto_enabled}>
            {[3, 7, 14].map((n) => (
              <option key={n} value={n}>
                die letzten {n}
              </option>
            ))}
          </select>
          automatischen Backups
        </label>
        <p className="xs muted">{cfg.last_auto ? `Letztes automatisches Backup: ${formatDateTime(cfg.last_auto)}. ` : ""}Manuelle Backups werden nie automatisch gelöscht.</p>
      </section>

      <section className="card">
        <h3>Prüfen und wiederherstellen</h3>
        <div className="row wrap">
          <Button icon={<ShieldCheck size={15} />} onClick={() => void verify(false)} disabled={!!busy}>
            Backup-Datei prüfen …
          </Button>
          <Button icon={<RotateCcw size={15} />} onClick={() => void verify(true)} disabled={!!busy}>
            Aus Backup-Datei wiederherstellen …
          </Button>
        </div>
        <p className="xs muted">Funktioniert auch mit Backups der Desktop-App. Beschädigte oder unvollständige Backups werden nicht eingespielt.</p>
      </section>

      <section className="card">
        <h3>Speicher</h3>
        <p className="small">
          {persisted
            ? "Der Browser hat zugesagt, die Daten dieser App dauerhaft aufzubewahren."
            : "Der Browser hat noch nicht zugesagt, die Daten dauerhaft aufzubewahren. Füge Studium OS zum Home-Bildschirm hinzu und öffne es von dort."}
        </p>
        {!persisted && (
          <Button size="sm" onClick={() => void wb.requestPersist().then(setPersisted)}>
            Dauerhafte Speicherung anfragen
          </Button>
        )}
      </section>

      {report && (
        <Dialog
          title={report.report.ok ? "Backup ist in Ordnung" : "Backup ist beschädigt"}
          onClose={() => setReport(null)}
          footer={
            <>
              <Button onClick={() => setReport(null)}>Schließen</Button>
              {report.forRestore && report.report.ok && (
                <Button variant="danger" onClick={() => void restore(report.path)} disabled={busy === "restore"}>
                  {busy === "restore" ? "Stelle wieder her …" : "Wiederherstellen"}
                </Button>
              )}
            </>
          }
        >
          <div className="stack small">
            <div className="row">
              {report.report.ok ? <CheckCircle2 className="ok-icon" size={20} /> : <XCircle className="err-icon" size={20} />}
              <span className="path">{report.label}</span>
            </div>
            {report.report.created_at && <div>Erstellt: {formatDateTime(report.report.created_at)}</div>}
            <div>
              {report.report.file_count} Dokumente · {formatBytes(report.report.total_size)}
              {report.report.app_version ? ` · App-Version ${report.report.app_version}` : ""}
            </div>
            {report.report.problems.length > 0 && (
              <ul className="problems">
                {report.report.problems.slice(0, 12).map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
            {!report.report.ok && <p>Dieses Backup wird nicht wiederhergestellt. Verwende ein anderes Backup.</p>}
          </div>
        </Dialog>
      )}
    </div>
  );
}
