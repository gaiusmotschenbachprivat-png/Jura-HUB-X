/**
 * Notfall-Entwurf: Scheitert das Speichern (z. B. Speicherfehler auf dem
 * iPad), liegt der aktuelle Stand zusätzlich im Browser-Speicher des Geräts.
 * Beim nächsten Öffnen der Notiz – auch nach einem Neustart der App – lässt er
 * sich wiederherstellen. Nach erfolgreichem Speichern wird er gelöscht.
 * Bleibt auf dem Gerät; nichts wird übertragen.
 */
export interface Draft {
  json: string;
  text: string;
  /** Zeitpunkt (ISO) */
  at: string;
}

const KEY = (id: string) => `studium.draft.${id}`;

function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function saveDraft(id: string, json: string, text: string, at = new Date().toISOString()): boolean {
  try {
    store()?.setItem(KEY(id), JSON.stringify({ json, text, at } satisfies Draft));
    return true;
  } catch {
    return false; // Speicher voll oder gesperrt
  }
}

export function getDraft(id: string): Draft | null {
  try {
    const raw = store()?.getItem(KEY(id));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    return typeof d.json === "string" && typeof d.text === "string" && typeof d.at === "string" ? (d as Draft) : null;
  } catch {
    return null;
  }
}

export function clearDraft(id: string) {
  try {
    store()?.removeItem(KEY(id));
  } catch {
    /* egal */
  }
}

/** Entwurf, der neuer ist als der gespeicherte Stand und sich von ihm unterscheidet */
export function pendingDraft(id: string, saved: { content_json: string; updated_at: string }): Draft | null {
  const d = getDraft(id);
  if (!d) return null;
  if (d.json === saved.content_json || d.at <= saved.updated_at) {
    clearDraft(id);
    return null;
  }
  return d;
}
