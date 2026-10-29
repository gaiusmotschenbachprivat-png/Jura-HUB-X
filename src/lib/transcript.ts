/**
 * Transkript einer Vorlesungsaufnahme: Abschnitte mit Zeitpunkt in der
 * Aufnahme. Gespeichert als Seitentext des Aufnahme-Dokuments (durchsuchbar),
 * eine „Seite“ je fünf Minuten, jede Zeile „[mm:ss] Text“.
 */

export interface TranscriptSegment {
  /** Sekunden ab Beginn der Aufnahme */
  t: number;
  text: string;
}

const PAGE_SECONDS = 300;

/** 75 → „1:15“, 3725 → „1:02:05“ */
export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

export function parseTime(s: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Abschnitte → Seitentexte (für `documentSetText`). */
export function transcriptPages(segments: TranscriptSegment[]): string[] {
  const pages: string[][] = [];
  for (const s of segments) {
    const text = s.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const i = Math.floor(s.t / PAGE_SECONDS);
    (pages[i] ??= []).push(`[${formatTime(s.t)}] ${text}`);
  }
  return Array.from(pages, (p) => (p ?? []).join("\n")).filter(Boolean);
}

/** Seitentexte → Abschnitte. */
export function parseTranscript(pages: string[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const line of pages.join("\n").split("\n")) {
    const m = /^\[([\d:]+)\]\s*(.*)$/.exec(line.trim());
    const t = m ? parseTime(m[1]!) : null;
    if (m && t !== null && m[2]!.trim()) out.push({ t, text: m[2]!.trim() });
  }
  return out;
}

/** Fließtext für Zusammenfassung und KI (mit Zeitmarken alle paar Minuten). */
export function transcriptText(segments: TranscriptSegment[]): string {
  let last = -Infinity;
  return segments
    .map((s) => {
      const mark = s.t - last >= 180 ? `\n[${formatTime(s.t)}] ` : "";
      if (mark) last = s.t;
      return `${mark}${s.text}`;
    })
    .join(" ")
    .trim();
}
