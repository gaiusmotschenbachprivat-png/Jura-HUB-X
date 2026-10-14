import type { Backend } from "./backend";
import { createMockBackend } from "./mock";
import { createTauriBackend } from "./tauri";
import { createWebBackend } from "./web";
import { seedDemo } from "./demo";

export type { Backend } from "./backend";

function pick(): Backend {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) return createTauriBackend();
  // Vorschau mit ?demo bzw. Tests: Daten nur im Arbeitsspeicher, Beispieldaten
  // nur hier (nie in der echten App).
  const demo = typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");
  if (demo || import.meta.env.MODE === "test" || typeof Worker === "undefined") return createMockBackend(demo ? seedDemo : undefined);
  // Browser-/iPad-Version: Datenbank und Dokumente im privaten Speicher des Browsers.
  return createWebBackend();
}

export const api: Backend = pick();

// Nur für automatische Tests der Browser-Version (Adresse mit ?e2e).
if (api.kind === "web" && new URLSearchParams(location.search).has("e2e")) {
  const call = api as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  (window as unknown as { __STUDIUM_API__: unknown }).__STUDIUM_API__ = new Proxy(api, {
    get(target, prop) {
      if (prop === "__importBlob")
        return async (file: File, nodeId: string | null) => {
          const res = (await call.documentsImportFiles!([{ name: file.name, data: file }], nodeId, "folien")) as { document: unknown }[];
          const { enqueueExtraction } = await import("../features/documents/textExtraction");
          enqueueExtraction(res.flatMap((r) => (r.document ? [r.document as Parameters<typeof enqueueExtraction>[0][number]] : [])));
          return res;
        };
      if (prop === "__verifyBlob") return (blob: Blob) => call.backupVerifyFile!(blob);
      return (target as unknown as Record<string | symbol, unknown>)[prop];
    },
  });
}

/** Fehlermeldung aus einem Backend-Fehler (oder einem beliebigen Fehler) holen. */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return "Unbekannter Fehler.";
}
