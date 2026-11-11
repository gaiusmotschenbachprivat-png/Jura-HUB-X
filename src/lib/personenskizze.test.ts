import { describe, expect, it } from "vitest";

import { autoLayout, edges, fixNorm, parseSketch, sketchFromText, sketchSpec, sketchText } from "./personenskizze";

describe("Personenskizze", () => {
  it("Kurzschreibweise erkennen (wie in Mitschriften)", () => {
    const s = sketchFromText("Personenskizze\nA—§ 433 I BGB→G\nA←$ 433 II BGB—G\nA —Kaufvertrag— G\nG → D\nD ↔ A\nFreier Text ohne Pfeil.");
    expect(s.persons.map((p) => p.name)).toEqual(["A", "G", "D"]);
    expect(s.relations.map((r) => [r.kind, r.dir, r.label])).toEqual([
      ["anspruch", "vor", "§ 433 I BGB"],
      ["anspruch", "zurueck", "§ 433 II BGB"],
      ["vertrag", "keine", "Kaufvertrag"],
      ["anspruch", "vor", ""],
      ["anspruch", "beide", ""],
    ]);
    expect(sketchText(s)).toEqual(["A — § 433 I BGB → G", "A ← § 433 II BGB — G", "A — Kaufvertrag — G", "G → D", "D ↔ A"]);
    // die eigene Ausgabe lässt sich wieder einlesen
    expect(sketchText(sketchFromText(sketchText(s).join("\n")))).toEqual(sketchText(s));
    const h = sketchFromText("V —übereignet→ K");
    expect(h.relations[0]).toMatchObject({ kind: "handlung", dir: "vor", label: "übereignet" });
  });
  it("Normen bereinigen", () => {
    expect(fixNorm("$ 433 II BGB")).toBe("§ 433 II BGB");
    expect(fixNorm("§433  I BGB")).toBe("§ 433 I BGB");
  });
  it("Anordnung und Linien", () => {
    const ps = autoLayout([1, 2, 3].map((i) => ({ id: `p${i}`, name: `P${i}`, role: "", x: 0, y: 0 })));
    expect(ps.map((p) => [p.x, p.y])).toEqual([
      [320, 70],
      [150, 290],
      [490, 290],
    ]);
    const s = { persons: autoLayout([{ id: "a", name: "A", role: "", x: 0, y: 0 }, { id: "b", name: "B", role: "", x: 0, y: 0 }]), relations: [
      { id: "r1", from: "a", to: "b", kind: "anspruch" as const, dir: "vor" as const, label: "x" },
      { id: "r2", from: "b", to: "a", kind: "anspruch" as const, dir: "vor" as const, label: "y" },
    ] };
    const g = edges(s);
    // zwei Beziehungen desselben Paars liegen nebeneinander, enden am Kästchenrand
    expect(Math.abs(g[0]!.y1 - g[1]!.y1)).toBe(30);
    expect(g[0]!.x1).toBeGreaterThan(150 + 28);
    expect(g[0]!.x2).toBeLessThan(490 - 28);
  });
  it("Gespeicherte Daten werden geprüft", () => {
    const s = parseSketch(JSON.stringify({ persons: [{ id: "a", name: "A", x: 9999, y: -5 }, { id: "b", name: "" }, { nope: 1 }], relations: [{ id: "r", from: "a", to: "b", kind: "quatsch", dir: "vor" }, { id: "x", from: "a", to: "zz" }, { id: "self", from: "a", to: "a" }] }));
    expect(s.persons.map((p) => [p.name, p.x, p.y])).toEqual([
      ["A", 640, 0],
      ["?", 320, 180],
    ]);
    expect(s.relations.map((r) => [r.id, r.kind])).toEqual([["r", "anspruch"]]);
    expect(parseSketch("kaputt")).toEqual({ persons: [], relations: [] });
  });
  it("Zeichnung: Pfeile je Richtung, Beschriftung, Personen", () => {
    const s = sketchFromText("A—§ 433 I BGB→G\nA←§ 433 II BGB—G");
    const json = JSON.stringify(sketchSpec(s));
    expect((json.match(/marker-end/g) ?? []).length).toBe(1);
    expect((json.match(/marker-start/g) ?? []).length).toBe(1);
    expect(json).toContain("§ 433 I BGB");
    expect(json).toContain("ps-person");
  });
});
