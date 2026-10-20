// End-to-End-Test: Folie neben Mitschrift und Handschrift (Apple Pencil, simuliert)
// auf PDF-Seiten – iPad quer (nebeneinander) und hochkant (untereinander).
//
// Aufruf: node tests/e2e-web/folien-e2e.mjs   (nach npm run build:web)
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "../..");
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const OUT = process.env.E2E_OUT ?? path.join(ROOT, "target/e2e-web");
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4183;
const PDF = path.join(ROOT, "tests/e2e/fixtures/folien.pdf");

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  – " + extra : ""}`);
  if (!ok && process.env.GITHUB_ACTIONS) console.log(`::error::${name} – ${String(extra).replace(/\n/g, " ").slice(0, 600)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn("npx", ["vite", "preview", "--mode", "web", "--outDir", "dist-web", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
for (let i = 0; i < 50; i++) {
  try {
    await fetch(`http://127.0.0.1:${PORT}/`);
    break;
  } catch {
    await sleep(200);
  }
}
const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const call = (name, ...args) => page.evaluate(([n, a]) => window.__STUDIUM_API__[n](...a), [name, args]);

/** Strich mit Stift/Finger/Maus auf eine Fläche (Punkte relativ zur Fläche). */
async function stroke(locator, type, id, pts) {
  await locator.evaluate(
    (c, { type, id, pts }) => {
      const r = c.getBoundingClientRect();
      const ev = (name, [x, y]) =>
        c.dispatchEvent(new PointerEvent(name, { bubbles: true, cancelable: true, pointerId: id, pointerType: type, isPrimary: true, clientX: r.left + x, clientY: r.top + y, pressure: 0.6, buttons: 1 }));
      ev("pointerdown", pts[0]);
      for (const p of pts.slice(1)) ev("pointermove", p);
      ev("pointerup", pts[pts.length - 1]);
    },
    { type, id, pts },
  );
}
const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1)]);
const inkOf = async (docId) => (await call("annotationsList", docId)).filter((a) => a.kind === "ink");
const strokesOf = (a) => (a?.ink ?? "").split("\n").slice(1).filter(Boolean);
async function waitFor(fn, ms = 6000) {
  const t = Date.now();
  for (;;) {
    const v = await fn();
    if (v || Date.now() - t > ms) return v;
    await sleep(150);
  }
}

try {
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  const ids = await page.evaluate(async () => {
    const api = window.__STUDIUM_API__;
    const area = (await api.areasList())[0];
    const c = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "BGB AT" });
    const n = await api.nodeCreate({ area_id: area.id, parent_id: c.id, kind: "note", title: "1. Vorlesung", meta: { noteType: "vorlesung", number: 1 } });
    return { course: c.id, note: n.id };
  });
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });

  // Folien in die Veranstaltung importieren (echte Dateiauswahl)
  await page.locator(".tree-row", { hasText: "BGB AT" }).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Dokumente importieren" }).first().click()]);
  await chooser.setFiles(PDF);
  await page.getByRole("dialog").getByRole("button", { name: "Importieren" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const doc = await waitFor(async () => (await call("documentsList", { kind: "all" }))[0]);
  check("Folien importiert", !!doc?.id);

  // 1. Mitschrift öffnen → „Folien“ → Auswahl zeigt die Unterlagen der Veranstaltung
  check("Unterlagen-Liste: Titel lesbar trotz Kontextbereich", (await page.locator(".doc-row > .grow").first().evaluate((e) => e.clientWidth)) >= 100);
  await page.locator("main.primary").getByText("1. Vorlesung").click();
  await page.locator(".ProseMirror").waitFor();
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Willenserklärung: ");
  await page.getByRole("button", { name: "Folien", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Folien auswählen" });
  await picker.waitFor();
  await picker.getByText("Unterlagen · BGB AT").waitFor();
  check("Auswahl: Unterlagen der Veranstaltung zuerst", /unterlagen · bgb at/i.test(await picker.innerText()) && (await picker.locator(".slide-pick").count()) === 1, String(await picker.locator(".slide-pick").allInnerTexts()));
  await picker.locator(".slide-pick").first().click();
  const side = page.locator("section.secondary");
  await side.locator(".pdf-page canvas").first().waitFor({ timeout: 15000 });
  const [pb, sb] = [await page.locator("main.primary").boundingBox(), await side.boundingBox()];
  check("iPad quer: Folie rechts neben der Mitschrift", sb.x > pb.x + 300 && Math.abs(sb.y - pb.y) < 4, JSON.stringify({ pb, sb }));
  await shot("folien-1-nebeneinander");

  // 2. Stiftmodus in der Folie
  await side.getByRole("button", { name: "Mit dem Stift schreiben" }).click();
  const bar = side.getByRole("toolbar", { name: "Stiftwerkzeuge" });
  await bar.waitFor();
  const surface = side.locator(".pdf-page[data-page='1'] .ink-live");
  await surface.waitFor();
  const ta = await surface.evaluate((c) => getComputedStyle(c).touchAction);
  check("Stiftfläche: Finger scrollt weiter (touch-action)", ta !== "none" && ta !== "auto", ta);
  await stroke(surface, "pen", 11, line(40, 60, 260, 90));
  await stroke(surface, "touch", 12, line(40, 160, 260, 160)); // aufgelegte Hand / Finger zum Scrollen
  let ink = await waitFor(async () => (await inkOf(doc.id))[0]);
  check("Stiftstrich gespeichert, Finger malt nicht", strokesOf(ink).length === 1 && strokesOf(ink)[0].startsWith("pen|#1d2433|"), strokesOf(ink).map((l) => l.slice(0, 20)).join(" / "));
  check("Handschrift an der Seite (Breite 2000 = Seitenbreite)", /^v1\|2000\|\d+/.test(ink?.ink ?? "") && ink.page === 1);
  await bar.getByRole("button", { name: "Textmarker" }).click();
  await bar.getByRole("button", { name: "Farbe #8ce99a" }).click();
  await stroke(surface, "pen", 13, line(40, 120, 260, 120));
  await waitFor(async () => strokesOf((await inkOf(doc.id))[0]).length === 2);
  ink = (await inkOf(doc.id))[0];
  check("Textmarker grün", strokesOf(ink)[1]?.startsWith("marker|#8ce99a|"));
  // Radierer entfernt den Textmarker-Strich
  await bar.getByRole("button", { name: "Radierer" }).click();
  await stroke(surface, "pen", 14, line(150, 110, 150, 130, 4));
  await waitFor(async () => strokesOf((await inkOf(doc.id))[0]).length === 1);
  check("Radierer entfernt den Strich", strokesOf((await inkOf(doc.id))[0]).length === 1);
  await bar.getByRole("button", { name: "Rückgängig" }).click();
  await waitFor(async () => strokesOf((await inkOf(doc.id))[0]).length === 2);
  check("Rückgängig holt ihn zurück", strokesOf((await inkOf(doc.id))[0]).length === 2);
  // Finger zeichnen einschalten
  await bar.getByRole("button", { name: /Finger zeichnen/ }).click();
  await bar.getByRole("button", { name: "Stift" , exact: true }).click();
  await stroke(surface, "touch", 15, line(40, 200, 200, 220));
  await waitFor(async () => strokesOf((await inkOf(doc.id))[0]).length === 3);
  check("„Finger zeichnen“: Finger schreibt", strokesOf((await inkOf(doc.id))[0]).length === 3);
  check("„Finger zeichnen“: Fläche blockiert Scrollen", (await surface.evaluate((c) => getComputedStyle(c).touchAction)) === "none");
  await bar.getByRole("button", { name: /Finger zeichnen/ }).click();
  await shot("folien-2-handschrift");

  // 3. Folie samt Handschrift in die Mitschrift übernehmen
  await side.getByRole("button", { name: "Folie übernehmen" }).click();
  await page.waitForFunction(() => document.querySelector(".ProseMirror img")?.naturalWidth > 0, null, { timeout: 10000 });
  const imgAlt = await page.locator(".ProseMirror img").first().getAttribute("alt");
  check("Folie als Bild in der Mitschrift", /^Folie 1 – /.test(imgAlt ?? ""), imgAlt);
  const cap = page.locator(".ProseMirror a", { hasText: "Folie 1 ·" });
  check("Bildunterschrift verweist auf die Seite", (await cap.getAttribute("href")) === `studium:document/${doc.id}#page=1`);
  await page.keyboard.type("Weiter mitschreiben");
  const text = await page.locator(".ProseMirror").innerText();
  check("Cursor steht danach unter der Folie", /Folie 1 ·[^\n]*\n+Weiter mitschreiben/.test(text), text.slice(-80));
  const links = await call("linksFor", "document", doc.id);
  check("Seite 1 mit der Mitschrift verknüpft", links.some((l) => l.other_id === ids.note && l.anchor?.page === 1));
  // Bild enthält die Handschrift (dunkle Pixel am Strich)
  const inked = await page.locator(".ProseMirror img").first().evaluate((img) => {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const pageEl = document.querySelector("section.secondary .pdf-page[data-page='1']");
    const k = img.naturalWidth / pageEl.clientWidth;
    const d = g.getImageData(Math.round(150 * k), Math.round(75 * k), 1, 1).data;
    return d[0] + d[1] + d[2];
  });
  check("Übernommene Folie enthält die Handschrift", inked < 300, String(inked));

  // 4. Seite merken: blättern, schließen, wieder öffnen
  await side.getByRole("button", { name: "Nächste Seite" }).click();
  await waitFor(async () => (await call("nodeGet", ids.note)).node.meta?.slides?.page === 2, 5000);
  const meta = (await call("nodeGet", ids.note)).node.meta;
  check("Notiz merkt Foliensatz und Seite", meta?.slides?.document_id === doc.id && meta.slides.page === 2, JSON.stringify(meta?.slides));
  await page.getByRole("button", { name: "Folien", exact: true }).click();
  await side.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Folien", exact: true }).click();
  await side.locator(".pdf-page canvas").first().waitFor({ timeout: 15000 });
  check("„Folien“ öffnet wieder auf Seite 2", (await side.locator(".pdf-page-input").inputValue()) === "2");

  // 5. iPad hochkant: Folie oben, Mitschrift darunter
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.waitForFunction(() => document.querySelector(".workspace")?.classList.contains("is-stacked"));
  const [pb2, sb2] = [await page.locator("main.primary").boundingBox(), await side.boundingBox()];
  check("iPad hochkant: Folie über der Mitschrift", sb2.y + sb2.height <= pb2.y + 8 && Math.abs(sb2.x - pb2.x) < 4, JSON.stringify({ pb2, sb2 }));
  const sep = page.getByRole("separator", { name: "Höhe der geteilten Ansicht" });
  const sepBox = await sep.boundingBox();
  await page.mouse.move(sepBox.x + sepBox.width / 2, sepBox.y + 2);
  await page.mouse.down();
  await page.mouse.move(sepBox.x + sepBox.width / 2, sepBox.y + 122, { steps: 4 });
  await page.mouse.up();
  const sb3 = await side.boundingBox();
  check("Trenner verändert die Höhe der Folie", Math.abs(sb3.height - sb2.height - 120) < 12, `${sb2.height} → ${sb3.height}`);
  await shot("folien-3-untereinander");
  await side.getByRole("button", { name: "Folie neben die Mitschrift" }).click();
  await page.waitForFunction(() => !document.querySelector(".workspace")?.classList.contains("is-stacked"));
  check("Umschalten auf nebeneinander", true);
  await side.getByRole("button", { name: "Folie über die Mitschrift" }).click();
  await page.waitForFunction(() => document.querySelector(".workspace")?.classList.contains("is-stacked"));
  check("Zurück auf automatisch (hochkant untereinander)", !!(await waitFor(async () => (await call("settingsAll"))["ui.splitLayout"] === "auto")));

  // 6. Nach Neuladen: Handschrift in der Vollansicht, Liste der Markierungen
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.locator(".tree-row", { hasText: "BGB AT" }).click();
  await page.locator(".doc-row").first().click();
  await page.locator(".docview .pdf-page[data-page='1'] .ink-canvas").first().waitFor({ timeout: 15000 });
  const painted = await page.locator(".docview .pdf-page[data-page='1'] .ink-canvas").first().evaluate((c) => {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  check("Handschrift nach Neuladen sichtbar", painted > 200, String(painted));
  await page.getByRole("button", { name: "Seitenübersicht" }).click();
  await page.getByRole("button", { name: /^Markierungen/ }).click();
  check("Markierungen-Liste zeigt „Handschrift“", (await page.locator(".pdf-anno-item", { hasText: "Handschrift" }).count()) === 1);

  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Ablauf ohne Ausnahme", false, e.stack ?? String(e));
  await shot("folien-fehler").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
process.exit(failed.length ? 1 : 0);
