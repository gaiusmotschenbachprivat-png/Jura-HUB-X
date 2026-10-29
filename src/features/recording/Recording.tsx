/**
 * Vorlesung aufnehmen: Knopf in der Mitschrift, Aufnahmeleiste (läuft weiter,
 * auch wenn man zu einer anderen Notiz wechselt), Speichern als Dokument
 * „Vorlesungsaufnahme“ an der Mitschrift mit Live-Transkript, danach
 * Lernskript, Karteikarten oder Transkript in die Mitschrift.
 */
import type { Editor } from "@tiptap/react";
import { AudioLines, Bookmark, Pause, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";

import { api, errorMessage } from "../../api";
import type { DocumentInfo } from "../../api/types";
import { formatTime, transcriptPages, transcriptText, type TranscriptSegment } from "../../lib/transcript";
import { reportError, useApp } from "../../state/store";
import { Button, IconButton } from "../../ui/Button";
import { confirmDialog, Dialog } from "../../ui/Dialog";
import { canRecord, discardRecording, LectureRecorder, pendingRecording, recoverRecording, type FinishedRecording, type RecordingMeta } from "./recorder";

const CONSENT_KEY = "editor.recordingConsent";
export const AUTO_SUMMARY_KEY = "editor.recordingAutoSummary";

/** Gespeicherte Aufnahme, die die Mitschrift noch verlinken soll. */
export interface SavedRecording {
  noteId: string;
  doc: DocumentInfo;
  meta: RecordingMeta;
}

interface RecordingState {
  recorder: LectureRecorder | null;
  interim: string;
  /** zählt bei jeder Änderung der Aufnahme hoch (Recorder bleibt dasselbe Objekt) */
  version: number;
  busy: boolean;
  saved: SavedRecording | null;
  /** Zeitmarke in die geöffnete Mitschrift (setzt der Editor) */
  mark: ((t: number) => void) | null;
  set(p: Partial<Omit<RecordingState, "set">>): void;
}

export const useRecording = create<RecordingState>((set) => ({ recorder: null, interim: "", version: 0, busy: false, saved: null, mark: null, set }));

/** Aufnahme als Dokument an der Mitschrift speichern, Transkript als Text. */
export async function saveRecording(rec: FinishedRecording): Promise<SavedRecording> {
  if (api.kind !== "web") throw new Error("Aufnahmen gibt es derzeit in der iPad-/Browser-Version.");
  const { registerFile } = await import("../../api/web");
  const [out] = await api.documentsImport([registerFile(rec.file)], rec.meta.noteId, "aufnahme");
  if (!out?.document) throw new Error(out?.error ?? "Die Aufnahme konnte nicht gespeichert werden.");
  const pages = transcriptPages(rec.meta.segments);
  const doc = pages.length ? await api.documentSetText(out.document.id, pages) : out.document;
  await discardRecording(rec.meta.session).catch(() => {});
  return { noteId: rec.meta.noteId, doc, meta: rec.meta };
}

/** Nach dem Speichern: zur Mitschrift wechseln, sie fügt den Verweis ein. */
async function finish(rec: FinishedRecording) {
  const saved = await saveRecording(rec);
  useApp.getState().bump();
  useRecording.getState().set({ saved });
  const st = useApp.getState();
  if (!(st.view.type === "note" && st.view.id === saved.noteId)) st.open({ type: "note", id: saved.noteId });
}

/** Beim Start der App: Hinweis auf eine unterbrochene Aufnahme. */
export async function checkInterruptedRecording() {
  const p = await pendingRecording();
  if (p) useApp.getState().toast(`Eine Aufnahme zu „${p.noteTitle}“ wurde unterbrochen. Öffne die Mitschrift und tippe auf „Vorlesung aufnehmen“, um sie zu sichern.`, "info");
}

async function askRecover(p: RecordingMeta): Promise<boolean> {
  const when = new Date(p.startedAt).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  const recover = await confirmDialog({
    title: "Unterbrochene Aufnahme",
    message: (
      <p>
        Eine Aufnahme vom {when} zu „{p.noteTitle}“ wurde nicht zu Ende gespeichert (etwa {Math.round(p.seconds / 60)} Min., {p.segments.length} Transkript-Abschnitte). Jetzt sichern?
      </p>
    ),
    confirm: "Sichern",
  });
  if (recover) {
    const rec = await recoverRecording(p);
    if (rec) await finish(rec);
    else await discardRecording(p.session);
    return false;
  }
  const drop = await confirmDialog({ title: "Aufnahme verwerfen?", message: <p>Die unterbrochene Aufnahme wird endgültig gelöscht.</p>, confirm: "Verwerfen", danger: true });
  if (drop) await discardRecording(p.session);
  return drop;
}

async function startRecording(noteId: string, noteTitle: string) {
  const toast = useApp.getState().toast;
  if (api.kind !== "web") return toast("Aufnahmen gibt es derzeit in der iPad-/Browser-Version.", "info");
  if (!canRecord()) return toast("Dieser Browser kann keine Tonaufnahmen machen.", "error");
  const pending = await pendingRecording();
  if (pending && !(await askRecover(pending))) return;
  const settings = await api.settingsAll().catch(() => ({}) as Record<string, unknown>);
  if (settings[CONSENT_KEY] !== true) {
    const ok = await confirmDialog({
      title: "Vorlesung aufnehmen?",
      message: (
        <>
          <p>
            <strong>Nur mit Erlaubnis:</strong> Nimm Vorlesungen nur auf, wenn die Lehrperson einverstanden ist. Viele Hochschulen untersagen Mitschnitte, und das heimliche Aufnehmen
            des nichtöffentlich gesprochenen Wortes kann strafbar sein (§ 201 StGB).
          </p>
          <p>Die Aufnahme bleibt auf diesem iPad. Das Live-Transkript erstellt die Spracherkennung von iPadOS – je nach Gerät auf dem Gerät oder über Server von Apple.</p>
          <p>Der Bildschirm bleibt während der Aufnahme an. Die App sollte im Vordergrund bleiben; wird sie beendet, lässt sich die Aufnahme bis dahin wiederherstellen.</p>
        </>
      ),
      confirm: "Verstanden, aufnehmen",
    });
    if (!ok) return;
    await api.settingSet(CONSENT_KEY, true).catch(() => {});
  }
  const r = new LectureRecorder(noteId, noteTitle, (rec, interim) => useRecording.getState().set({ recorder: rec, interim, version: useRecording.getState().version + 1 }));
  try {
    await r.start();
    useRecording.getState().set({ recorder: r, interim: "" });
    if (r.transcript === "nicht verfügbar") toast("Die Aufnahme läuft – ein Live-Transkript ist in diesem Browser nicht möglich.", "info");
  } catch (e) {
    await r.cancel().catch(() => {});
    const msg = e instanceof DOMException && e.name === "NotAllowedError" ? "Kein Zugriff auf das Mikrofon. Erlaube es in den iPad-Einstellungen für die App bzw. Safari." : errorMessage(e);
    toast(msg, "error");
  }
}

/** Knopf im Kopf der Mitschrift. */
export function RecordButton({ noteId, noteTitle }: { noteId: string; noteTitle: string }) {
  const recorder = useRecording((s) => s.recorder);
  const here = recorder?.meta.noteId === noteId;
  return (
    <IconButton
      label={recorder ? (here ? "Aufnahme läuft" : "Aufnahme läuft (andere Mitschrift)") : "Vorlesung aufnehmen"}
      active={!!recorder}
      className={recorder ? "is-recording" : ""}
      onClick={() => (recorder ? undefined : void startRecording(noteId, noteTitle).catch(reportError))}
    >
      <AudioLines size={16} />
    </IconButton>
  );
}

/** Aufnahmeleiste – app-weit, solange eine Aufnahme läuft. */
export function RecordingBar() {
  const recorder = useRecording((s) => s.recorder);
  const onMark = useRecording((s) => s.mark);
  useRecording((s) => s.version);
  const interim = useRecording((s) => s.interim);
  const busy = useRecording((s) => s.busy);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!recorder) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [recorder]);
  if (!recorder) return null;
  const last = recorder.meta.segments[recorder.meta.segments.length - 1]?.text;
  const stop = async () => {
    useRecording.getState().set({ busy: true });
    try {
      const rec = await recorder.stop();
      useRecording.getState().set({ recorder: null, interim: "" });
      await finish(rec);
    } catch (e) {
      reportError(e);
    } finally {
      useRecording.getState().set({ busy: false });
    }
  };
  return createPortal(
    <div className="recording-bar" role="status" aria-live="polite" aria-label="Aufnahme">
      <span className={`rec-dot ${recorder.paused ? "is-paused" : ""}`} aria-hidden />
      <strong className="tnum">{formatTime(recorder.elapsed())}</strong>
      <span className="grow ellipsis small">
        {recorder.paused
          ? "Pausiert"
          : recorder.transcript === "laeuft"
            ? interim || last || "Aufnahme läuft – Transkript entsteht beim Sprechen …"
            : "Aufnahme läuft (ohne Live-Transkript)"}
      </span>
      {onMark && (
        <IconButton label="Zeitmarke in die Mitschrift" onClick={() => onMark(recorder.elapsed())}>
          <Bookmark size={15} />
        </IconButton>
      )}
      <IconButton label={recorder.paused ? "Fortsetzen" : "Pause"} onClick={() => (recorder.paused ? recorder.resume() : recorder.pause())}>
        {recorder.paused ? <Play size={15} /> : <Pause size={15} />}
      </IconButton>
      <Button size="sm" variant="primary" icon={<Square size={12} />} disabled={busy} onClick={() => void stop()}>
        {busy ? "Speichert …" : "Stopp & speichern"}
      </Button>
    </div>,
    document.body,
  );
}

/** Verweis auf die Aufnahme am Ende der Mitschrift. */
export function insertRecordingLink(editor: Editor, s: SavedRecording) {
  const d = new Date(s.meta.startedAt);
  const when = d.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  const mins = Math.max(1, Math.round(s.meta.seconds / 60));
  editor
    .chain()
    .focus("end")
    .insertContent([
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: `Aufnahme · ${when} · ${mins} Min.` }] },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: s.meta.segments.length ? "Anhören und Transkript lesen" : "Anhören",
            marks: [{ type: "link", attrs: { href: `studium:document/${s.doc.id}` } }],
          },
          ...(s.meta.segments.length ? [{ type: "text", text: ` · ${s.meta.segments.length} Transkript-Abschnitte` }] : []),
        ],
      },
    ])
    .run();
}

/** Transkript mit Zeitmarken als Absätze. */
export function transcriptNodes(segments: TranscriptSegment[]) {
  const paras: { t: number; text: string[] }[] = [];
  for (const s of segments) {
    const cur = paras[paras.length - 1];
    if (!cur || s.t - cur.t >= 60) paras.push({ t: s.t, text: [s.text] });
    else cur.text.push(s.text);
  }
  return [
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Transkript (automatisch, ungeprüft)" }] },
    ...paras.map((p) => ({ type: "paragraph", content: [{ type: "text", text: `[${formatTime(p.t)}] `, marks: [{ type: "bold" }] }, { type: "text", text: p.text.join(" ") }] })),
  ];
}

/** Nach dem Speichern: was soll mit der Aufnahme passieren? */
export function RecordingDoneDialog({
  saved,
  editor,
  onStudy,
  onClose,
}: {
  saved: SavedRecording;
  editor: Editor;
  onStudy: (mode: "aufbereiten" | "karteikarten", text: string) => void;
  onClose: () => void;
}) {
  const [auto, setAuto] = useState(false);
  useEffect(() => {
    void api.settingsAll().then((s) => setAuto(s[AUTO_SUMMARY_KEY] === true));
  }, []);
  const segs = saved.meta.segments;
  const material = `Transkript der Vorlesungsaufnahme (automatische Spracherkennung, kann Hör- und Schreibfehler enthalten):\n\n${transcriptText(segs)}`;
  const study = (mode: "aufbereiten" | "karteikarten") => {
    onClose();
    onStudy(mode, material);
  };
  return (
    <Dialog
      title="Aufnahme gespeichert"
      onClose={onClose}
      width={560}
      footer={
        <>
          <label className="row small grow">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => {
                setAuto(e.target.checked);
                void api.settingSet(AUTO_SUMMARY_KEY, e.target.checked).catch(() => {});
              }}
            />
            Künftig direkt das Lernskript vorbereiten
          </label>
          <Button onClick={onClose}>Fertig</Button>
        </>
      }
    >
      <p className="small">
        {Math.max(1, Math.round(saved.meta.seconds / 60))} Minuten Aufnahme, {segs.length ? `${segs.length} Transkript-Abschnitte` : "kein Transkript"}. Die Aufnahme liegt als
        „Vorlesungsaufnahme“ an dieser Mitschrift (auch unter Dokumente); am Ende der Mitschrift steht ein Verweis zum Anhören.
      </p>
      {segs.length ? (
        <div className="stack">
          <Button variant="primary" onClick={() => study("aufbereiten")}>
            Lernskript / Zusammenfassung erstellen
          </Button>
          <Button onClick={() => study("karteikarten")}>Karteikarten vorschlagen</Button>
          <Button
            onClick={() => {
              editor.chain().focus("end").insertContent(transcriptNodes(segs)).run();
              onClose();
            }}
          >
            Transkript in die Mitschrift einfügen
          </Button>
          <p className="xs muted">Lernskript und Karteikarten: über die Claude API oder kostenlos über „In Claude-App“. Das Transkript ist automatisch erstellt und ungeprüft.</p>
        </div>
      ) : (
        <p className="small notice">
          Ohne Live-Transkript lässt sich die Aufnahme anhören, aber nicht zusammenfassen. Tipp: Beim Aufnehmen die App im Vordergrund lassen; die Spracherkennung von iPadOS muss
          eingeschaltet sein (Einstellungen → Allgemein → Tastatur → Diktierfunktion).
        </p>
      )}
    </Dialog>
  );
}
