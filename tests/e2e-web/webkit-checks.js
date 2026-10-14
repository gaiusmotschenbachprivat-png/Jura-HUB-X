// Prüfungen, die im Browser (WebKit) ausgeführt werden. Wird von webkit-run.py
// als Funktionsrumpf ausgeführt; `phase` ist 1 (vor dem Neuladen) oder 2 (danach).
// Liefert eine Liste { name, ok, extra }.
const out = [];
const check = (name, ok, extra = "") => out.push({ name, ok: !!ok, extra: String(extra ?? "") });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, ms = 20000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* weiter */
    }
    await sleep(200);
  }
  return null;
};
const api = await wait(() => window.__STUDIUM_API__);
check("App startet in WebKit und stellt die Schnittstelle bereit", !!api);
if (!api) return out;
try {
  await api.ready;
  check("Datenspeicher startet in WebKit", true, (await api.appInfo()).data_dir);
} catch (e) {
  check("Datenspeicher startet in WebKit", false, JSON.stringify(e));
  return out;
}

if (phase === 1) {
  const btn = await wait(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Loslegen"));
  btn?.click();
  const areas = await wait(async () => {
    const a = await api.areasList();
    return a.length === 3 ? a : null;
  });
  check("Ersteinrichtung über die Oberfläche", !!areas);
  const area = areas[0];
  const course = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "BGB AT" });
  const note = await api.nodeCreate({ area_id: area.id, parent_id: course.id, kind: "note", title: "Anfechtung" });
  const doc = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Anfechtung nach § 119 BGB – Gestaltungsrecht" }] }] });
  await api.noteSave(note.id, doc, "Anfechtung nach § 119 BGB – Gestaltungsrecht");
  const hits = await api.search("gestaltungsr", null);
  check("Volltextsuche (FTS5) findet die Notiz", hits.length === 1 && hits[0].path === "BGB AT", JSON.stringify(hits.map((h) => h.path)));
  check("Umlaute/Diakritika in der Suche", (await api.search("Anfechtung 119", null)).length === 1);

  // PDF-Import aus einer Datei (wie aus der Dateiauswahl) und Textauslesen mit pdf.js
  const pdf = await (await fetch(`./__fixture/folien.pdf`)).blob();
  const out1 = await api.__importBlob(new File([pdf], "folien.pdf", { type: "application/pdf" }), course.id);
  check("PDF-Import in den Dokumentenspeicher", out1?.[0]?.document?.file_present === true, JSON.stringify(out1?.[0]?.error));
  const id = out1?.[0]?.document?.id;
  const st = await wait(async () => ((await api.documentGet(id)).document.text_status !== "pending" ? (await api.documentGet(id)).document.text_status : null), 30000);
  check("PDF-Text wird in WebKit ausgelesen (pdf.js)", st === "ok", st);
  const pageHits = await api.search("Weinversteigerung", null);
  check("Suche findet PDF-Text mit Seite 2", pageHits.some((h) => h.page === 2));
  const bytes = await api.documentBytes(id);
  check("Original-PDF unverändert lesbar", bytes.length === pdf.size);

  // Bild im Editor speichern
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
  const sha = await api.imageStore(png);
  check("Bild speichern und laden", (await api.imageBytes(sha)).length === png.length);

  // Wissen und Karteikarten
  const def = await api.knowledgeCreate({ type: "definition", title: "Willenserklärung", data: { definition: "Äußerung eines Rechtsfolgewillens" } });
  const card = await api.cardCreate({ front: def.title, back: "Äußerung eines Rechtsfolgewillens", kind: "definition", source_type: "knowledge", source_id: def.id });
  check("Definition und Karteikarte anlegen", !!card.id);

  // Backup erstellen, im App-Speicher prüfen
  const info = await api.backupCreate();
  check("Backup erstellen und prüfen (WebKit)", info.file_count === 2 && info.size > 1000, `${info.file_count} Dateien`);
  const file = await api.webBackups.file(info.path);
  const rep = await api.__verifyBlob(file);
  check("Backup-Datei aus dem App-Speicher ist gültig", rep.ok, rep.problems.join("; "));
  window.__phase1 = { noteId: note.id, docId: id, backup: info.path, cardId: card.id };
  localStorage.setItem("e2e", JSON.stringify(window.__phase1));
  await api.noteSave(note.id, JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Versehentlich überschrieben" }] }] }), "x");
  return out;
}

// Phase 2: nach dem Neuladen
const p1 = JSON.parse(localStorage.getItem("e2e") || "{}");
const n = await api.noteGet(p1.noteId);
check("Nach Neuladen: Daten sind dauerhaft gespeichert", n.content_json.includes("Versehentlich"));
check("Nach Neuladen: Dokument vorhanden", (await api.documentGet(p1.docId)).document.file_present === true);
const res = await api.backupRestore(p1.backup);
check("Wiederherstellung aus Backup (WebKit)", !!res.previous_state_dir, res.previous_state_dir);
const back = await api.noteGet(p1.noteId);
check("Notizinhalt aus dem Backup ist zurück", back.content_json.includes("Gestaltungsrecht") && !back.content_json.includes("Versehentlich"));
check("Dokument nach Wiederherstellung vorhanden", (await api.documentGet(p1.docId)).document.file_present === true);
check("Suche nach Wiederherstellung neu aufgebaut", (await api.search("Weinversteigerung", null)).length >= 1);
const cards = await api.cardsList({});
check("Karteikarten nach Wiederherstellung vorhanden", cards.some((c) => c.id === p1.cardId));
const bad = await api.__verifyBlob(new Blob([new Uint8Array(500)]));
check("Beschädigte Datei wird als Backup abgelehnt", bad.ok === false);
const net = await fetch("https://example.org").then(
  () => "erreicht",
  () => "blockiert",
);
check("Netzwerkzugriff auf fremde Server blockiert (CSP)", net === "blockiert", net);
return out;
