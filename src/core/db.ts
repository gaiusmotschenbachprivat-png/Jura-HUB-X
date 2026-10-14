/**
 * Dünne, synchrone Hülle um SQLite (sqlite-wasm). Die SQL-Texte des Rust-Kerns
 * werden unverändert übernommen, Parameter als `?1, ?2 …` gebunden.
 *
 * Läuft im Web Worker der iPad-/Browser-Version und in den Tests unter Node.
 */
import m1 from "../../crates/studium-core/src/db/migrations/0001_init.sql?raw";
import m2 from "../../crates/studium-core/src/db/migrations/0002_wissen_lernen.sql?raw";

import { CoreError } from "./errors";

/** Alle Migrationen in Reihenfolge – dieselben Dateien wie in der Desktop-App. */
export const MIGRATIONS: readonly string[] = [m1, m2];
export const SCHEMA_VERSION = MIGRATIONS.length;

export type SqlValue = string | number | bigint | null | Uint8Array;
export type Param = SqlValue | boolean | undefined;
export type Row = Record<string, SqlValue>;

/** Minimale Schnittstelle von `sqlite3.oo1.DB`, die wir benutzen. */
export interface RawDb {
  exec(opts: { sql: string; bind?: SqlValue[]; rowMode?: "object"; returnValue?: "resultRows" }): unknown;
  changes(): number;
  close(): void;
}

function bindable(params: Param[]): SqlValue[] {
  return params.map((p) => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : p));
}

export class Db {
  private depth = 0;
  constructor(readonly raw: RawDb) {}

  /** Führt eine Anweisung aus und liefert die Zahl geänderter Zeilen. */
  run(sql: string, params: Param[] = []): number {
    this.raw.exec({ sql, bind: params.length ? bindable(params) : undefined });
    return this.raw.changes();
  }

  all<T = Row>(sql: string, params: Param[] = []): T[] {
    return this.raw.exec({
      sql,
      bind: params.length ? bindable(params) : undefined,
      rowMode: "object",
      returnValue: "resultRows",
    }) as T[];
  }

  get<T = Row>(sql: string, params: Param[] = []): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  /** Erster Wert der ersten Zeile. */
  value<T = SqlValue>(sql: string, params: Param[] = []): T | undefined {
    const row = this.get<Row>(sql, params);
    if (!row) return undefined;
    const k = Object.keys(row)[0];
    return k === undefined ? undefined : (row[k] as T);
  }

  /** Mehrere Anweisungen ohne Parameter (Migrationen). */
  exec(sql: string): void {
    this.raw.exec({ sql });
  }

  /**
   * Führt `fn` in einer Transaktion aus. Verschachtelte Aufrufe nutzen
   * Savepoints. Wirft `fn`, wird alles zurückgerollt.
   */
  tx<T>(fn: () => T): T {
    const name = `sp${this.depth}`;
    this.exec(this.depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${name}`);
    this.depth++;
    try {
      const r = fn();
      if (r instanceof Promise) throw new Error("Transaktionen dürfen nicht asynchron sein.");
      this.depth--;
      this.exec(this.depth === 0 ? "COMMIT" : `RELEASE ${name}`);
      return r;
    } catch (e) {
      this.depth--;
      try {
        this.exec(this.depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${name}; RELEASE ${name}`);
      } catch {
        /* ursprünglichen Fehler weitergeben */
      }
      throw e;
    }
  }
}

export function configure(db: Db): void {
  // WAL wird von der OPFS-Speicherung im Browser nicht unterstützt; das
  // Rollback-Journal mit synchronous=FULL ist ebenso transaktionssicher.
  db.exec("PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;");
}

export function schemaVersion(db: Db): number {
  return Number(db.value("PRAGMA user_version") ?? 0);
}

/**
 * Führt fehlende Migrationen aus, jede in einer eigenen Transaktion.
 * `beforeMigrate` wird vor der Migration einer bestehenden Datenbank
 * aufgerufen (Sicherungskopie).
 */
export function migrate(db: Db, migrations: readonly string[] = MIGRATIONS, beforeMigrate?: (from: number) => void): void {
  const target = migrations.length;
  const current = schemaVersion(db);
  if (current > target) {
    throw CoreError.invalid(
      `Die Datenbank stammt von einer neueren Version von Studium OS (Schema ${current}). ` +
        "Bitte aktualisiere die App. Deine Daten wurden nicht verändert.",
    );
  }
  if (current === target) return;
  if (current > 0) beforeMigrate?.(current);
  for (let i = current; i < target; i++) {
    db.tx(() => {
      db.exec(migrations[i]!);
      db.exec(`PRAGMA user_version = ${i + 1};`);
    });
  }
}

export function integrityCheck(db: Db): void {
  const res = String(db.value("PRAGMA integrity_check") ?? "");
  if (res !== "ok") throw new CoreError("backup_corrupt", `Das Backup ist unvollständig oder beschädigt: Datenbankprüfung meldet: ${res}`);
}
