import type { Backend } from "./backend";
import { createMockBackend } from "./mock";
import { createTauriBackend } from "./tauri";
import { seedDemo } from "./demo";

export type { Backend } from "./backend";

function pick(): Backend {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) return createTauriBackend();
  // Browser-Vorschau: Daten nur im Arbeitsspeicher. Mit ?demo werden
  // Beispieldaten geladen (nur hier, nie in der Desktop-App).
  const demo = typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");
  return createMockBackend(demo ? seedDemo : undefined);
}

export const api: Backend = pick();

/** Fehlermeldung aus einem Backend-Fehler (oder einem beliebigen Fehler) holen. */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return "Unbekannter Fehler.";
}
