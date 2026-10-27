// End-to-End-Test: Text auf Folien markieren (über den Text ziehen, an Wörtern einrasten).
// iPad quer.
//
// Aufruf: node tests/e2e-web/markieren-e2e.mjs   (nach npm run build:web)
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
const PORT = 4193;

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
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true, permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const call = (name, ...args) => page.evaluate(([n, a]) => window.__STUDIUM_API__[n](...a), [name, args]);

async function waitFor(fn, ms = 6000) {
  const t = Date.now();
  for (;;) {
    const v = await fn();
    if (v || Date.now() - t > ms) return v;
    await sleep(150);
  }
}

const PDF = path.join(ROOT, "tests/e2e/fixtures/folien.pdf");
const highlights = async (docId) => (await call("annotationsList", docId)).filter((a) => a.kind === "highlight");

try {
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.evaluate(async () => {
    const api = window.__STUDIUM_API__;
    const area = (await api.areasList())[0];
    const c = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "BGB AT" });
    await api.nodeCreate({ area_id: area.id, parent_id: c.id, kind: "note", title: "3. Vorlesung" });
  });
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.locator(".tree-row", { hasText: "BGB AT" }).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Dokumente importieren" }).first().click()]);
  await chooser.setFiles(PDF);
  await page.getByRole("dialog").getByRole("button", { name: "Importieren" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const doc = await waitFor(async () => (await call("documentsList", { kind: "all" }))[0]);

  await page.locator("main.primary").getByText("3. Vorlesung").click();
  await page.locator(".ProseMirror").waitFor();
  await page.getByRole("button", { name: "Folien", exact: true }).click();
  await page.getByRole("dialog", { name: "Folien auswählen" }).locator("button.slide-pick").first().click();
  const side = page.locator("section.secondary");
  const span = side.locator(".pdf-page[data-page='1'] .textLayer span", { hasText: "Gestaltungsrecht" }).first();
  await span.waitFor({ timeout: 15000 });

  // 1. Markieren-Modus: von der Mitte von „Anfechtung“ bis in „Gestaltungsrecht“ ziehen
  await side.getByRole("button", { name: "Text markieren" }).click();
  check("Markieren-Leiste mit Farben und „Fertig“", (await side.getByRole("toolbar", { name: "Markieren" }).count()) === 1);
  await side.getByRole("button", { name: "Farbe gruen" }).click();
  const box = await span.boundingBox();
  const text = await span.innerText();
  const at = (s) => box.x + (box.width * (text.indexOf(s) + s.length / 2)) / text.length;
  const y = box.y + box.height / 2;
  await page.mouse.move(at("Anfechtung"), y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(at("Anfechtung") + ((at("Gestaltungsrecht") - at("Anfechtung")) * i) / 8, y);
  check("Vorschau beim Ziehen", (await side.locator(".pdf-hl.is-preview").count()) >= 1);
  await shot("markieren-1-vorschau");
  await page.mouse.up();
  const hl = await waitFor(async () => (await highlights(doc.id))[0]);
  check("Markierung gespeichert (grün)", hl?.color === "gruen", JSON.stringify(hl?.color));
  check("Rastet an ganzen Wörtern ein", hl?.quote === "Anfechtung ist ein Gestaltungsrecht", hl?.quote);
  check("Eine Zeile = ein Rechteck mit klaren Kanten", hl?.rects.length === 1 && hl.rects[0].h > 0 && hl.rects[0].w > 0.1, JSON.stringify(hl?.rects));
  await side.locator(".pdf-hl:not(.is-preview)").first().waitFor();
  check("Markierung wird angezeigt", (await side.locator(".pdf-hl:not(.is-preview)").count()) === 1);

  // 2. Rückwärts ziehen funktioniert genauso
  await page.mouse.move(at("ex tunc") + 4, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(at("ex tunc") + 4 - ((at("ex tunc") - at("BGB")) * i) / 6, y);
  await page.mouse.up();
  const all = await waitFor(async () => {
    const l = await highlights(doc.id);
    return l.length === 2 ? l : null;
  });
  check("Rückwärts ziehen: ganze Wörter", all?.some((a) => a.quote === "BGB ex tunc"), all?.map((a) => a.quote).join(" | "));

  // 3. Antippen einer Markierung öffnet Bearbeiten/Löschen
  const first = side.locator(".pdf-hl:not(.is-preview)").first();
  const fb = await first.boundingBox();
  await page.mouse.click(fb.x + fb.width / 2, fb.y + fb.height / 2);
  check("Antippen öffnet die Markierung", (await page.locator(".anno-pop").count()) === 1);
  await shot("markieren-2-fertig");
  await page.keyboard.press("Escape");
  await side.getByRole("button", { name: "Fertig" }).click();
  check("„Fertig“ beendet den Modus", (await side.getByRole("toolbar", { name: "Markieren" }).count()) === 0);
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.message);
  await shot("markieren-abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
