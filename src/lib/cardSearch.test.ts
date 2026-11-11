import { describe, expect, it } from "vitest";

import type { Card } from "../api/types";
import { compileSearch } from "./cardSearch";

const NOW = new Date(2026, 10, 11, 12);
let n = 0;
const card = (over: Partial<Card>): Card => ({
  id: `c${++n}`, area_id: null, node_id: null, kind: "frage", front: "F", back: "B", tags: "", source_type: null, source_id: null, difficult: false, suspended: false,
  due: NOW.toISOString(), stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0, last_review: null,
  created_at: "2026-11-10T00:00:00Z", updated_at: "", deleted_at: null, deck: "", template: "basis", fields: "{}", flag: 0, buried_until: null, note_key: null, ord: 0, ...over,
});

const C = [
  card({ id: "we", front: "Willenserklärung", back: "Äußerung eines Rechtsfolgewillens", deck: "Zivilrecht::BGB AT", template: "definition", tags: "Rechtsgeschäft, Anfechtung", fields: JSON.stringify({ norm: "§§ 116 ff. BGB" }) }),
  card({ id: "sache", front: "Sache", back: "Körperlicher Gegenstand", deck: "Zivilrecht::Sachenrecht", template: "definition", state: 2, scheduled_days: 30, lapses: 4, flag: 1, last_review: "2026-11-11T08:00:00Z" }),
  card({ id: "mord", front: "Mordmerkmale", back: "Heimtücke …", deck: "Strafrecht::BT", template: "schema", suspended: true, created_at: "2025-01-01T00:00:00Z" }),
  card({ id: "luecke", front: "Die {{c1::Anfechtung}} wirkt ex tunc.", back: "x", deck: "Zivilrecht::BGB AT", template: "luecke", tags: "Problemkarte" }),
];
const ids = (q: string) => C.filter((c) => compileSearch(q)(c, NOW)).map((c) => c.id);

describe("Kartensuche", () => {
  it("Text, Wortgruppe, Felder, Umlaute egal", () => {
    expect(ids("")).toEqual(["we", "sache", "mord", "luecke"]);
    expect(ids("anfechtung")).toEqual(["we", "luecke"]);
    expect(ids('"körperlicher gegenstand"')).toEqual(["sache"]);
    expect(ids("116")).toEqual(["we"]);
    expect(ids("aeusserung")).toEqual([]);
    expect(ids("ausserung")).toEqual([]);
    expect(ids("Äußerung")).toEqual(["we"]);
  });
  it("Stapel, Schlagwort, Typ, Flagge, Status", () => {
    expect(ids('deck:"Zivilrecht"')).toEqual(["we", "sache", "luecke"]);
    expect(ids("deck:zivilrecht::bgb*")).toEqual(["we", "luecke"]);
    expect(ids("deck:Zivil")).toEqual([]);
    expect(ids("tag:anfechtung")).toEqual(["we"]);
    expect(ids("tag:none")).toEqual(["sache", "mord"]);
    expect(ids("typ:definition -deck:Zivilrecht::Sachenrecht")).toEqual(["we"]);
    expect(ids("flag:1")).toEqual(["sache"]);
    expect(ids("is:suspended")).toEqual(["mord"]);
    expect(ids("is:new")).toEqual(["we", "luecke"]);
    expect(ids("is:leech")).toEqual(["luecke"]);
  });
  it("Eigenschaften, Zeit, oder", () => {
    expect(ids("prop:ivl>=21")).toEqual(["sache"]);
    expect(ids("prop:lapses>3")).toEqual(["sache"]);
    expect(ids("added:3")).toEqual(["we", "sache", "luecke"]);
    expect(ids("rated:1")).toEqual(["sache"]);
    expect(ids("typ:schema or flag:1")).toEqual(["sache", "mord"]);
  });
});
