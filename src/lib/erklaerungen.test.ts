import { describe, expect, it } from "vitest";

import { explanationsOf, parseEntry, sameTerm } from "./erklaerungen";
import type { PMNode } from "./pm";

const P = (...c: PMNode[]): PMNode => ({ type: "paragraph", content: c });
const t = (text: string, bold = false): PMNode => ({ type: "text", text, ...(bold ? { marks: [{ type: "bold" }] } : {}) });

describe("Begriffe & Erklärungen", () => {
  it("Begriff fett, mit Gedankenstrich oder Doppelpunkt", () => {
    expect(parseEntry(P(t("Dolus eventualis", true), t(" – billigendes Inkaufnehmen")))).toEqual({ term: "Dolus eventualis", text: "billigendes Inkaufnehmen" });
    expect(parseEntry(P(t("Kausalität:", true), t(" conditio sine qua non")))).toEqual({ term: "Kausalität", text: "conditio sine qua non" });
    expect(parseEntry(P(t("ex tunc – rückwirkend")))).toEqual({ term: "ex tunc", text: "rückwirkend" });
    expect(parseEntry(P(t("Synallagma: Gegenseitigkeitsverhältnis")))).toEqual({ term: "Synallagma", text: "Gegenseitigkeitsverhältnis" });
    expect(parseEntry(P(t("Nur ein Begriff")))).toEqual({ term: "Nur ein Begriff", text: "" });
    expect(parseEntry(P())).toBeNull();
  });
  it("nur Einträge aus dem Bereich, nicht aus der übrigen Mitschrift", () => {
    const doc: PMNode = {
      type: "doc",
      content: [
        P(t("Mitschrift: kein Eintrag")),
        { type: "erklaerungen", content: [P(t("Mens rea", true), t(" – Schuld")), P(), { type: "bulletList", content: [{ type: "listItem", content: [P(t("ultima ratio – letztes Mittel"))] }] }] },
      ],
    };
    expect(explanationsOf(doc)).toEqual([
      { term: "Mens rea", text: "Schuld" },
      { term: "ultima ratio", text: "letztes Mittel" },
    ]);
    expect(sameTerm("Ex Tunc", "ex tunc")).toBe(true);
  });
});
