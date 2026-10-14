// @vitest-environment node
/**
 * Port der Rust-Tests zu Wissensobjekten, Fundstellen und Karteikarten
 * (`tests/phase3.rs` sowie die Unit-Tests in `knowledge.rs`).
 */
import { describe, expect, it } from "vitest";

import type { Knowledge, NewKnowledge, ReviewInput } from "../api/types";
import { CoreError } from "./errors";
import * as areas from "./repo/areas";
import * as cards from "./repo/cards";
import * as knowledge from "./repo/knowledge";
import * as links from "./repo/links";
import * as nodes from "./repo/nodes";
import * as notes from "./repo/notes";
import * as planning from "./repo/planning";
import * as trash from "./repo/trash";
import { rebuild, search } from "./search";
import { testCtx } from "./testing";

async function setup() {
  const ctx = await testCtx();
  const jura = areas.create(ctx.db, "Rechtswissenschaften", "#1f3f8f").id;
  const wiwi = areas.create(ctx.db, "WiWiZ", "#9a5b13").id;
  return { ctx, db: ctx.db, jura, wiwi };
}

function newK(type: NewKnowledge["type"], title: string, area: string | null, data: Record<string, unknown>): NewKnowledge {
  return { type, area_id: area, node_id: null, title, field: "Zivilrecht", data };
}

type Items = { id: string; text: string; children: Items }[];

describe("Fundstellen (knowledge.rs)", () => {
  it("citations_format_and_parse", () => {
    const p = (s: string) => knowledge.parseCitation(s);
    expect(knowledge.formatCitation(p("§ 433 Abs. 1 S. 1 BGB")!)).toBe("§ 433 Abs. 1 S. 1 BGB");
    expect(knowledge.formatCitation(p("Art. 2 I GG")!)).toBe("Art. 2 Abs. 1 GG");
    expect(knowledge.formatCitation(p("§§ 133, 157 BGB")!)).toBe("§ 133 BGB");
    expect(p("§ 823 Abs. 1 Alt. 2 BGB")!.alt).toBe("2");
    expect(knowledge.formatCitation(p("§ 20 Nr. 1 VwVfG")!)).toBe("§ 20 Nr. 1 VwVfG");
    expect(p("Kaufvertrag")).toBeNull();
    expect(p("§ abc")).toBeNull();
  });

  it("liefert alle Felder in Rust-Reihenfolge", () => {
    expect(knowledge.parseCitation("Artikel 12 Absatz 1 Satz 2 GG")).toEqual({
      law: "GG",
      prefix: "Art.",
      number: "12",
      paragraph: "1",
      sentence: "2",
      num: "",
      alt: "",
      notes: "",
    });
    expect(Object.keys(knowledge.parseCitation("§ 1 BGB")!)).toEqual(["law", "prefix", "number", "paragraph", "sentence", "num", "alt", "notes"]);
    expect(knowledge.parseCitation("§")).toBeNull();
  });
});

describe("Wissensobjekte (phase3.rs)", () => {
  it("definitions_schemas_cases_citations", async () => {
    const { ctx, db, jura, wiwi } = await setup();
    const def = knowledge.create(
      db,
      newK("definition", "Willenserklärung", jura, { text: "Äußerung eines Rechtsbindungswillens", citation: "§§ 116 ff. BGB", unbekannt: 1 }),
    );
    expect(def.data.text).toBe("Äußerung eines Rechtsbindungswillens");
    expect(def.data.unbekannt).toBeUndefined();
    expect(def.source_kind).toBe("eigen");
    // gespeichert wie serde_json: Schlüssel sortiert
    expect(db.value("SELECT data FROM knowledge WHERE id = ?1", [def.id])).toBe(
      '{"citation":"§§ 116 ff. BGB","example":"","notes":"","source":"","text":"Äußerung eines Rechtsbindungswillens"}',
    );

    const schema = knowledge.create(
      db,
      newK("schema", "Anspruch aus § 433 II BGB", jura, {
        norm: "§ 433 Abs. 2 BGB",
        items: [
          { text: "Anspruch entstanden", children: [{ text: "Vertragsschluss", children: [{ text: "Angebot" }, { text: "Annahme" }] }] },
          { text: "Anspruch nicht erloschen" },
        ],
      }),
    );
    const first = (schema.data.items as Items)[0]!;
    expect(first.id.length).toBeGreaterThan(10);
    expect(first.children[0]!.children[1]!.text).toBe("Annahme");

    // Zu tiefe Verschachtelung wird abgelehnt
    let deep: Record<string, unknown> = { text: "x" };
    for (let i = 0; i < 14; i++) deep = { text: "x", children: [deep] };
    expect(() => knowledge.create(db, newK("schema", "Tief", null, { items: [deep] }))).toThrow(/zu tief verschachtelt/);

    const kase = knowledge.create(
      db,
      newK("case", "Trierer Weinversteigerung", jura, { difficulty: 9, status: "kaputt", facts: "Handzeichen bei Versteigerung" }),
    );
    expect(kase.data.difficulty).toBe(0);
    expect(kase.data.status).toBe("offen");

    // Fundstelle: Titel wird aus den Feldern gebildet, gleiche Norm wird wiederverwendet
    const c1 = knowledge.create(db, newK("citation", "egal", null, { law: "BGB", prefix: "§", number: "433", paragraph: "2" }));
    expect(c1.title).toBe("§ 433 Abs. 2 BGB");
    const c2 = knowledge.create(db, newK("citation", "", null, { law: "BGB", prefix: "§", number: "433", paragraph: "2" }));
    expect(c2.id).toBe(c1.id);
    expect(() => knowledge.create(db, newK("citation", "", null, { law: "BGB" }))).toThrow(
      "Bitte die Paragrafen- bzw. Artikelnummer angeben.",
    );

    // Liste je Typ und Bereich (ohne Bereich = überall sichtbar)
    expect(knowledge.list(db, { type: "definition", area_id: jura })).toHaveLength(1);
    expect(knowledge.list(db, { area_id: wiwi })).toHaveLength(1);
    expect(knowledge.fields(db)).toEqual(["Zivilrecht"]);

    // Bearbeiten + Suche
    knowledge.update(db, def.id, { data: { text: "Neu: Kundgabe eines Geschäftswillens" } });
    expect(search(db, "Geschäftswillens", null, 10)[0]!.kind).toBe("definition");
    expect(search(db, "Annahme", jura, 10)[0]!.entity_id).toBe(schema.id);
    expect(search(db, "433", wiwi, 10)).toHaveLength(1);

    // Papierkorb
    knowledge.trash(db, kase.id);
    expect(search(db, "Weinversteigerung", null, 10)).toHaveLength(0);
    expect(trash.list(db).some((t) => t.item_type === "knowledge" && t.id === kase.id)).toBe(true);
    trash.restoreAny(db, "knowledge", kase.id);
    expect(search(db, "Weinversteigerung", null, 10)).toHaveLength(1);
    knowledge.trash(db, kase.id);
    await trash.purgeAny(ctx, "knowledge", kase.id);
    expect(() => knowledge.get(db, kase.id)).toThrow(CoreError);
  });

  it("prüft Formate wie serde", async () => {
    const { db } = await setup();
    const fmt = "Die Angaben haben ein unerwartetes Format.";
    expect(() => knowledge.create(db, newK("definition", "x", null, { text: 5 }))).toThrow(fmt);
    expect(() => knowledge.create(db, newK("definition", "x", null, { text: null }))).toThrow(fmt);
    expect(() => knowledge.create(db, newK("case", "x", null, { difficulty: -1 }))).toThrow(fmt);
    expect(() => knowledge.create(db, newK("case", "x", null, { solution_note_id: "kaputt" }))).toThrow("Ungültige Kennung.");
    expect(() => knowledge.create(db, { ...newK("definition", "x", null, {}), data: [] as unknown as Record<string, unknown> })).toThrow(
      "Ungültige Angaben.",
    );
    expect(() => knowledge.create(db, newK("citation", "", null, { number: "1", prefix: "Abs." }))).toThrow(/nur „§“ und „Art.“/);
    expect(() => knowledge.create(db, { ...newK("definition", "x", null, {}), source_kind: "x" as never })).toThrow(
      "Unbekannte Herkunftsangabe.",
    );
    expect(() => knowledge.create(db, newK("definition", "  ", null, {}))).toThrow("Der Titel darf nicht leer sein.");
    const k: Knowledge = knowledge.create(db, newK("definition", "Besitz", null, {}));
    expect(knowledge.update(db, k.id, { area_id: null, title: "Besitz neu" }).title).toBe("Besitz neu");
  });

  it("definition_backlinks_from_notes_schemas_and_cases", async () => {
    const { db, jura } = await setup();
    const def = knowledge.create(db, newK("definition", "Angebot", jura, { text: "empfangsbedürftige WE" }));
    const schema = knowledge.create(db, newK("schema", "Vertragsschluss", jura, {}));
    links.add(db, { source_type: "knowledge", source_id: schema.id, target_type: "knowledge", target_id: def.id, kind: "related" });
    const note = nodes.create(db, { area_id: jura, parent_id: null, kind: "note", title: "Mitschrift" });
    const content = JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Angebot", marks: [{ type: "link", attrs: { href: `studium:knowledge/${def.id}` } }] }] },
      ],
    });
    notes.save(db, note.id, content, "Angebot");
    const used = links.forEntity(db, "knowledge", def.id);
    expect(used).toHaveLength(2);
    expect(used.every((l) => l.direction === "incoming")).toBe(true);
    expect(used.some((l) => l.other_kind === "schema")).toBe(true);
    expect(used.some((l) => l.kind === "mention" && l.other_id === note.id)).toBe(true);
    // Endgültiges Löschen entfernt Verknüpfungen
    knowledge.trash(db, def.id);
    knowledge.purge(db, def.id);
    expect(links.forEntity(db, "knowledge", schema.id)).toHaveLength(0);
  });
});

function reviewState(due: string, rating: number): ReviewInput {
  return {
    rating: rating as ReviewInput["rating"],
    due,
    stability: 3.2,
    difficulty: 5.1,
    elapsed_days: 0,
    scheduled_days: 3,
    learning_steps: 0,
    reps: 1,
    lapses: 0,
    state: 2,
  };
}

describe("Karteikarten (phase3.rs)", () => {
  it("flashcards_review_and_stats", async () => {
    const { db, jura, wiwi } = await setup();
    const c = cards.create(db, { area_id: jura, node_id: null, kind: "definition", front: "Willenserklärung?", back: "Äußerung …", tags: "BGB AT" });
    expect(() => cards.create(db, { area_id: null, kind: "frage", front: " ", back: "x" })).toThrow(
      "Vorder- und Rückseite dürfen nicht leer sein.",
    );
    expect(c.state).toBe(0);
    expect(c.difficult).toBe(false);
    expect(cards.list(db, { due_only: true })).toHaveLength(1);

    const r = cards.review(db, c.id, reviewState("2099-01-01T00:00:00Z", 3));
    expect(r.reps).toBe(1);
    expect(r.due).toBe("2099-01-01T00:00:00Z");
    expect(r.last_review).not.toBeNull();
    expect(cards.list(db, { due_only: true })).toHaveLength(0);
    // „Nochmal“ markiert als schwierig
    expect(cards.review(db, c.id, reviewState("2026-01-01T00:00:00Z", 1)).difficult).toBe(true);

    // Ungültige Planungswerte werden abgelehnt
    expect(() => cards.review(db, c.id, reviewState("kein Datum", 3))).toThrow("Ungültiger Wiederholungsstand.");
    expect(() => cards.review(db, c.id, { ...reviewState("2099-01-01T00:00:00Z", 3), stability: NaN })).toThrow(
      "Ungültiger Wiederholungsstand.",
    );
    expect(() => cards.review(db, c.id, reviewState("2099-01-01T00:00:00Z", 7))).toThrow("Ungültige Bewertung.");
    // strenges RFC 3339 wie in Rust
    expect(() => cards.review(db, c.id, reviewState("2099-01-01", 3))).toThrow("Ungültiger Wiederholungsstand.");
    expect(() => cards.review(db, c.id, reviewState("1970-01-01T00:00:00Z", 3))).toThrow("Ungültiger Wiederholungsstand.");

    const st = cards.stats(db, jura, "2000-01-01T00:00:00Z");
    expect(st.total).toBe(1);
    expect(st.reviewed_today).toBe(2);
    expect(st.difficult).toBe(1);
    expect(st.retention_30d).toBe(0.5);
    expect(cards.stats(db, wiwi, "2000-01-01T00:00:00Z").total).toBe(0);

    cards.update(db, c.id, { suspended: true });
    expect(cards.stats(db, null, "2000-01-01T00:00:00Z").due_now).toBe(0);
    expect(search(db, "Willenserklärung", null, 5)[0]!.entity_type).toBe("card");
  });

  it("prüft Kartenart, Quelle und Papierkorb", async () => {
    const { db } = await setup();
    expect(() => cards.create(db, { kind: "x" as never, front: "a", back: "b" })).toThrow("Unbekannte Kartenart.");
    expect(() => cards.create(db, { front: "a", back: "b", source_type: "evil" as never })).toThrow("Unbekannte Quelle.");
    expect(() => cards.create(db, { front: "a", back: "b", source_type: "node" })).toThrow("Ungültige Kennung.");
    const c = cards.create(db, { front: "a\u0007\n", back: "b" });
    expect(c.kind).toBe("frage");
    expect(c.front).toBe("a");
    expect(() => cards.purge(db, c.id)).toThrow("Nur Karten im Papierkorb können endgültig gelöscht werden.");
    cards.trash(db, c.id);
    expect(() => cards.review(db, c.id, reviewState("2099-01-01T00:00:00Z", 3))).toThrow("Die Karte liegt im Papierkorb.");
    cards.purge(db, c.id);
    expect(() => cards.get(db, c.id)).toThrow("Karteikarte nicht gefunden.");
  });

  it("rebuild_index_covers_all_entities", async () => {
    const { db } = await setup();
    knowledge.create(db, newK("definition", "Besitz", null, { text: "tatsächliche Sachherrschaft" }));
    cards.create(db, { area_id: null, node_id: null, kind: "frage", front: "Eigentum vs. Besitz", back: "rechtliche Herrschaft", tags: "" });
    planning.taskCreate(db, { area_id: null, node_id: null, kind: "aufgabe", title: "Sachenrecht wiederholen", notes: "", due_date: null });
    rebuild(db);
    expect(search(db, "Sachherrschaft", null, 5)).toHaveLength(1);
    expect(search(db, "Eigentum", null, 5)).toHaveLength(1);
    expect(search(db, "Sachenrecht", null, 5)).toHaveLength(1);
  });
});
