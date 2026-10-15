import { HardDriveDownload, X } from "lucide-react";
import { useEffect, useState } from "react";

import { api, errorMessage } from "../../api";
import { formatDateTime } from "../../lib/format";
import { useApp } from "../../state/store";
import { Button, IconButton } from "../../ui/Button";
import { flushAll } from "../editor/saveQueue";

const DAY = 86_400_000;
export const REMIND_DAYS = 7;

/** Soll erinnert werden? Rein, damit testbar. */
export function shouldRemind(o: { now: number; lastExport: string | null; snoozeUntil: string | null; enabled: boolean; hasNotes: boolean }): boolean {
  if (!o.enabled || !o.hasNotes) return false;
  if (o.snoozeUntil && Date.parse(o.snoozeUntil) > o.now) return false;
  if (!o.lastExport) return true;
  return o.now - Date.parse(o.lastExport) > REMIND_DAYS * DAY;
}

/**
 * iPad: Backups liegen zunächst nur im App-Speicher. Einmal pro Woche erinnert
 * diese Leiste daran, das neueste Backup in die Dateien-App (z. B. iCloud Drive)
 * zu sichern – erst dann übersteht es den Verlust des Geräts.
 */
export function BackupReminder() {
  const nodes = useApp((s) => s.nodes);
  const toast = useApp((s) => s.toast);
  const [file, setFile] = useState<{ file: File; created: string } | null>(null);
  const [show, setShow] = useState(false);
  const hasNotes = nodes.some((n) => n.kind === "note");

  useEffect(() => {
    const wb = api.webBackups;
    const qs = new URLSearchParams(location.search);
    if (api.kind !== "web" || !wb || !hasNotes || (qs.has("e2e") && !qs.has("remind"))) return;
    let alive = true;
    (async () => {
      const s = await api.settingsAll();
      const remind = shouldRemind({
        now: Date.now(),
        lastExport: typeof s["backup.last_export"] === "string" ? s["backup.last_export"] : null,
        snoozeUntil: typeof s["backup.snooze_until"] === "string" ? s["backup.snooze_until"] : null,
        enabled: s["backup.remind"] !== false,
        hasNotes,
      });
      if (!remind || !alive) return;
      // Neuestes Backup; ist es älter als einen Tag, vorher ein frisches anlegen
      let list = await wb.list();
      const newest = list.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      if (!newest || Date.now() - Date.parse(newest.created_at) > DAY) {
        await flushAll();
        await api.backupCreate();
        list = (await wb.list()).sort((a, b) => b.created_at.localeCompare(a.created_at));
      }
      const top = list[0];
      if (!top || !alive) return;
      // Datei vorab laden: Das Teilen-Menü muss direkt im Tippen geöffnet werden
      setFile({ file: await wb.file(top.name), created: top.created_at });
      setShow(true);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [hasNotes]);

  if (!show || !file) return null;
  const snooze = (days: number) => {
    setShow(false);
    void api.settingSet("backup.snooze_until", new Date(Date.now() + days * DAY).toISOString());
  };
  return (
    <div className="backup-reminder" role="region" aria-label="Backup-Erinnerung">
      <HardDriveDownload size={18} />
      <div className="grow small">
        <strong>Backup in Dateien sichern</strong>
        <div className="muted xs">Neuestes Backup vom {formatDateTime(file.created)} – sichere es in iCloud Drive oder „Auf meinem iPad“.</div>
      </div>
      <Button
        variant="primary"
        size="sm"
        onClick={() => {
          // ohne vorheriges await (Safari verlangt den direkten Tipp)
          void api
            .webBackups!.save(file.file)
            .then(async () => {
              await api.settingSet("backup.last_export", new Date().toISOString());
              setShow(false);
              toast("Backup gesichert.", "success");
            })
            .catch((e) => toast(`Sichern abgebrochen: ${errorMessage(e)}`, "error"));
        }}
      >
        In Dateien sichern
      </Button>
      <Button size="sm" variant="ghost" onClick={() => snooze(3)}>
        In 3 Tagen
      </Button>
      <IconButton label="Diese Woche nicht mehr" onClick={() => snooze(REMIND_DAYS)}>
        <X size={16} />
      </IconButton>
    </div>
  );
}
