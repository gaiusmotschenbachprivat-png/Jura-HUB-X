/**
 * Backend der Browser-/iPad-Version. Alle Daten bleiben im Gerät: Datenbank und
 * Dokumente liegen im privaten Speicher der Website (OPFS) und werden von einem
 * Web Worker verwaltet. Es gibt keine Netzwerkaufrufe.
 *
 * Dateien, die der Benutzer auswählt, bekommen einen virtuellen Pfad
 * (`web-file:<id>/<name>`), weil Browser keine echten Pfade kennen.
 */
import type { Backend, WebBackups } from "./backend";
import type { Ready, Request, Response } from "../web/protocol";

const files = new Map<string, File>();

// API-Schlüssel für die Claude API: nur im Arbeitsspeicher dieser Sitzung,
// nie gespeichert. Beim Schließen oder Neuladen ist er weg.
let sessionKey: string | null = null;
export function webSessionKey(): string | null {
  return sessionKey;
}
let fileSeq = 0;

/** Datei für `documentsImport` bereitstellen (z. B. eine Aufnahme). */
export function registerFile(f: File): string {
  return register(f);
}

function register(f: File): string {
  const key = `web-file:${++fileSeq}/${f.name}`;
  files.set(key, f);
  return key;
}

function resolveFile(path: string): File {
  const f = files.get(path);
  if (!f) throw { code: "not_found", message: "Die ausgewählte Datei ist nicht mehr verfügbar. Bitte wähle sie erneut aus." };
  return f;
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Bietet eine Datei zum Sichern an: Teilen-Menü (iPad: „In Dateien sichern“) oder Download. */
export async function saveFile(name: string, data: Blob | Uint8Array, mime = "application/octet-stream"): Promise<void> {
  const file = data instanceof File && data.name === name ? data : new File([data as BlobPart], name, { type: mime });
  const nav = navigator as Navigator & { userActivation?: { isActive: boolean } };
  if (nav.canShare?.({ files: [file] }) && (nav.userActivation?.isActive ?? true)) {
    try {
      await nav.share({ files: [file] });
      return;
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return; // abgebrochen
      // sonst: Download versuchen
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function pickWithInput(multiple: boolean): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    // Kein `accept`: iPadOS sperrt sonst unbekannte Endungen wie .studiumbackup.
    // Erlaubte Typen prüft der Kern beim Import.
    input.style.display = "none";
    let done = false;
    const finish = (v: File[] | null) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(v);
    };
    input.addEventListener("change", () => finish(input.files?.length ? [...input.files] : null));
    input.addEventListener("cancel", () => finish(null));
    document.body.append(input);
    input.click();
  });
}

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  md: "text/markdown",
  txt: "text/plain",
  html: "text/html",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

export function createWebBackend(): Backend {
  const worker = new Worker(new URL("../web/worker.ts", import.meta.url), { type: "module", name: "studium-os-daten" });
  let seq = 0;
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: unknown): void }>();
  let readyResolve!: () => void;
  let readyReject!: (e: unknown) => void;
  const ready = new Promise<void>((res, rej) => {
    readyResolve = res;
    readyReject = rej;
  });
  worker.onmessage = (ev: MessageEvent<Response | Ready>) => {
    const m = ev.data;
    if ("ready" in m) {
      if (m.ready) readyResolve();
      else readyReject(m.error);
      return;
    }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.value);
    else p.reject(m.error);
  };
  worker.onerror = () => readyReject({ code: "internal", message: "Der Datenspeicher konnte nicht gestartet werden." });

  const call = async <T>(method: string, ...args: unknown[]): Promise<T> => {
    await ready;
    return new Promise<T>((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ id, method, args } satisfies Request);
    });
  };


  const backups: WebBackups = {
    list: () => call("backupFiles"),
    file: (name) => call("backupFile", name),
    remove: (name) => call("backupDelete", name),
    save: (file) => saveFile(file.name, file),
    persisted: async () => {
      try {
        return (await navigator.storage?.persisted?.()) ?? false;
      } catch {
        return false;
      }
    },
    requestPersist: async () => {
      try {
        return (await navigator.storage?.persist?.()) ?? false;
      } catch {
        return false;
      }
    },
    estimate: async () => {
      try {
        const e = await navigator.storage.estimate();
        return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
      } catch {
        return null;
      }
    },
  };

  const local = {
    kind: "web" as const,
    ready,
    webBackups: backups,

    documentsImport: (paths: string[], nodeId: string | null, docType: string) =>
      call("documentsImportFiles", paths.map((p) => ({ name: fileName(p), data: resolveFile(p) })), nodeId, docType),

    async documentOpenExternal(id: string) {
      // Fenster sofort öffnen (im Klick), sonst blockiert Safari es.
      const w = window.open("", "_blank");
      try {
        const [detail, bytes] = await Promise.all([
          call<{ document: { title: string; ext: string; mime: string } }>("documentGet", id),
          call<Uint8Array>("documentBytes", id),
        ]);
        const d = detail.document;
        const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: d.mime || MIME[d.ext] || "application/octet-stream" });
        if (w && (d.ext === "pdf" || d.mime.startsWith("image/") || d.ext === "txt")) {
          w.location.href = URL.createObjectURL(blob);
        } else {
          w?.close();
          await saveFile(`${d.title}.${d.ext}`, blob, blob.type);
        }
      } catch (e) {
        w?.close();
        throw e;
      }
      return "";
    },

    async documentExportCopy(id: string, dest: string) {
      const bytes = await call<Uint8Array>("documentBytes", id);
      const name = fileName(dest).replace(/^download:/, "");
      await saveFile(name, bytes, MIME[name.split(".").pop() ?? ""] ?? "application/octet-stream");
    },

    backupVerify: (path: string) =>
      path.startsWith("web-file:") ? call("backupVerifyFile", resolveFile(path)) : call("backupVerifyStored", path),
    backupRestore: (path: string) =>
      path.startsWith("web-file:") ? call("backupRestoreFile", resolveFile(path)) : call("backupRestoreStored", path),
    backupMerge: (path: string, preview: boolean) =>
      path.startsWith("web-file:") ? call("backupMergeFile", resolveFile(path), preview) : call("backupMergeStored", path, preview),

    async exportWrite(path: string, bytes: Uint8Array) {
      const name = path.replace(/^download:/, "");
      await saveFile(name, bytes, MIME[name.split(".").pop() ?? ""] ?? "application/octet-stream");
    },
    async readExternalFile(path: string) {
      return new Uint8Array(await resolveFile(path).arrayBuffer());
    },
    async openUrl(url: string) {
      if (!/^(https?:|mailto:)/i.test(url)) throw { code: "invalid", message: "Nur Web- und E-Mail-Links können geöffnet werden." };
      window.open(url, "_blank", "noopener,noreferrer");
    },
    async revealPath() {
      /* Im Browser gibt es keinen sichtbaren Datenordner. */
    },
    async pickFiles({ multiple }: { multiple: boolean }) {
      const picked = await pickWithInput(multiple);
      return picked ? picked.map(register) : null;
    },
    async pickDirectory() {
      return null;
    },
    async aiStatus() {
      return { available: !!sessionKey, key_source: sessionKey ? ("session" as const) : ("none" as const), can_fetch_laws: false };
    },
    async aiSetSessionKey(key: string | null) {
      const k = key?.trim() ?? "";
      sessionKey = k ? k : null;
    },
    async aiHttp() {
      throw { code: "invalid", message: "Nicht nötig: Die Browser-Version spricht die Claude API direkt an." };
    },
    async lawFetch() {
      throw {
        code: "invalid",
        message:
          "Im Browser kann Studium OS Gesetze nicht selbst laden (gesetze-im-internet.de erlaubt das technisch nicht). Lade die XML-Datei dort herunter und importiere sie.",
      };
    },
    async pickSavePath(defaultName: string) {
      return `download:${defaultName}`;
    },
    onFileDrop(handler: (paths: string[]) => void, hover?: (over: boolean) => void) {
      let depth = 0;
      const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
      const enter = (e: DragEvent) => {
        if (!hasFiles(e)) return;
        depth++;
        hover?.(true);
      };
      const over = (e: DragEvent) => {
        if (hasFiles(e)) e.preventDefault();
      };
      const leave = (e: DragEvent) => {
        if (!hasFiles(e)) return;
        depth = Math.max(0, depth - 1);
        if (!depth) hover?.(false);
      };
      const drop = (e: DragEvent) => {
        if (!hasFiles(e)) return;
        // Bilder im Editor behandelt der Editor selbst.
        if ((e.target as HTMLElement | null)?.closest?.(".ProseMirror")) return;
        e.preventDefault();
        depth = 0;
        hover?.(false);
        const list = [...(e.dataTransfer?.files ?? [])];
        if (list.length) handler(list.map(register));
      };
      window.addEventListener("dragenter", enter);
      window.addEventListener("dragover", over);
      window.addEventListener("dragleave", leave);
      window.addEventListener("drop", drop);
      return () => {
        window.removeEventListener("dragenter", enter);
        window.removeEventListener("dragover", over);
        window.removeEventListener("dragleave", leave);
        window.removeEventListener("drop", drop);
      };
    },
  };
  // Datei-Dialoge und Teilen laufen hier, alle übrigen Aufrufe gehen an den Worker.
  const remote = new Map<string, (...a: unknown[]) => Promise<unknown>>();
  return new Proxy(local as Record<string | symbol, unknown>, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop !== "string" || prop === "then") return undefined;
      let fn = remote.get(prop);
      if (!fn) remote.set(prop, (fn = (...args: unknown[]) => call(prop, ...args)));
      return fn;
    },
  }) as unknown as Backend;
}
