import type { Backend } from "./backend";

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const h = (level: number, text: string) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });

/** Beispieldaten nur für die Browser-Vorschau (`?demo`). Deutlich als Beispiel benannt. */
export async function seedDemo(b: Backend) {
  const jura = await b.areaCreate("Rechtswissenschaften", "#2f4a8a");
  const rw = await b.areaCreate("Recht & Wirtschaft", "#2e7d5b");
  await b.areaCreate("WiWiZ", "#9a5b13");
  const ws = await b.nodeCreate({ area_id: jura.id, parent_id: null, kind: "semester", title: "Beispiel-Semester WS 2026/27" });
  const bgb = await b.nodeCreate({
    area_id: jura.id,
    parent_id: ws.id,
    kind: "course",
    title: "BGB AT (Beispiel)",
    meta: { lecturer: "Beispiel-Dozent", weekday: "Montag", time: "10:15–11:45", room: "Hörsaal H 24" },
  });
  const t1 = await b.nodeCreate({ area_id: jura.id, parent_id: bgb.id, kind: "session", title: "Termin 1: Willenserklärung" });
  await b.nodeCreate({ area_id: jura.id, parent_id: bgb.id, kind: "session", title: "Termin 2: Vertragsschluss" });
  await b.nodeCreate({ area_id: jura.id, parent_id: bgb.id, kind: "session", title: "Termin 3: Anfechtung" });
  const doc = {
    type: "doc",
    content: [
      h(1, "Willenserklärung"),
      p("Beispielinhalt der Browser-Vorschau. Eigene Mitschriften erscheinen hier."),
      h(2, "Objektiver Tatbestand"),
      p("Äußeres Verhalten, das aus Sicht eines objektiven Empfängers auf einen Rechtsbindungswillen schließen lässt."),
      h(2, "Subjektiver Tatbestand"),
      { type: "bulletList", content: ["Handlungswille", "Erklärungsbewusstsein", "Geschäftswille"].map((t) => ({ type: "listItem", content: [p(t)] })) },
    ],
  };
  await b.nodeCreate({
    area_id: jura.id,
    parent_id: t1.id,
    kind: "note",
    title: "Mitschrift Willenserklärung",
    content_json: JSON.stringify(doc),
    plain_text: "Willenserklärung Objektiver Tatbestand Subjektiver Tatbestand Handlungswille Erklärungsbewusstsein Geschäftswille",
  });
  const gesr = await b.nodeCreate({ area_id: rw.id, parent_id: null, kind: "course", title: "Gesellschaftsrecht (Beispiel)" });
  await b.nodeAreaRefAdd(gesr.id, jura.id);
}
