import { getSchema } from "@tiptap/core";
import { Node as PMNodeClass } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import type { Card, SchemaItem, StudyNode } from "../api/types";
import { editorExtensions } from "../features/editor/extensions";
import { scanDefinitions } from "./definitionScan";
import { courseOf, descendantIds, statsByFach } from "./learnStats";
import { judgeAnswer, quizPoints, shuffled } from "./schemaQuiz";

const schema = getSchema(editorExtensions());
const t = (text: string, marks: string[] = []) => ({ type: "text", text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });
const p = (...content: object[]) => ({ type: "paragraph", content });
const docOf = (...content: object[]) => PMNodeClass.fromJSON(schema, { type: "doc", content });

describe("Definitionen in Mitschriften finden", () => {
  it("fetter Begriff mit Doppelpunkt, „ist“ oder Gedankenstrich; „Definition:“-Absätze", () => {
    const doc = docOf(
      p(t("Willenserklärung:", ["bold"]), t(" Äußerung eines auf eine Rechtsfolge gerichteten Willens.")),
      p(t("Anfechtung", ["bold"]), t(" ist die rückwirkende Vernichtung einer Willenserklärung.")),
      p(t("Dissens", ["bold"]), t(" – fehlende Einigung über einen Vertragspunkt (§§ 154, 155 BGB).")),
      p(t("Definition: Angebot – empfangsbedürftige Willenserklärung, die auf einen Vertragsschluss zielt.")),
      p(t("Wichtig", ["bold"]), t(" für die Klausur")), // kein Trenner → keine Definition
      p(t("§ 119 BGB", ["bold"]), t(": Inhaltsirrtum und Erklärungsirrtum")), // Norm, keine Definition
      p(t("Normaler Satz: hier steht etwas ohne fetten Begriff.")),
      p(t("Willenserklärung:", ["bold"]), t(" doppelt, wird nur einmal vorgeschlagen.")),
    );
    const found = scanDefinitions(doc);
    expect(found.map((f) => f.term)).toEqual(["Willenserklärung", "Anfechtung", "Dissens", "Angebot"]);
    expect(found[0]!.text).toBe("Äußerung eines auf eine Rechtsfolge gerichteten Willens.");
    expect(found[1]!.text).toBe("Die rückwirkende Vernichtung einer Willenserklärung.");
    expect(found[2]!.text.startsWith("Fehlende Einigung")).toBe(true);
    // Positionen treffen den Begriff (zum Verlinken)
    for (const f of found) expect(doc.textBetween(f.termFrom!, f.termTo!)).toBe(f.term);
  });

  it("bereits verlinkte Begriffe werden erkannt", () => {
    const doc = docOf(p({ type: "text", text: "Rechtsgeschäft", marks: [{ type: "bold" }, { type: "link", attrs: { href: "studium:knowledge/00000000-0000-0000-0000-000000000001" } }] }, t(": Tatbestand aus mindestens einer Willenserklärung.")));
    expect(scanDefinitions(doc)[0]).toMatchObject({ term: "Rechtsgeschäft", linked: true });
  });
});

const item = (text: string, children: SchemaItem[] = []): SchemaItem => ({ id: text, text, note: "", children });

describe("Schemata üben", () => {
  const items = [item("Anspruch entstanden", [item("Einigung"), item("Kein Nichtigkeitsgrund")]), item("Anspruch nicht erloschen", [item("Anfechtung, § 142 I BGB")]), item("Anspruch durchsetzbar"), item("")];
  it("Punkte in Prüfungsreihenfolge mit Gliederung und Pfad", () => {
    const pts = quizPoints(items);
    expect(pts.map((x) => `${x.label} ${x.text}`)).toEqual(["A. Anspruch entstanden", "I. Einigung", "II. Kein Nichtigkeitsgrund", "B. Anspruch nicht erloschen", "I. Anfechtung, § 142 I BGB", "C. Anspruch durchsetzbar"]);
    expect(pts[2]!.path).toEqual(["Anspruch entstanden"]);
  });
  it("Mischen lässt nie alles an seinem Platz", () => {
    const l = [1, 2, 3];
    for (let i = 0; i < 20; i++) expect(shuffled(l, () => 0.999)).not.toEqual(l);
    expect(shuffled([1])).toEqual([1]);
  });
  it("Antworten nachsichtig vergleichen", () => {
    expect(judgeAnswer("anspruch entstanden", "Anspruch entstanden").verdict).toBe("richtig");
    expect(judgeAnswer("Anfechtung § 142", "Anfechtung, § 142 I BGB").verdict).toBe("richtig");
    expect(judgeAnswer("Anfechtnug", "Anfechtung, § 142 I BGB").verdict).toBe("richtig");
    expect(judgeAnswer("Einigung", "Einigung und Übergabe").verdict).toBe("teilweise");
    expect(judgeAnswer("§ 142 BGB", "Anfechtung, § 142 I BGB").verdict).toBe("falsch");
    expect(judgeAnswer("Kein Nichtigkeitsgrnd", "Kein Nichtigkeitsgrund").verdict).toBe("richtig");
    expect(judgeAnswer("Rücktritt", "Anspruch durchsetzbar").verdict).toBe("falsch");
    expect(judgeAnswer("", "Einigung").verdict).toBe("falsch");
  });
});

const node = (id: string, kind: StudyNode["kind"], parent: string | null, title = id) => ({ id, kind, parent_id: parent, title }) as StudyNode;
const card = (over: Partial<Card>): Card => ({ id: Math.random().toString(), area_id: null, node_id: null, kind: "frage", front: "", back: "", tags: "", source_type: null, source_id: null, difficult: false, suspended: false, due: "2026-01-01T00:00:00Z", stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0, last_review: null, created_at: "", updated_at: "", deleted_at: null, ...over });

describe("Lernstand nach Fach", () => {
  const nodes = [node("sem", "semester", null), node("bgb", "course", "sem", "BGB AT"), node("vl1", "note", "bgb"), node("str", "course", "sem", "Strafrecht")];
  it("Fach = nächste Veranstaltung, Teilbaum enthält Notizen", () => {
    expect(courseOf(nodes, "vl1")?.title).toBe("BGB AT");
    expect(courseOf(nodes, "sem")).toBeNull();
    expect([...descendantIds(nodes, "bgb")].sort()).toEqual(["bgb", "vl1"]);
  });
  it("zählt sitzend, fällig, neu je Fach; pausierte zählen nicht", () => {
    const now = "2026-10-20T12:00:00Z";
    const cards = [
      card({ node_id: "vl1", kind: "definition", state: 2, stability: 40, due: "2026-12-01T00:00:00Z" }),
      card({ node_id: "vl1", kind: "definition", state: 2, stability: 5, due: "2026-10-19T00:00:00Z" }),
      card({ node_id: "bgb", kind: "norm", state: 0 }),
      card({ node_id: "str", state: 1, due: "2026-10-25T00:00:00Z" }),
      card({ node_id: null }),
      card({ node_id: "vl1", suspended: true }),
    ];
    const s = statsByFach(cards, nodes, now);
    expect(s.map((x) => x.title)).toEqual(["BGB AT", "Strafrecht", "Ohne Fach"]);
    expect(s[0]).toMatchObject({ total: 3, mastered: 1, learning: 1, fresh: 1, due: 2, byKind: { definition: 2, norm: 1, frage: 0 } });
  });
});
