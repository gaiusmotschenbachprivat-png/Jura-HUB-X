// End-to-End-Test Phase 3 an der echten App: Wissensobjekte, Schemata, Karteikarten
// mit FSRS, Planung, PDF-Markierungen und Lesezeichen, Bilder und Formeln.
import fs from "node:fs";
import path from "node:path";
import { Builder, By, Key, until } from "selenium-webdriver";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const WORK = process.env.E2E_WORK;
const APP = process.env.E2E_APP ?? path.resolve(HERE, "../../target/debug/studium-os");
const PDF = path.join(HERE, "fixtures", "folien.pdf");
const shots = path.join(WORK, "shots3");
fs.mkdirSync(shots, { recursive: true });

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  – " + extra : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const d = await new Builder()
  .usingServer("http://127.0.0.1:4444/")
  .withCapabilities({ browserName: "wry", "tauri:options": { application: APP } })
  .build();
await d.manage().setTimeouts({ implicit: 4000 });
const shot = async (name) => fs.writeFileSync(path.join(shots, name + ".png"), await d.takeScreenshot(), "base64");
const invoke = (cmd, args = {}) =>
  d.executeAsyncScript(
    `const [cmd, args, done] = arguments;
     window.__TAURI_INTERNALS__.invoke(cmd, args).then(r => done({ ok: r ?? null }), e => done({ err: e }));`,
    cmd,
    args,
  );
const nav = async (label) => {
  await d.findElement(By.xpath(`//button[contains(@class,'nav-item')][.//span[normalize-space()='${label}']]`)).click();
  await sleep(500);
};

try {
  // Einrichtung (frischer Datenordner)
  await d.wait(until.elementLocated(By.xpath("//button[normalize-space()='Loslegen']")), 15000);
  await d.findElement(By.xpath("//button[normalize-space()='Loslegen']")).click();
  await d.wait(until.elementLocated(By.css(".area-tab")), 10000);
  (await d.findElements(By.css(".area-tab")))[0].click();
  await sleep(400);
  const areas = (await invoke("areas_list")).ok;
  const jura = areas[0].id;

  // 1. Definition über die Oberfläche anlegen
  await nav("Glossar");
  await d.findElement(By.xpath("//button[contains(.,'Begriff')]")).click();
  const term = await d.wait(until.elementLocated(By.css("#g-term")), 5000);
  await term.sendKeys("willenserklaerung");
  await d.findElement(By.css("#g-def")).sendKeys("aeusserung eines rechtsbindungswillens");
  await d.findElement(By.xpath("//button[normalize-space()='Speichern']")).click();
  await sleep(1500);
  let defs = (await invoke("knowledge_list", { filter: { type: "definition" } })).ok;
  check("Definition wird angelegt und automatisch gespeichert", defs.length === 1 && defs[0].data.text.includes("rechtsbindungswillens"), defs[0]?.title);
  const def = defs[0];

  // 2. Prüfungsschema mit Gliederung (Enter, Tab)
  await nav("Prüfungsschemata");
  await d.findElement(By.xpath("//button[contains(.,'Prüfungsschema anlegen')]")).click();
  const first = await d.wait(until.elementLocated(By.css(".schema-input")), 5000);
  await first.click();
  await first.sendKeys("anspruch entstanden");
  await first.sendKeys(Key.ENTER);
  await sleep(200);
  let active = await d.switchTo().activeElement();
  await active.sendKeys("angebot");
  await active.sendKeys(Key.TAB);
  await sleep(200);
  active = await d.switchTo().activeElement();
  await active.sendKeys(Key.ENTER);
  await sleep(200);
  active = await d.switchTo().activeElement();
  await active.sendKeys("annahme");
  await sleep(1500);
  const nums = await d.executeScript("return [...document.querySelectorAll('.schema-num')].map(e => e.textContent)");
  check("Schema-Gliederung A. / I. / II.", JSON.stringify(nums) === JSON.stringify(["A.", "I.", "II."]), JSON.stringify(nums));
  const schemas = (await invoke("knowledge_list", { filter: { type: "schema" } })).ok;
  const items = schemas[0]?.data.items ?? [];
  check("Verschachtelte Schemapunkte gespeichert", items.length === 1 && items[0].children.length === 2 && items[0].children[1].text === "annahme");
  await shot("01-schema");

  // 3. Fundstelle mit Schnelleingabe
  await nav("Fundstellen");
  await d.findElement(By.xpath("//button[contains(.,'Neue Fundstelle')]")).click();
  const quick = await d.wait(until.elementLocated(By.xpath("//input[contains(@placeholder,'Schnelleingabe')]")), 5000);
  // „§“ ist über WebDriver nicht zuverlässig tippbar: Wert direkt setzen
  await d.executeScript(
    "const i = arguments[0]; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '§ 823 Abs. 1 BGB'); i.dispatchEvent(new Event('input', { bubbles: true }));",
    quick,
  );
  await quick.sendKeys(Key.ENTER);
  await sleep(1500);
  const cits = (await invoke("knowledge_list", { filter: { type: "citation" } })).ok;
  check("Fundstelle aus Schnelleingabe: § 823 Abs. 1 BGB", cits.some((c) => c.title === "§ 823 Abs. 1 BGB"), cits.map((c) => c.title).join(", "));

  // 4. Definition aus einer Notiz verlinken → Rückverweis
  const note = (await invoke("node_create", { input: { area_id: jura, parent_id: null, kind: "note", title: "mitschrift wille" } })).ok;
  const content = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Siehe Definition", marks: [{ type: "link", attrs: { href: `studium:knowledge/${def.id}` } }] }, { type: "inlineMath", attrs: { latex: "a^2+b^2=c^2" } }] },
    ],
  };
  // Bild speichern (1×1-PNG) und einfügen
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64");
  const sha = await d.executeAsyncScript(
    `const [b64, done] = arguments; const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
     window.__TAURI_INTERNALS__.invoke('image_store', bytes).then(done, e => done('ERR ' + JSON.stringify(e)));`,
    png.toString("base64"),
  );
  check("Bild wird im Dokumentenspeicher abgelegt", /^[0-9a-f]{64}$/.test(sha), sha);
  const evil = await d.executeAsyncScript(
    `const done = arguments[0]; window.__TAURI_INTERNALS__.invoke('image_store', new TextEncoder().encode('<svg onload=alert(1)>')).then(() => done('ok'), e => done(e.code));`,
  );
  check("Nur echte Bilder werden angenommen (kein SVG/HTML)", evil === "invalid", evil);
  content.content.push({ type: "image", attrs: { src: `studium:asset/${sha}`, alt: "punkt" } });
  await invoke("note_save", { id: note.id, contentJson: JSON.stringify(content), plainText: "Siehe Definition a^2+b^2=c^2" });

  await d.executeScript("window.__open = null");
  await d.findElement(By.css("body")).sendKeys(Key.chord(Key.CONTROL, "k"));
  const pal = await d.wait(until.elementLocated(By.css(".palette-input input")), 4000);
  await pal.sendKeys("willenserklaerung", Key.ENTER);
  await d.wait(until.elementLocated(By.css("textarea.kn-def")), 5000);
  await sleep(1000);
  const back = await d.findElements(By.xpath("//aside[contains(@class,'context')]//button[contains(.,'mitschrift wille')]"));
  check("Definition zeigt Rückverweis auf die Notiz („Verwendet in“)", back.length === 1);
  await shot("02-definition");

  // 5. Notiz zeigt Formel und Bild
  await back[0].click();
  await d.wait(until.elementLocated(By.css(".ProseMirror")), 5000);
  await sleep(1500);
  const rendered = await d.executeScript(`return {
    katex: !!document.querySelector('.ProseMirror .katex'),
    img: (() => { const i = document.querySelector('.ProseMirror .asset-image img'); return i ? i.naturalWidth : -1 })()
  }`);
  check("Formel wird mit KaTeX gesetzt", rendered.katex);
  check("Bild aus dem Speicher wird angezeigt", rendered.img === 1, JSON.stringify(rendered));

  // 6. Karteikarte aus Definition, Lernsitzung mit Bewertung
  const card = (await invoke("card_create", { input: { area_id: jura, kind: "definition", front: "willenserklaerung", back: "aeusserung …", source_type: "knowledge", source_id: def.id } })).ok;
  check("Karteikarte angelegt", !!card?.id);
  await nav("Karteikarten");
  await d.findElement(By.xpath("//button[contains(.,'fällige Karten lernen')]")).click();
  await d.wait(until.elementLocated(By.css(".fc-front")), 5000);
  await d.findElement(By.css("body")).sendKeys(" ");
  await d.wait(until.elementLocated(By.css(".fc-rate.r3")), 3000);
  await shot("03-learn");
  await d.findElement(By.css("body")).sendKeys("3");
  await sleep(1200);
  const after = (await invoke("cards_list", { filter: {} })).ok.find((c) => c.id === card.id);
  check("Bewertung „Gut“ plant die Karte mit FSRS neu", after.reps === 1 && Date.parse(after.due) > Date.now() && after.stability > 0, `fällig ${after.due}, Stabilität ${after.stability?.toFixed?.(2)}`);
  const stats = (await invoke("card_stats", { areaId: jura, dayStart: new Date(Date.now() - 3600e3).toISOString() })).ok;
  check("Lernstatistik zählt die Wiederholung", stats.reviewed_today === 1, JSON.stringify(stats));

  // 7. Aufgabe über die Planungsansicht, Prüfung, Lernübersicht
  await nav("Aufgaben & Prüfungen");
  const taskInput = await d.findElement(By.xpath("//input[contains(@placeholder,'Neue Aufgabe')]"));
  await taskInput.sendKeys("fall 3 loesen", Key.ENTER);
  await sleep(800);
  const tasks = (await invoke("tasks_list", { filter: {} })).ok;
  check("Aufgabe über die Oberfläche angelegt", tasks.some((t) => t.title === "fall 3 loesen"));
  const inTen = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  await invoke("exam_save", { id: null, input: { area_id: jura, title: "klausur bgb at", date: inTen } });
  await nav("Übersicht");
  let overview = "";
  for (let i = 0; i < 20; i++) {
    overview = await d.executeScript("return document.querySelector('.learn-card')?.textContent ?? ''");
    if (overview.includes("klausur bgb at") && overview.includes("fall 3 loesen")) break;
    await sleep(300);
  }
  check("Lernübersicht zeigt Prüfung und offene Aufgabe", overview.includes("klausur bgb at") && overview.includes("fall 3 loesen"), overview.slice(0, 160));
  await shot("04-dashboard");

  // 8. PDF: Text markieren, Lesezeichen, Suche in Markierungen
  const imp = (await invoke("documents_import", { paths: [PDF], nodeId: null, docType: "folien" })).ok;
  const docId = imp[0].document.id;
  await d.navigate().refresh();
  await d.wait(until.elementLocated(By.css(".area-tab")), 10000);
  for (let i = 0; i < 30; i++) {
    if ((await invoke("document_get", { id: docId })).ok.document.text_status !== "pending") break;
    await sleep(500);
  }
  await d.findElement(By.css("body")).sendKeys(Key.chord(Key.CONTROL, "k"));
  const pal2 = await d.wait(until.elementLocated(By.css(".palette-input input")), 4000);
  await pal2.sendKeys("Weinversteigerung", Key.ENTER);
  await d.wait(until.elementLocated(By.css(".pdf-page[data-page='2'] .textLayer span")), 10000);
  await sleep(1500);
  // Text auf Seite 2 auswählen und loslassen
  await d.executeScript(`
    const spans = [...document.querySelectorAll(".pdf-page[data-page='2'] .textLayer span")].filter(s => s.textContent.includes('Inhaltsirrtum'));
    const s = spans[spans.length - 1];
    const r = document.createRange(); r.selectNodeContents(s);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    const b = s.getBoundingClientRect();
    document.querySelector('.pdf-scroll').dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: b.right, clientY: b.bottom }));
  `);
  const dot = await d.wait(until.elementLocated(By.css(".float-bar .color-dot")), 4000);
  await dot.click();
  await sleep(1000);
  let annos = (await invoke("annotations_list", { documentId: docId })).ok;
  const hl = annos.find((a) => a.kind === "highlight");
  check("Markierung aus Textauswahl gespeichert (Seite 2, Position relativ)", !!hl && hl.page === 2 && hl.rects.length >= 1 && hl.rects.every((r) => r.x >= 0 && r.x + r.w <= 1.01), JSON.stringify(hl?.rects?.[0]));
  const overlays = await d.findElements(By.css(".pdf-page[data-page='2'] .pdf-hl"));
  check("Markierung wird auf der Seite angezeigt", overlays.length >= 1);
  await invoke("annotation_update", { id: hl.id, patch: { comment: "klausurwissen trierer fall" } });
  const toggle = await d.findElement(By.xpath("//button[contains(@aria-label,'Lesezeichen')]"));
  await toggle.click();
  await sleep(600);
  annos = (await invoke("annotations_list", { documentId: docId })).ok;
  check("Lesezeichen gesetzt", annos.some((a) => a.kind === "bookmark"));
  const hits = (await invoke("search", { query: "klausurwissen", areaId: null })).ok;
  check("Kommentare zu Markierungen sind durchsuchbar (mit Seite)", hits.some((h) => h.entity_type === "annotation" && h.page === 2 && h.target_id === docId));
  await d.findElement(By.xpath("//button[@aria-label='Seitenübersicht']")).click();
  await d.findElement(By.xpath("//div[contains(@class,'pdf-side-tabs')]/button[contains(.,'Markierungen')]")).click();
  await sleep(500);
  const listed = await d.findElements(By.css(".pdf-anno-item"));
  check("Seitenleiste listet Lesezeichen und Markierungen", listed.length === 2);
  await shot("05-pdf-annotations");

  // 9. Papierkorb für Wissensobjekte
  await invoke("knowledge_trash", { id: def.id });
  const trash = (await invoke("trash_list")).ok;
  check("Definition landet im Papierkorb", trash.some((t) => t.item_type === "knowledge" && t.id === def.id));
  await invoke("trash_restore", { itemType: "knowledge", id: def.id });
  check("und lässt sich wiederherstellen", (await invoke("knowledge_get", { id: def.id })).ok.deleted_at === null);
} catch (e) {
  console.log("ABBRUCH:", e.message);
  try {
    await shot("zz-error");
  } catch {}
  results.push({ name: "Ablauf ohne Abbruch", ok: false });
} finally {
  await d.quit().catch(() => {});
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
process.exit(failed.length ? 1 : 0);
