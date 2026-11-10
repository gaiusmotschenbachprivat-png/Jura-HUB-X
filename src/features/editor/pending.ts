/**
 * Aufträge an eine Mitschrift, die erst noch geöffnet wird (z. B. von der
 * Übersicht): an der zuletzt bearbeiteten Stelle weiterschreiben oder eine
 * KI-Lernhilfe öffnen. Die letzte Schreibposition je Mitschrift merkt sich
 * das Gerät (nur eine Zahl, kein Text).
 */
import type { StudyMode } from "../assistant/StudyTools";

type Request = { noteId: string; kind: "resume" } | { noteId: string; kind: "study"; mode: StudyMode };
let pending: Request | null = null;

export const requestResume = (noteId: string) => {
  pending = { noteId, kind: "resume" };
};
export const requestStudy = (noteId: string, mode: StudyMode) => {
  pending = { noteId, kind: "study", mode };
};
/** aus einer Sammlung (z. B. „Zum Wiederholen“): Mitschrift an dieser Textstelle öffnen */
let pendingText: { noteId: string; text: string } | null = null;
export const requestTextJump = (noteId: string, text: string) => {
  pendingText = { noteId, text };
};
export function takeTextJump(noteId: string): string | null {
  if (pendingText?.noteId !== noteId) return null;
  const t = pendingText.text;
  pendingText = null;
  return t;
}

export function takeRequest(noteId: string): Request | null {
  if (pending?.noteId !== noteId) return null;
  const r = pending;
  pending = null;
  return r;
}

const KEY = (id: string) => `studium.cursor.${id}`;
export function saveCursor(noteId: string, pos: number) {
  try {
    localStorage.setItem(KEY(noteId), String(pos));
  } catch {
    /* privater Modus: egal */
  }
}
export function savedCursor(noteId: string): number | null {
  try {
    const n = Number(localStorage.getItem(KEY(noteId)));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
