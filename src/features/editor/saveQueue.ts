/**
 * Speichert Notizen zuverlässig:
 * - höchstens ein Speichervorgang je Notiz gleichzeitig,
 * - Änderungen während eines Speichervorgangs werden danach gespeichert,
 * - `flushAll()` schreibt alles Ausstehende (Notizwechsel, Fenster schließen).
 */
import { api, errorMessage } from "../../api";
import { useApp } from "../../state/store";

interface Pending {
  id: string;
  get: () => { json: string; text: string };
  timer: ReturnType<typeof setTimeout> | null;
  running: Promise<void> | null;
  again: boolean;
  failed: boolean;
}

const queue = new Map<string, Pending>();
export const AUTOSAVE_DELAY = 800;

async function run(p: Pending): Promise<void> {
  if (p.running) {
    p.again = true;
    return p.running;
  }
  const st = useApp.getState();
  p.running = (async () => {
    do {
      p.again = false;
      const { json, text } = p.get();
      st.setSaveStatus("saving");
      try {
        const res = await api.noteSave(p.id, json, text);
        p.failed = false;
        st.setSaveStatus("saved", null, res.updated_at, p.id);
      } catch (e) {
        p.failed = true;
        st.setSaveStatus("error", errorMessage(e));
        throw e;
      }
    } while (p.again);
  })();
  try {
    await p.running;
  } finally {
    p.running = null;
  }
}

/** Meldet eine Änderung; gespeichert wird nach kurzer Pause. */
export function scheduleSave(id: string, get: Pending["get"]) {
  let p = queue.get(id);
  if (!p) {
    p = { id, get, timer: null, running: null, again: false, failed: false };
    queue.set(id, p);
  }
  p.get = get;
  useApp.getState().setSaveStatus("dirty");
  if (p.timer) clearTimeout(p.timer);
  const pp = p;
  p.timer = setTimeout(() => {
    pp.timer = null;
    void run(pp).catch(() => {});
  }, AUTOSAVE_DELAY);
}

/** Speichert eine Notiz sofort (falls etwas aussteht). */
export async function flush(id: string): Promise<void> {
  const p = queue.get(id);
  if (!p) return;
  if (p.timer || p.failed) {
    if (p.timer) clearTimeout(p.timer);
    p.timer = null;
    await run(p);
  } else if (p.running) {
    await p.running;
  }
}

export async function flushAll(): Promise<void> {
  await Promise.allSettled([...queue.keys()].map(flush));
}

export function hasPending(): boolean {
  return [...queue.values()].some((p) => p.timer || p.running || p.failed);
}

/** Erneuter Versuch nach einem Fehler. */
export async function retry(id: string) {
  const p = queue.get(id);
  if (p) await run(p).catch(() => {});
}

/** Hält den aktuellen Inhalt fest (vor dem Schließen des Editors) und speichert sofort. */
export function freezeAndFlush(id: string): Promise<void> {
  const p = queue.get(id);
  if (!p || (!p.timer && !p.running && !p.failed)) return Promise.resolve();
  try {
    const v = p.get();
    p.get = () => v;
  } catch {
    /* Inhalt nicht mehr lesbar – letzter Stand bleibt */
  }
  return flush(id).catch(() => {});
}
