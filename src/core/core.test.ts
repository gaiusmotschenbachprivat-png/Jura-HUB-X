// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildQuery, search } from "./search";
import * as areas from "./repo/areas";
import * as nodes from "./repo/nodes";
import * as notes from "./repo/notes";
import { openTestDb } from "./testing";
import { newId, isId } from "./util";

describe("Kern (Browser-Version): Grundlagen", () => {
  it("erzeugt UUID v7", () => {
    const id = newId();
    expect(isId(id)).toBe(true);
    expect(id[14]).toBe("7");
  });

  it("baut sichere Suchabfragen", () => {
    expect(buildQuery("§ 433 BGB")).toBe('"433"* "BGB"*');
    expect(buildQuery('"Anspruch OR (x')).toBe('"Anspruch"* "OR"* "x"*');
    expect(buildQuery("  §§ ")).toBeNull();
  });

  it("legt Struktur und Notizen an und findet sie", async () => {
    const db = await openTestDb();
    const a = areas.create(db, "Rechtswissenschaften", "#3B5BDB");
    expect(a.color).toBe("#3b5bdb");
    const sem = nodes.create(db, { area_id: a.id, parent_id: null, kind: "semester", title: "WS 2026/27" });
    const note = nodes.create(db, { area_id: a.id, parent_id: sem.id, kind: "note", title: "Termin 1" });
    const doc = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Willenserklärung" }] }] });
    const r = notes.save(db, note.id, doc, "Willenserklärung");
    expect(r.version_created).toBe(true);
    expect(notes.save(db, note.id, doc, "Willenserklärung").version_created).toBe(false);
    const hits = search(db, "willens", null, 20);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.path).toBe("WS 2026/27");
    expect(hits[0]!.snippet).toContain("\u0002Willenserklärung\u0003");
    expect(() => nodes.moveNode(db, sem.id, note.id, 1, null)).toThrow(/in sich selbst/);
    expect(notes.get(db, note.id).path).toBe("WS 2026/27");
    expect(() => notes.save(db, note.id, "{}", "")).toThrow(/unbekanntes Format/);
  });
});
