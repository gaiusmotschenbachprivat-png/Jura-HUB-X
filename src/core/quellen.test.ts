// @vitest-environment node
import { describe, expect, it } from "vitest";

import { configure, Db, migrate, MIGRATIONS, schemaVersion, type RawDb } from "./db";
import * as areas from "./repo/areas";
import * as knowledge from "./repo/knowledge";
import { search, rebuild } from "./search";
import { sqlite3, testCtx } from "./testing";

describe("Quellen (Literatur & Urteile)", () => {
  it("Migration 4 erhält bestehende Wissenseinträge", async () => {
    const s = await sqlite3();
    const db = new Db(new s.oo1.DB(":memory:") as unknown as RawDb);
    configure(db);
    migrate(db, MIGRATIONS.slice(0, 3));
    expect(schemaVersion(db)).toBe(3);
    const a = areas.create(db, "Jura", "#123456");
    const d = knowledge.create(db, { type: "definition", area_id: a.id, node_id: null, title: "Willenserklärung", field: "BGB AT", data: { text: "Äußerung" } });
    expect(() => knowledge.create(db, { type: "quelle", area_id: null, node_id: null, title: "X", field: "", data: {} })).toThrow();
    migrate(db);
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    expect(knowledge.get(db, d.id).title).toBe("Willenserklärung");
    const q = knowledge.create(db, { type: "quelle", area_id: null, node_id: null, title: "Grüneberg/Ellenberger", field: "", data: { art: "kommentar", autoren: "Ellenberger, Jürgen", titel: "Grüneberg, BGB" } });
    expect(q.type).toBe("quelle");
    expect(db.value("PRAGMA foreign_key_check")).toBeUndefined();
  });

  it("Angaben werden bereinigt und sind durchsuchbar", async () => {
    const { db } = await testCtx();
    const q = knowledge.create(db, { type: "quelle", area_id: null, node_id: null, title: "BGH 12.3.2020", field: "", data: { art: "quatsch", gericht: "BGH", az: "I ZR 1/19", fremd: "weg" } });
    expect(q.data.art).toBe("sonstiges");
    expect(q.data).not.toHaveProperty("fremd");
    expect(Object.keys(q.data)).toHaveLength(16);
    rebuild(db);
    expect(search(db, "I ZR 1/19", null, 5).some((h) => h.entity_id === q.id)).toBe(true);
  });
});
