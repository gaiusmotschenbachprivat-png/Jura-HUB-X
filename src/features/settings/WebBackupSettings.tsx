import { ArrowLeftRight, CheckCircle2, HardDriveDownload, RotateCcw, Share, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { api, errorMessage } from "../../api";
import type { BackupSettings as BS, MergeResult, VerifyReport } from "../../api/types";
import { MERGE_LABEL } from "../../lib/mergeLabels";
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
  const [remind, setRemind] = useState(true);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<{ path: string; label: string; report: VerifyReport; forRestore: boolean } | null>(null);
  const toast = useApp((s) => s.toast);
  const [merge, setMerge] = useState<{ path: string; label: string; preview: MergeResult } | null>(null);

  const pickMerge = async () => {
    const path = (await api.pickFiles({ multiple: false, title: "Backup des anderen Geräts auswählen" }))?.[0] ?? null;
    if (!path) return;
    setBusy("merge");
    try {
      await flushAll();
      setMerge({ path, label: path.split("/").pop() ?? path, preview: await api.backupMerge(path, true) });
    } catch (e) {
      toast(`Abgleich nicht möglich: ${errorMessage(e)}`, "error");
    } finally {
      setBusy(null);
    }
  };
  const runMerge = async () => {
    if (!merge) return;
    setBusy("merge");
    try {
      await flushAll();
      const r = await api.backupMerge(merge.path, false);
      const n = Object.values(r.added).reduce((a, b) => a + b, 0) + Object.values(r.updated).reduce((a, b) => a + b, 0);
      setMerge(null);
      toast(`Abgeglichen: ${n} Änderungen übernommen${r.conflicts ? `, ${r.conflicts} Notiz(en) mit zwei Fassungen (ältere in der Versionshistorie)` : ""}. Der vorherige Stand liegt als Backup bereit.`, "success");
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      toast(`Abgleich fehlgeschlagen: ${errorMessage(e)}. Es wurde nichts verändert.`, "error");
    } finally {
      setBusy(null);
    }
  };

  const load = async () => {
    try {
      const [c, files, settings] = await Promise.all([api.backupSettings(), wb.list(), api.settingsAll()]);
      setCfg(c);
      setLastExport(typeof settings["backup.last_export"] === "string" ? (settings["backup.last_export"] as string) : null);
      setRemind(settings["backup.remind"] !== false);
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
        <label className="row small">
          <input type="checkbox" checked={remind} onChange={(e) => void set("backup.remind", e.target.checked)} />
          Wöchentlich erinnern, das neueste Backup in die Dateien-App zu sichern
        </label>
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
        <h3>Mit anderem Gerät abgleichen</h3>
        <p className="small">
          Für ein zweites Gerät (z. B. Laptop) ohne fremden Server. Einmalig einrichten: das zweite Gerät mit „Aus Backup-Datei wiederherstellen“ starten. Danach: Auf
          dem anderen Gerät ein Backup erstellen und in iCloud Drive sichern, hier abgleichen. Neues kommt hinzu,
          bei Änderungen auf beiden Seiten gilt die jüngere – bei Notizen bleibt die andere Fassung in der Versionshistorie. Für die Gegenrichtung danach hier ein Backup
          sichern und dort abgleichen.
        </p>
        <div className="row wrap">
          <Button icon={<ArrowLeftRight size={15} />} onClick={() => void pickMerge()} disabled={!!busy}>
            {busy === "merge" ? "Prüfe Backup …" : "Backup des anderen Geräts abgleichen …"}
          </Button>
        </div>
        <p className="xs muted">Vor dem Abgleich wird der jetzige Stand vollständig gesichert. Endgültig Gelöschtes (geleerter Papierkorb) wird nicht übertragen.</p>
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

      {merge && (
        <Dialog
          title="Abgleich mit anderem Gerät"
          onClose={() => setMerge(null)}
          footer={
            <>
              <Button onClick={() => setMerge(null)}>Abbrechen</Button>
              <Button variant="primary" icon={<ArrowLeftRight size={14} />} onClick={() => void runMerge()} disabled={busy === "merge"}>
                {busy === "merge" ? "Gleiche ab …" : "Jetzt abgleichen"}
              </Button>
            </>
          }
        >
          <div className="stack small">
            <p>
              Backup „{merge.label}“{merge.preview.created_at ? ` vom ${formatDateTime(merge.preview.created_at)}` : ""}.
            </p>
            {merge.preview.duplicate_areas.length > 0 && (
              <p className="notice notice-warn">
                Achtung: Die Studienbereiche {merge.preview.duplicate_areas.map((n) => `„${n}“`).join(", ")} gibt es auf beiden Geräten, sie wurden aber unabhängig angelegt und
                würden doppelt erscheinen. Richte ein neues Gerät besser einmal mit „Aus Backup-Datei wiederherstellen“ ein und gleiche erst danach ab.
              </p>
            )}
            <MergeCounts preview={merge.preview} />
            {merge.preview.conflicts > 0 && (
              <p className="notice notice-warn">
                {merge.preview.conflicts} Notiz(en) wurden auf beiden Geräten unterschiedlich geändert. Die jüngere Fassung gilt, die andere bleibt in der Versionshistorie der Notiz.
              </p>
            )}
            <p className="xs muted">Der jetzige Stand wird vorher als Backup gesichert. Danach lädt die App neu.</p>
          </div>
        </Dialog>
      )}
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

function MergeCounts({ preview }: { preview: MergeResult }) {
  const keys = [...new Set([...Object.keys(preview.added), ...Object.keys(preview.updated)])].filter((k) => k !== "document_pages" && k !== "legal_chunks");
  if (!keys.length) return <p>Beide Geräte sind auf demselben Stand – es gibt nichts zu übernehmen.</p>;
  return (
    <table className="merge-table">
      <thead>
        <tr>
          <th />
          <th>neu</th>
          <th>aktualisiert</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k}>
            <td>{MERGE_LABEL[k] ?? k}</td>
            <td className="tnum">{preview.added[k] ?? 0}</td>
            <td className="tnum">{preview.updated[k] ?? 0}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
