/**
 * Abgleich mit einem zweiten Gerät über eine Backup-Datei (z. B. in iCloud
 * Drive) – ohne Server. Anders als „Wiederherstellen“ ersetzt der Abgleich
 * nichts, sondern führt zusammen:
 *  - Neue Einträge des anderen Geräts kommen hinzu.
 *  - Bei Einträgen auf beiden Geräten gewinnt die jüngere Änderung
 *    (`updated_at`, Papierkorb/Archiv zählen als Änderung).
 *  - Notizen: Die unterlegene Fassung bleibt als Version erhalten
 *    („Abgleich: andere Fassung“) – es geht kein Text verloren.
 *  - Versionen, Verknüpfungen, Wiederholungen, Gesetze: Vereinigung.
 *  - Einstellungen und Backup-Verlauf bleiben gerätebezogen.
 * Endgültig Gelöschtes (z. B. geleerter Papierkorb) wird nicht übertragen und
 * kann durch einen Abgleich zurückkommen.
 */
import type { Db } from "./db";
import { schemaVersion } from "./db";
import { CoreError } from "./errors";
import { newId, now, wordCount } from "./util";

type Row = Record<string, unknown>;

/** Tabellen mit eigener Kennung und Änderungszeit: jüngere Änderung gewinnt. */
const STAMPED = ["areas", "nodes", "documents", "knowledge", "flashcards", "tasks", "exams", "annotations"] as const;
/** Unveränderliche Einträge (nur hinzufügen) mit ihrem Schlüssel. */
const UNION: Record<string, string[]> = {
  note_versions: ["id"],
  blobs: ["sha256"],
  document_pages: ["document_id", "page_no"],
  placements: ["document_id", "node_id"],
  node_area_refs: ["node_id", "area_id"],
  links: ["id"],
  review_log: ["id"],
  legal_sources: ["id"],
  legal_chunks: ["id"],
};
/** Reihenfolge (übergeordnete Tabellen zuerst; Fremdschlüssel werden ohnehin erst am Ende geprüft). */
const ORDER = [
  "areas",
  "nodes",
  "notes",
  "note_versions",
  "blobs",
  "documents",
  "document_pages",
  "placements",
  "node_area_refs",
  "links",
  "knowledge",
  "flashcards",
  "review_log",
  "tasks",
  "exams",
  "annotations",
  "legal_sources",
  "legal_chunks",
] as const;


export interface MergeReport {
  added: Record<string, number>;
  updated: Record<string, number>;
  /** Notizen, die auf beiden Geräten unterschiedlich geändert wurden */
  conflicts: number;
  /** Prüfsummen der Dateien, die vom anderen Gerät übernommen werden müssen */
  blobs: string[];
  /**
   * Studienbereiche, die es hier unter gleichem Namen schon gibt, aber mit anderer
   * Kennung – typisch, wenn beide Geräte unabhängig eingerichtet wurden. Sie würden doppelt erscheinen.
   */
  duplicateAreas: string[];
}

const stamp = (r: Row) => [r.updated_at, r.deleted_at, r.archived_at].filter((x): x is string => typeof x === "string").sort().pop() ?? "";

function columns(db: Db, table: string): string[] {
  return db.all<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`).map((c) => c.name);
}

function insert(db: Db, table: string, cols: string[], r: Row) {
  db.run(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(", ")})`, cols.map((c) => r[c] ?? null) as never);
}

function updateRow(db: Db, table: string, cols: string[], key: string[], r: Row) {
  const set = cols.filter((c) => !key.includes(c));
  db.run(
    `UPDATE ${table} SET ${set.map((c, i) => `${c} = ?${i + 1}`).join(", ")} WHERE ${key.map((k, i) => `${k} = ?${set.length + i + 1}`).join(" AND ")}`,
    [...set.map((c) => r[c] ?? null), ...key.map((k) => r[k])] as never,
  );
}

/**
 * Führt `source` (das andere Gerät) in `target` (dieses Gerät) zusammen.
 * Mit `dryRun` wird nur gezählt (für die Vorschau), ohne etwas zu ändern.
 */
export function mergeDatabases(target: Db, source: Db, opts: { dryRun?: boolean } = {}): MergeReport {
  const sv = schemaVersion(source);
  const tv = schemaVersion(target);
  if (sv !== tv) throw CoreError.invalid(`Das andere Gerät hat einen anderen Datenstand (Schema ${sv}, hier ${tv}). Bitte beide Geräte zuerst auf dieselbe Version aktualisieren.`);
  const report: MergeReport = { added: {}, updated: {}, conflicts: 0, blobs: [], duplicateAreas: [] };
  const inc = (m: Record<string, number>, t: string) => (m[t] = (m[t] ?? 0) + 1);
  const write = !opts.dryRun;

  const run = () => {
    // Verweise erst am Ende der Transaktion prüfen (Reihenfolge innerhalb einer Tabelle egal)
    if (write) target.exec("PRAGMA defer_foreign_keys = ON");
    for (const table of ORDER) {
      const cols = columns(target, table);
      if (!cols.length) continue;
      const rows = source.all<Row>(`SELECT ${cols.join(", ")} FROM ${table}`);
      if ((STAMPED as readonly string[]).includes(table)) {
        for (const r of rows) {
          const cur = target.get<Row>(`SELECT ${cols.join(", ")} FROM ${table} WHERE id = ?1`, [r.id as string]);
          if (!cur) {
            inc(report.added, table);
            if (table === "areas" && target.value("SELECT 1 FROM areas WHERE lower(name) = lower(?1)", [String(r.name)]) !== undefined) report.duplicateAreas.push(String(r.name));
            if (write) insert(target, table, cols, r);
          } else if (stamp(r) > stamp(cur) && JSON.stringify(cols.map((c) => r[c])) !== JSON.stringify(cols.map((c) => cur[c]))) {
            inc(report.updated, table);
            if (write) updateRow(target, table, cols, ["id"], r);
          }
        }
      } else if (table === "notes") {
        for (const r of rows) {
          const cur = target.get<Row>(`SELECT ${cols.join(", ")} FROM notes WHERE node_id = ?1`, [r.node_id as string]);
          if (!cur) {
            inc(report.added, table);
            if (write) insert(target, table, cols, r);
            continue;
          }
          if (cur.content_json === r.content_json) continue;
          // Beide Fassungen behalten: die jüngere gilt, die andere wird Version –
          // außer die ältere steht ohnehin schon in einer Version (kein echter Konflikt).
          const sourceWins = String(r.updated_at) > String(cur.updated_at);
          const loser = sourceWins ? cur : r;
          const known = [target, source].some((d) => d.value("SELECT 1 FROM note_versions WHERE node_id = ?1 AND content_json = ?2", [r.node_id as string, loser.content_json as string]) !== undefined);
          if (sourceWins) inc(report.updated, table);
          if (known) {
            if (write && sourceWins) updateRow(target, "notes", cols, ["node_id"], r);
            continue;
          }
          report.conflicts++;
          if (write) {
            target.run(
              `INSERT INTO note_versions (id, node_id, content_json, plain_text, word_count, reason, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
              [newId(), r.node_id as string, loser.content_json as string, loser.plain_text as string, wordCount(String(loser.plain_text ?? "")), sourceWins ? "Abgleich: Fassung dieses Geräts" : "Abgleich: Fassung des anderen Geräts", now()],
            );
            if (sourceWins) updateRow(target, "notes", cols, ["node_id"], r);
          }
        }
      } else {
        const key = UNION[table]!;
        for (const r of rows) {
          const exists = target.value(`SELECT 1 FROM ${table} WHERE ${key.map((k, i) => `${k} = ?${i + 1}`).join(" AND ")}`, key.map((k) => r[k]) as never);
          if (exists !== undefined) continue;
          inc(report.added, table);
          if (table === "blobs") report.blobs.push(String(r.sha256));
          if (!write) continue;
          insert(target, table, cols, r);
          if (table === "legal_chunks")
            target.run("INSERT INTO legal_index (chunk_id, source_id, norm, heading, text) VALUES (?1, ?2, ?3, ?4, ?5)", [r.id, r.source_id, r.norm, r.heading, r.text] as never);
        }
      }
    }
    // Lerneinstellungen (z. B. Schema-Ergebnisse) übernehmen, wenn hier noch keine vorliegen
    for (const s of source.all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key LIKE 'learn.%'")) {
      if (target.value("SELECT 1 FROM settings WHERE key = ?1", [s.key]) === undefined && write) target.run("INSERT INTO settings (key, value) VALUES (?1, ?2)", [s.key, s.value]);
    }
  };

  if (!write) {
    run();
    return report;
  }
  target.tx(run);
  const broken = target.value("PRAGMA foreign_key_check");
  if (broken !== undefined) throw CoreError.corrupt("Nach dem Abgleich stimmen Verweise nicht – bitte das Backup von vorher wiederherstellen.");
  return report;
}
