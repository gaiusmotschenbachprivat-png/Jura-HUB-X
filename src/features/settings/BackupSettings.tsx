import { CheckCircle2, FolderOpen, HardDriveDownload, RotateCcw, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { api, errorMessage } from "../../api";
import type { BackupRecord, BackupSettings as BS, VerifyReport } from "../../api/types";
import { formatBytes, formatDateTime } from "../../lib/format";
import { reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { confirmDialog, Dialog } from "../../ui/Dialog";
import { flushAll } from "../editor/saveQueue";

export function BackupSettings() {
  const [cfg, setCfg] = useState<BS | null>(null);
  const [history, setHistory] = useState<BackupRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<{ path: string; report: VerifyReport; forRestore: boolean } | null>(null);
  const toast = useApp((s) => s.toast);

  const load = async () => {
    try {
      setCfg(await api.backupSettings());
      setHistory(await api.backupHistory());
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
      toast(
        info.second_copy_error
          ? `Backup erstellt. Die zweite Kopie ist fehlgeschlagen: ${info.second_copy_error}`
          : `Backup erstellt und geprüft (${formatBytes(info.size)}, ${info.file_count} Dateien).`,
        info.second_copy_error ? "error" : "success",
      );
    } catch (e) {
      toast(`Backup fehlgeschlagen: ${errorMessage(e)}`, "error");
    } finally {
      setBusy(null);
      void load();
    }
  };

  const pickBackupFile = async () => {
    const res = await api.pickFiles({ multiple: false, extensions: ["studiumbackup"], title: "Backup auswählen" });
    return res?.[0] ?? null;
  };

  const verify = async (forRestore: boolean, path?: string) => {
    const p = path ?? (await pickBackupFile());
    if (!p) return;
    setBusy("verify");
    try {
      setReport({ path: p, report: await api.backupVerify(p), forRestore });
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
            Dein jetziger Stand wird vorher <strong>nicht gelöscht</strong>, sondern im Datenordner unter <code>pre-restore-…</code> aufbewahrt.
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
        <h3>Backup erstellen</h3>
        <p className="small muted">
          Ein Backup enthält die Datenbank (Struktur, Notizen, Versionen, Verknüpfungen) und alle importierten Dokumente in einer einzigen Datei. Es wird nach dem Schreiben
          automatisch geprüft.
        </p>
        <div className="row wrap">
          <Button variant="primary" icon={<HardDriveDownload size={15} />} onClick={create} disabled={!!busy}>
            {busy === "create" ? "Erstelle Backup …" : "Jetzt Backup erstellen"}
          </Button>
        </div>
        <div className="kv">
          <span className="muted small">Speicherort</span>
          <span className="small path">{cfg.dir}</span>
          <span className="row">
            <Button
              size="sm"
              icon={<FolderOpen size={13} />}
              onClick={async () => {
                const d = await api.pickDirectory("Ordner für Backups wählen (z. B. USB-Stick)");
                if (d) await set("backup.dir", d);
              }}
            >
              Ändern
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void api.revealPath(cfg.dir).catch(reportError)}>
              Anzeigen
            </Button>
          </span>
          <span className="muted small">Zweite Kopie</span>
          <span className="small path">{cfg.second_dir ?? "– aus –"}</span>
          <span className="row">
            <Button
              size="sm"
              icon={<FolderOpen size={13} />}
              onClick={async () => {
                const d = await api.pickDirectory("Ordner für eine zweite Sicherungskopie wählen");
                if (d) await set("backup.second_dir", d);
              }}
            >
              Wählen
            </Button>
            {cfg.second_dir && (
              <Button size="sm" variant="ghost" onClick={() => void set("backup.second_dir", "")}>
                Entfernen
              </Button>
            )}
          </span>
        </div>
        <p className="xs muted">
          Tipp: Wähle als Speicherort einen externen Datenträger. Studium OS nutzt nie selbstständig einen Cloud-Dienst. Wenn du einen Ordner wählst, der von einem
          Cloud-Programm synchronisiert wird, landen die Backups dort – das ist dann deine bewusste Entscheidung.
        </p>
      </section>

      <section className="card">
        <h3>Automatische Backups</h3>
        <label className="row small">
          <input type="checkbox" checked={cfg.auto_enabled} onChange={(e) => void set("backup.auto_enabled", e.target.checked)} />
          Einmal täglich automatisch sichern (während die App geöffnet ist)
        </label>
        <label className="row small">
          Aufbewahren:
          <select value={cfg.keep} onChange={(e) => void set("backup.keep", Number(e.target.value))} disabled={!cfg.auto_enabled}>
            {[3, 7, 14, 30, 60].map((n) => (
              <option key={n} value={n}>
                die letzten {n}
              </option>
            ))}
          </select>
          automatischen Backups
        </label>
        <p className="xs muted">
          {cfg.last_auto ? `Letztes automatisches Backup: ${formatDateTime(cfg.last_auto)}. ` : ""}Manuelle Backups werden nie automatisch gelöscht.
        </p>
      </section>

      <section className="card">
        <h3>Prüfen und wiederherstellen</h3>
        <div className="row wrap">
          <Button icon={<ShieldCheck size={15} />} onClick={() => void verify(false)} disabled={!!busy}>
            Backup prüfen …
          </Button>
          <Button icon={<RotateCcw size={15} />} onClick={() => void verify(true)} disabled={!!busy}>
            Aus Backup wiederherstellen …
          </Button>
        </div>
        <p className="xs muted">Vor jeder Wiederherstellung wird das Backup vollständig geprüft. Beschädigte oder unvollständige Backups werden nicht eingespielt.</p>
      </section>

      <section className="card">
        <h3>Verlauf</h3>
        {history.length === 0 ? (
          <p className="small muted">Noch keine Backups.</p>
        ) : (
          <table className="table small">
            <thead>
              <tr>
                <th>Zeitpunkt</th>
                <th>Art</th>
                <th>Status</th>
                <th>Größe</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i}>
                  <td className="tnum">{formatDateTime(h.created_at)}</td>
                  <td>{h.kind === "auto" ? "automatisch" : "manuell"}</td>
                  <td>
                    {h.status === "fehler" ? (
                      <span className="status-pill is-danger" title={h.message ?? ""}>
                        Fehler
                      </span>
                    ) : h.status === "warnung" ? (
                      <span className="status-pill is-warn" title={h.message ?? ""}>
                        Zweite Kopie fehlgeschlagen
                      </span>
                    ) : h.exists ? (
                      <span className="status-pill is-ok">ok</span>
                    ) : (
                      <span className="status-pill is-warn" title="Die Datei ist am Speicherort nicht mehr vorhanden (z. B. USB-Stick nicht angeschlossen).">
                        nicht auffindbar
                      </span>
                    )}
                  </td>
                  <td className="tnum">{h.size ? formatBytes(h.size) : "–"}</td>
                  <td>
                    {h.exists && h.status !== "fehler" && (
                      <Button size="sm" variant="ghost" onClick={() => void verify(false, h.path)}>
                        Prüfen
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
              <span className="path">{report.path}</span>
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
