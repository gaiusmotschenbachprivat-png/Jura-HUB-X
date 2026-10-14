import { generateHTML } from "@tiptap/core";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../api";
import type { VersionMeta } from "../../api/types";
import { formatDateTime } from "../../lib/format";
import { parseDoc } from "../../lib/pm";
import { reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { confirmDialog, Dialog } from "../../ui/Dialog";
import { editorExtensions } from "./extensions";
import { flush } from "./saveQueue";

export function VersionHistory({ noteId, onClose, onRestored }: { noteId: string; onClose: () => void; onRestored: () => void }) {
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const toast = useApp((s) => s.toast);
  const exts = useMemo(() => editorExtensions(), []);

  const load = async () => {
    const v = await api.noteVersions(noteId);
    setVersions(v);
    if (!sel && v[0]) setSel(v[0].id);
  };
  useEffect(() => {
    void flush(noteId).then(load).catch(reportError);
  }, [noteId]);
  useEffect(() => {
    if (!sel) return;
    api.noteVersionContent(sel).then(setContent).catch(reportError);
  }, [sel]);

  const html = useMemo(() => {
    if (!content) return "";
    try {
      return generateHTML(parseDoc(content), exts);
    } catch {
      return "<p><em>Diese Version kann nicht angezeigt werden.</em></p>";
    }
  }, [content, exts]);

  const restore = async () => {
    if (!sel) return;
    const v = versions.find((x) => x.id === sel);
    const ok = await confirmDialog({
      title: "Version wiederherstellen?",
      message: `Der Stand vom ${v ? formatDateTime(v.created_at) : ""} ersetzt den aktuellen Inhalt. Der aktuelle Inhalt wird vorher als eigene Version gesichert.`,
      confirm: "Wiederherstellen",
    });
    if (!ok) return;
    try {
      await flush(noteId);
      await api.noteVersionRestore(noteId, sel);
      toast("Version wiederhergestellt. Der vorherige Stand ist in der Historie.", "success");
      onRestored();
      onClose();
    } catch (e) {
      reportError(e);
    }
  };

  const snapshot = async () => {
    try {
      await flush(noteId);
      await api.noteVersionCreate(noteId, "Manuell gesichert");
      await load();
      toast("Version gespeichert.", "success");
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <Dialog
      title="Versionshistorie"
      onClose={onClose}
      width={900}
      footer={
        <>
          <Button onClick={snapshot}>Aktuellen Stand als Version sichern</Button>
          <span className="grow" />
          <Button onClick={onClose}>Schließen</Button>
          <Button variant="primary" onClick={restore} disabled={!sel}>
            Diese Version wiederherstellen
          </Button>
        </>
      }
    >
      <div className="versions">
        <div className="versions-list">
          {versions.length === 0 && <p className="muted small">Noch keine Versionen. Versionen entstehen automatisch alle 10 Minuten beim Schreiben.</p>}
          {versions.map((v) => (
            <button key={v.id} className={`version-item ${sel === v.id ? "is-sel" : ""}`} onClick={() => setSel(v.id)}>
              <span className="tnum">{formatDateTime(v.created_at)}</span>
              <span className="muted xs">
                {v.reason} · {v.word_count} Wörter
              </span>
            </button>
          ))}
        </div>
        <div className="versions-preview prose" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </Dialog>
  );
}
