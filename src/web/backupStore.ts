/** Ablage für Backups im App-Speicher (OPFS-Ordner oder IndexedDB). */
import { CoreError } from "../core/errors";
import { openAppend, subdir } from "./opfsBlobs";

export interface BackupWriter {
  write(c: Uint8Array): void;
  close(): Promise<void> | void;
  abort(): void;
}

export interface BackupStore {
  list(): Promise<{ name: string; size: number; created_at: string }[]>;
  file(name: string): Promise<File>;
  writer(name: string): Promise<BackupWriter>;
  remove(name: string): Promise<void>;
}

export class OpfsBackupStore implements BackupStore {
  constructor(private base: FileSystemDirectoryHandle) {}
  private dir() {
    return subdir(this.base, "backups");
  }
  async list() {
    const dir = await this.dir();
    const out: { name: string; size: number; created_at: string }[] = [];
    for await (const [name, h] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      if (h.kind !== "file" || !name.endsWith(".studiumbackup")) continue;
      const f = await (h as FileSystemFileHandle).getFile();
      out.push({ name, size: f.size, created_at: new Date(f.lastModified).toISOString() });
    }
    return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async file(name: string) {
    try {
      return await (await (await this.dir()).getFileHandle(name)).getFile();
    } catch {
      throw CoreError.notFound("Die Backup-Datei wurde nicht gefunden.");
    }
  }
  async writer(name: string) {
    const dir = await this.dir();
    const w = await openAppend(dir, name);
    return {
      write: (c: Uint8Array) => w.write(c),
      close: () => w.close(),
      abort: () => {
        w.abort();
        void dir.removeEntry(name).catch(() => {});
      },
    };
  }
  async remove(name: string) {
    await (await this.dir()).removeEntry(name).catch(() => {});
  }
}
