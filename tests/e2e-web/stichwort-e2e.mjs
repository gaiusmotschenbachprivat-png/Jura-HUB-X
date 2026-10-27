// End-to-End-Test: Stichwortsuche in der Mitschrift (Trefferliste, Sprung) und aus der globalen Suche.
// iPad quer.
//
// Aufruf: node tests/e2e-web/stichwort-e2e.mjs   (nach npm run build:web)
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
const PORT = 4192;

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

const inView = (loc) => loc.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return r.top >= 0 && r.bottom <= window.innerHeight && r.height > 0;
});

try {
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.evaluate(async () => {
    const api = window.__STUDIUM_API__;
    const area = (await api.areasList())[0];
    const c = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "BGB AT" });
    const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
    const head = (t) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: t }] });
    const content = [];
    for (let i = 1; i <= 12; i++) {
      content.push(head(`${i}. Abschnitt`));
      for (let k = 0; k < 4; k++) content.push(para(`Fülltext ${i}.${k}: Die Vorlesung behandelt hier allgemeine Grundlagen des Bürgerlichen Rechts.`));
      if (i === 3) content.push(para("Eine Willenserklärung wird mit Zugang wirksam (§ 130 I 1 BGB)."));
      if (i === 7) content.push(para("Zugang unter Abwesenden: Die Erklärung muss in den Machtbereich des Empfängers gelangen."));
      if (i === 11) content.push(para("Merke: Beim Zugang kommt es auf die Möglichkeit der Kenntnisnahme an."));
    }
    const json = JSON.stringify({ type: "doc", content });
    await api.nodeCreate({ area_id: area.id, parent_id: c.id, kind: "note", title: "4. Vorlesung", content_json: json, plain_text: json });
  });
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });

  // 1. In der Mitschrift suchen: Trefferliste, antippen springt hin
  await page.locator(".tree-row", { hasText: "BGB AT" }).first().click();
  await page.locator("main.primary").getByText("4. Vorlesung").first().click();
  const editor = page.locator(".ProseMirror");
  await editor.waitFor();
  await page.getByRole("button", { name: "In dieser Mitschrift suchen" }).click();
  await page.getByLabel("Suchen im Text").fill("Zugang");
  const list = page.locator(".find-list");
  await list.waitFor({ timeout: 5000 });
  const hits = list.locator(".find-hit");
  check("Trefferliste zeigt alle Fundstellen", (await hits.count()) === 3, String(await hits.count()));
  const third = await hits.nth(2).innerText();
  check("Fundstelle mit Abschnitt und Ausschnitt", third.includes("11. Abschnitt") && third.includes("Möglichkeit der Kenntnisnahme"), third);
  await hits.nth(2).click();
  await sleep(700);
  const cur = editor.locator(".search-hit.is-current");
  check("Antippen springt zur Stelle (sichtbar, markiert)", (await cur.count()) === 1 && (await inView(cur)) && (await cur.evaluate((e) => e.closest("p")?.textContent ?? "")).startsWith("Merke"));
  check("Zähler zeigt 3/3", (await page.locator(".find-count").innerText()) === "3/3");
  await shot("stichwort-1-liste");
  await page.getByLabel("Suche schließen (Esc)").click();

  // 2. Globale Suche → Notiz öffnet sich an der Fundstelle
  await page.locator(".tree-row", { hasText: "BGB AT" }).first().click();
  await page.locator(".side-search").click();
  await page.locator(".palette-input input").fill("Machtbereich");
  const item = page.locator(".palette-item", { hasText: "4. Vorlesung" }).first();
  await item.waitFor({ timeout: 8000 });
  await item.click();
  await editor.waitFor();
  const cur2 = editor.locator(".search-hit.is-current");
  await cur2.waitFor({ timeout: 8000 });
  await sleep(700);
  check("Aus der globalen Suche: Stichwort in der Notiz angesprungen", (await cur2.innerText()) === "Machtbereich" && (await inView(cur2)), await page.locator(".find-count").innerText());
  check("Suchleiste mit dem Stichwort geöffnet", (await page.getByLabel("Suchen im Text").inputValue()) === "Machtbereich");
  await shot("stichwort-2-global");

  // 3. Mehrere Wörter: längstes vorkommendes Wort
  await page.locator(".side-search").click();
  await page.locator(".palette-input input").fill("Kenntnisnahme Zugang");
  await page.locator(".palette-item", { hasText: "4. Vorlesung" }).first().click();
  await sleep(500);
  check("Mehrere Stichwörter: springt zum längsten vorkommenden", (await page.getByLabel("Suchen im Text").inputValue()) === "Kenntnisnahme");

  // 4. Lesemodus: suchen ja, ersetzen nein
  await page.getByRole("button", { name: "Lesemodus" }).click();
  check("Lesemodus: Suche sichtbar, ohne Ersetzen", (await page.locator(".find-bar").count()) === 1 && (await page.getByLabel("Ersetzen durch").count()) === 0);
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.message);
  await shot("stichwort-abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
