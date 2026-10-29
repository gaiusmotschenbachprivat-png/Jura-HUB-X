/**
 * Vorlesungsaufnahme: Ton mit MediaRecorder, gleichzeitig Live-Transkript über
 * die Spracherkennung von iPadOS bzw. des Browsers (Web Speech API). Alles
 * bleibt auf dem Gerät; Studium OS sendet nichts. Teilstücke werden laufend
 * in IndexedDB gesichert, damit eine Aufnahme einen Absturz oder das Beenden
 * der App übersteht (Wiederherstellung beim nächsten Start der Aufnahme).
 */
import type { TranscriptSegment } from "../../lib/transcript";
import { recognitionCtor } from "../editor/Dictation";

const DB = "studium-aufnahme";
const CHUNK_MS = 10_000;

export interface RecordingMeta {
  session: string;
  noteId: string;
  noteTitle: string;
  startedAt: string;
  mime: string;
  segments: TranscriptSegment[];
  /** Dauer in Sekunden (ohne Pausen) */
  seconds: number;
}

export interface FinishedRecording {
  meta: RecordingMeta;
  file: File;
}

// ---------- IndexedDB ----------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("sessions", { keyPath: "session" });
      r.result.createObjectStore("chunks", { autoIncrement: true }).createIndex("session", "session");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(stores, mode);
      const req = fn(t);
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

const saveMeta = (m: RecordingMeta) => tx(["sessions"], "readwrite", (t) => void t.objectStore("sessions").put(m));
const saveChunk = (session: string, blob: Blob) => tx(["chunks"], "readwrite", (t) => void t.objectStore("chunks").add({ session, blob }));

/** Unterbrochene Aufnahme (falls vorhanden). */
export async function pendingRecording(): Promise<RecordingMeta | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const all = (await tx<RecordingMeta[]>(["sessions"], "readonly", (t) => t.objectStore("sessions").getAll())) ?? [];
    return all.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
  } catch {
    return null;
  }
}

async function chunksOf(session: string): Promise<Blob[]> {
  const rows = (await tx<{ session: string; blob: Blob }[]>(["chunks"], "readonly", (t) => t.objectStore("chunks").index("session").getAll(session))) ?? [];
  return rows.map((r) => r.blob);
}

/** Zwischenspeicher einer Aufnahme löschen (nach dem Speichern oder Verwerfen). */
export async function discardRecording(session: string) {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(["sessions", "chunks"], "readwrite");
      t.objectStore("sessions").delete(session);
      const idx = t.objectStore("chunks").index("session").openKeyCursor(IDBKeyRange.only(session));
      idx.onsuccess = () => {
        const c = idx.result;
        if (!c) return;
        t.objectStore("chunks").delete(c.primaryKey);
        c.continue();
      };
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export const extForMime = (mime: string) => (/mp4|m4a|aac/.test(mime) ? "m4a" : /mpeg/.test(mime) ? "mp3" : /wav/.test(mime) ? "wav" : "webm");

export function recordingFileName(meta: RecordingMeta): string {
  const d = new Date(meta.startedAt);
  const z = (n: number) => String(n).padStart(2, "0");
  const title = meta.noteTitle.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "Vorlesung";
  return `Aufnahme ${title} ${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}.${z(d.getMinutes())}.${extForMime(meta.mime)}`;
}

/** Unterbrochene Aufnahme als Datei zusammensetzen. */
export async function recoverRecording(meta: RecordingMeta): Promise<FinishedRecording | null> {
  const chunks = await chunksOf(meta.session);
  if (!chunks.length) return null;
  return { meta, file: new File(chunks, recordingFileName(meta), { type: meta.mime }) };
}

// ---------- Aufnahme ----------

function pickMime(): string {
  const MR = window.MediaRecorder;
  for (const m of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"]) if (MR?.isTypeSupported?.(m)) return m;
  return "";
}

export const canRecord = () => typeof window !== "undefined" && !!window.MediaRecorder && !!navigator.mediaDevices?.getUserMedia;

export type TranscriptState = "aus" | "laeuft" | "nicht verfügbar";

export class LectureRecorder {
  private media: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private rec: InstanceType<NonNullable<ReturnType<typeof recognitionCtor>>> | null = null;
  private wantRec = false;
  private wake: { release(): Promise<void> } | null = null;
  private activeMs = 0;
  private resumedAt = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<unknown> = Promise.resolve();
  meta: RecordingMeta;
  paused = false;
  transcript: TranscriptState = "aus";

  constructor(
    noteId: string,
    noteTitle: string,
    private onChange: (r: LectureRecorder, interim: string) => void,
    private liveTranscript = true,
  ) {
    this.meta = { session: crypto.randomUUID(), noteId, noteTitle, startedAt: new Date().toISOString(), mime: "", segments: [], seconds: 0 };
  }

  /** Sekunden Aufnahme bisher (ohne Pausen). */
  elapsed(): number {
    return (this.activeMs + (this.paused || !this.resumedAt ? 0 : Date.now() - this.resumedAt)) / 1000;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    const mime = pickMime();
    this.media = new MediaRecorder(this.stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 48_000 });
    this.meta.mime = (this.media.mimeType || mime || "audio/webm").split(";")[0]!;
    this.media.ondataavailable = (e) => {
      if (e.data.size) this.pending = this.pending.then(() => saveChunk(this.meta.session, e.data)).catch(() => {});
    };
    await saveMeta(this.meta);
    this.media.start(CHUNK_MS);
    this.resumedAt = Date.now();
    void this.keepAwake();
    if (this.liveTranscript) this.startTranscript();
    this.onChange(this, "");
  }

  private async keepAwake() {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock;
      this.wake = (await wl?.request("screen")) ?? null;
    } catch {
      this.wake = null;
    }
  }

  private startTranscript() {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      this.transcript = "nicht verfügbar";
      return;
    }
    const r = new Ctor();
    r.lang = "de-DE";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        const text = res[0].transcript.trim();
        if (!text) continue;
        if (res.isFinal) this.addSegment(text);
        else live += `${text} `;
      }
      this.onChange(this, live.trim());
    };
    r.onerror = (e) => {
      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(e.error)) {
        this.wantRec = false;
        this.transcript = "nicht verfügbar";
        this.onChange(this, "");
      }
    };
    // Safari beendet die Erkennung nach Pausen – solange gewünscht, neu starten
    r.onend = () => {
      if (!this.wantRec) return;
      try {
        r.start();
      } catch {
        this.transcript = "nicht verfügbar";
        this.onChange(this, "");
      }
    };
    this.rec = r;
    this.wantRec = true;
    try {
      r.start();
      this.transcript = "laeuft";
    } catch {
      this.wantRec = false;
      this.transcript = "nicht verfügbar";
    }
  }

  private addSegment(text: string) {
    // Zeitpunkt: grob der Beginn des Satzes (Erkennung liefert ihn etwas später)
    const t = Math.max(0, this.elapsed() - Math.min(8, text.split(/\s+/).length * 0.4));
    this.meta.segments.push({ t: Math.round(t), text });
    if (!this.saveTimer)
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.meta.seconds = Math.round(this.elapsed());
        void saveMeta(this.meta).catch(() => {});
      }, 3000);
  }

  pause() {
    if (!this.media || this.paused) return;
    this.media.pause();
    this.activeMs += Date.now() - this.resumedAt;
    this.paused = true;
    this.wantRec = false;
    this.rec?.stop();
    this.onChange(this, "");
  }

  resume() {
    if (!this.media || !this.paused) return;
    this.media.resume();
    this.resumedAt = Date.now();
    this.paused = false;
    if (this.transcript === "laeuft" && this.rec) {
      this.wantRec = true;
      try {
        this.rec.start();
      } catch {
        /* läuft noch */
      }
    }
    this.onChange(this, "");
  }

  /** Aufnahme beenden und als Datei liefern (Zwischenspeicher bleibt bis `discardRecording`). */
  async stop(): Promise<FinishedRecording> {
    const media = this.media;
    if (!media) throw new Error("Es läuft keine Aufnahme.");
    this.meta.seconds = Math.round(this.elapsed());
    if (!this.paused) this.activeMs += Date.now() - this.resumedAt;
    this.paused = true;
    this.wantRec = false;
    this.rec?.stop();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    await new Promise<void>((resolve) => {
      media.onstop = () => resolve();
      if (media.state === "inactive") resolve();
      else media.stop();
    });
    await this.pending;
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.wake?.release().catch(() => {});
    await saveMeta(this.meta).catch(() => {});
    const chunks = await chunksOf(this.meta.session);
    return { meta: this.meta, file: new File(chunks, recordingFileName(this.meta), { type: this.meta.mime }) };
  }

  /** Abbrechen ohne Speichern. */
  async cancel() {
    this.wantRec = false;
    this.rec?.abort();
    if (this.media && this.media.state !== "inactive") this.media.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.wake?.release().catch(() => {});
    await this.pending;
    await discardRecording(this.meta.session).catch(() => {});
  }
}
