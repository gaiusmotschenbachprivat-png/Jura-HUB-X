/**
 * Dokumentenspeicher im privaten Dateisystem der Website (OPFS), nur im Worker.
 * Gleiche Ablage wie am Desktop: `files/<xx>/<sha256>`. Schreiben über
 * `createSyncAccessHandle` (von Safari ab iPadOS 16.4 unterstützt).
 */
import { checkSha, MISSING_FILE, sha256Blob, type BlobStore } from "../core/blobs";
import { CoreError } from "../core/errors";
import { newId } from "../core/util";

type Dir = FileSystemDirectoryHandle;

interface SyncHandle {
  write(buf: Uint8Array, opts?: { at: number }): number;
  flush(): void;
  close(): void;
  truncate(n: number): void;
  getSize(): number;
}

export async function opfsRoot(): Promise<Dir> {
  return navigator.storage.getDirectory();
}

export async function subdir(parent: Dir, name: string, create = true): Promise<Dir> {
  return parent.getDirectoryHandle(name, { create });
}

/** Schreibt einen Blob stückweise in eine (neue) Datei. */
export async function writeFile(dir: Dir, name: string, data: Blob | Uint8Array): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true });
  const h = (await (fh as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle()) as SyncHandle;
  try {
    h.truncate(0);
    if (data instanceof Uint8Array) h.write(data, { at: 0 });
    else {
      let at = 0;
      const step = 4 * 1024 * 1024;
      for (let off = 0; off < data.size; off += step) {
        const c = new Uint8Array(await data.slice(off, off + step).arrayBuffer());
        h.write(c, { at });
        at += c.length;
      }
    }
    h.flush();
  } finally {
    h.close();
  }
}

/** Datei zum fortlaufenden Schreiben (Backups). */
export async function openAppend(dir: Dir, name: string) {
  const fh = await dir.getFileHandle(name, { create: true });
  const h = (await (fh as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle()) as SyncHandle;
  h.truncate(0);
  let at = 0;
  return {
    write(c: Uint8Array) {
      const n = h.write(c, { at });
      if (n !== c.length) throw CoreError.invalid("Der Speicher des Geräts ist voll.");
      at += n;
    },
    close() {
      h.flush();
      h.close();
    },
    abort() {
      try {
        h.close();
      } catch {
        /* egal */
      }
    },
  };
}

export async function exists(dir: Dir, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

export class OpfsBlobStore implements BlobStore {
  private known = new Set<string>();
  private constructor(
    private root: Dir,
    private tmp: Dir,
  ) {}

  static async open(base: Dir): Promise<OpfsBlobStore> {
    const s = new OpfsBlobStore(await subdir(base, "files"), await subdir(base, "tmp"));
    for await (const [prefix, sub] of (s.root as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
      if (sub.kind !== "directory" || !/^[0-9a-f]{2}$/.test(prefix)) continue;
      for await (const [name, f] of sub as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        if (f.kind === "file" && name.startsWith(prefix) && /^[0-9a-f]{64}$/.test(name)) s.known.add(name);
      }
    }
    // Reste abgebrochener Vorgänge entfernen
    for await (const [name] of s.tmp as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      await s.tmp.removeEntry(name, { recursive: true }).catch(() => {});
    }
    return s;
  }

  has(sha: string) {
    return this.known.has(sha);
  }

  list() {
    return [...this.known];
  }

  async put(data: Blob | Uint8Array) {
    const { sha256, size } = await sha256Blob(data);
    if (this.known.has(sha256)) return { sha256, size };
    const dir = await subdir(this.root, sha256.slice(0, 2));
    // Erst vollständig schreiben, dann als vorhanden markieren. Ein abgebrochener
    // Vorgang hinterlässt höchstens eine Datei, deren Inhalt beim Lesen geprüft wird.
    const tmpName = `put-${newId()}`;
    await writeFile(this.tmp, tmpName, data);
    const tmpHandle = await this.tmp.getFileHandle(tmpName);
    const moved = await (tmpHandle as unknown as { move?: (d: Dir, n: string) => Promise<void> }).move?.(dir, sha256).then(
      () => true,
      () => false,
    );
    if (!moved) {
      await writeFile(dir, sha256, data);
      await this.tmp.removeEntry(tmpName).catch(() => {});
    }
    this.known.add(sha256);
    return { sha256, size };
  }

  private async handle(sha: string): Promise<FileSystemFileHandle> {
    checkSha(sha);
    try {
      const dir = await subdir(this.root, sha.slice(0, 2), false);
      return await dir.getFileHandle(sha);
    } catch {
      throw CoreError.notFound(MISSING_FILE);
    }
  }

  async blob(sha: string): Promise<Blob> {
    return (await this.handle(sha)).getFile();
  }

  async read(sha: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.blob(sha)).arrayBuffer());
  }

  async remove(sha: string) {
    checkSha(sha);
    try {
      const dir = await subdir(this.root, sha.slice(0, 2), false);
      await dir.removeEntry(sha);
    } catch {
      /* war schon weg */
    }
    this.known.delete(sha);
  }
}
