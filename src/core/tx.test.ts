// @vitest-environment node
/**
 * Fehlerfall vom iPad: Scheitert COMMIT einmal (Speicherfehler), darf die
 * Transaktionstiefe nicht falsch stehen bleiben – sonst lautete jede weitere
 * Änderung „SAVEPOINT sp-1“ (Syntaxfehler) und weder Speichern noch Backup
 * funktionierten bis zum Neustart.
 */
import { describe, expect, it } from "vitest";

import * as areas from "./repo/areas";
import * as nodes from "./repo/nodes";
import * as notes from "./repo/notes";
import { openTestDb } from "./testing";

const doc = (t: string) => JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });

describe("Transaktionen nach einem Fehler", () => {
  it("speichert nach einem gescheiterten COMMIT wieder normal", async () => {
    const db = await openTestDb();
    const a = areas.create(db, "Rechtswissenschaften", "#3b5bdb");
    const note = nodes.create(db, { area_id: a.id, parent_id: null, kind: "note", title: "Fall 4" });
    const raw = db.raw as unknown as { exec: (o: { sql: string }) => unknown };
    const orig = raw.exec.bind(raw);
    let fail = 1;
    raw.exec = (o) => {
      if (fail && o.sql === "COMMIT") {
        fail--;
        throw new Error("SQLITE_IOERR: disk I/O error");
      }
      return orig(o as never);
    };
    expect(() => notes.save(db, note.id, doc("eins"), "eins")).toThrow(/disk I\/O/);
    // danach: normal speichern, auch verschachtelt (nodes.create nutzt tx in tx)
    expect(() => notes.save(db, note.id, doc("zwei"), "zwei")).not.toThrow();
    expect(notes.get(db, note.id).content_json).toContain("zwei");
    expect(() => nodes.create(db, { area_id: a.id, parent_id: null, kind: "note", title: "Fall 5" })).not.toThrow();
  });

  it("verwirft eine liegengebliebene Transaktion statt dauerhaft zu scheitern", async () => {
    const db = await openTestDb();
    const a = areas.create(db, "Rechtswissenschaften", "#3b5bdb");
    const note = nodes.create(db, { area_id: a.id, parent_id: null, kind: "note", title: "Fall 4" });
    const raw = db.raw as unknown as { exec: (o: { sql: string }) => unknown };
    const orig = raw.exec.bind(raw);
    let fail = 1;
    // COMMIT und ROLLBACK scheitern einmal: SQLite bleibt in der Transaktion
    raw.exec = (o) => {
      if (fail && (o.sql === "COMMIT" || o.sql === "ROLLBACK")) {
        if (o.sql === "ROLLBACK") fail--;
        throw new Error("SQLITE_BUSY");
      }
      return orig(o as never);
    };
    expect(() => notes.save(db, note.id, doc("eins"), "eins")).toThrow();
    expect(() => notes.save(db, note.id, doc("zwei"), "zwei")).not.toThrow();
    expect(notes.get(db, note.id).content_json).toContain("zwei");
  });

  it("Fehler in einem inneren Schritt rollt nur diesen zurück", async () => {
    const db = await openTestDb();
    db.exec("CREATE TABLE t (x INTEGER)");
    db.tx(() => {
      db.run("INSERT INTO t VALUES (1)");
      expect(() =>
        db.tx(() => {
          db.run("INSERT INTO t VALUES (2)");
          throw new Error("innen");
        }),
      ).toThrow("innen");
    });
    expect(db.all("SELECT x FROM t").map((r) => r.x)).toEqual([1]);
    expect(() => db.tx(() => db.run("INSERT INTO t VALUES (3)"))).not.toThrow();
  });
});
