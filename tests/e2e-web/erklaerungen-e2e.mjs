// End-to-End-Test: Sprungmarken an beliebiger Stelle, Bereich „Begriffe & Erklärungen“ und die gesammelte Übersicht „Erklärungen“.
//
// Aufruf: node tests/e2e-web/erklaerungen-e2e.mjs   (nach npm run build:web)
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
const PORT = 4199;

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

const selectText = (text) =>
  page.evaluate((t) => {
    const walker = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent.indexOf(t);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + t.length);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      return true;
    }
    return false;
  }, text);

try {
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  const P = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
  const H = (text) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
  const id = await page.evaluate(async (doc) => {
    const api = window.__STUDIUM_API__;
    const area = (await api.areasList())[0];
    const c = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "StR AT" });
    const n = await api.nodeCreate({ area_id: area.id, parent_id: c.id, kind: "note", title: "3. Vorlesung", meta: { noteType: "vorlesung" }, content_json: JSON.stringify(doc), plain_text: "" });
    return n.id;
  }, { type: "doc", content: [H("Einleitung"), P("Der Täter handelte mit dolus eventualis. Mehr dazu siehe Kausalität."), ...Array.from({ length: 12 }, (_, i) => P(`Fülltext ${i + 1} – damit gescrollt werden muss.`)), H("Kausalität"), P("Äquivalenztheorie: conditio sine qua non.")] });
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.locator(".tree-row", { hasText: "StR AT" }).first().click();
  await page.locator("main.primary").getByText("3. Vorlesung").first().click();
  const editor = page.locator("main.primary .ProseMirror");
  await editor.waitFor();
  await editor.click();

  // 1. Begriff erklären
  await selectText("dolus eventualis");
  await sleep(200);
  await page.getByRole("button", { name: /^Begriff erklären/ }).click();
  await page.keyboard.type("billigendes Inkaufnehmen des Erfolgs");
  const section = editor.locator(".erklaerungen");
  await section.waitFor({ timeout: 5000 });
  check("Bereich „Begriffe & Erklärungen“ am Ende", (await section.innerText()).includes("dolus eventualis – billigendes Inkaufnehmen"), await section.innerText());
  check("Begriff im Text gepunktet unterstrichen", (await editor.locator(".term-ref", { hasText: "dolus eventualis" }).count()) === 1);
  // zweiter Eintrag direkt im Bereich
  await page.keyboard.press("Enter");
  await page.keyboard.type("ultima ratio – letztes Mittel");
  await editor.locator(".term-ref").first().click();
  await sleep(400);
  const back = page.locator(".outline-back");
  check("Antippen des Begriffs springt zum Eintrag, mit Zurück", (await back.count()) === 1 && (await back.innerText()).includes("Zurück zu „dolus eventualis“"), await back.innerText().catch(() => ""));
  await back.click();

  // 2. Sprungmarke an beliebiger Stelle
  await selectText("siehe Kausalität");
  await sleep(200);
  await page.getByRole("button", { name: /^Sprungmarke/ }).click();
  const dlg = page.getByRole("dialog", { name: "Sprungmarke setzen" });
  await dlg.getByRole("textbox").fill("Kausal");
  await dlg.getByRole("listitem").filter({ hasText: /^Kausalität$/ }).click();
  const link = editor.locator(".jump-link");
  await link.waitFor({ timeout: 5000 });
  check("Sprungmarke gesetzt", (await link.innerText()) === "siehe Kausalität");
  const headingBox = async () => (await editor.locator("h2", { hasText: "Kausalität" }).boundingBox()).y;
  const before = await headingBox();
  await link.click();
  await sleep(700);
  const sel = await page.evaluate(() => getSelection()?.anchorNode?.parentElement?.closest("h2")?.textContent);
  check("Antippen springt zur Überschrift", sel === "Kausalität" && (await headingBox()) < before, `${sel} ${before} → ${await headingBox()}`);
  check("Zurück zur Sprungmarke", (await back.innerText()).includes("Zurück zur Sprungmarke"));
  await back.click();
  let saved = "";
  for (let i = 0; i < 30; i++) {
    saved = (await call("noteGet", id)).content_json;
    if (saved.includes("ultima ratio") && saved.includes("jumpLink")) break;
    await sleep(200);
  }
  check("Gespeichert: Bereich, Begriff, Sprungmarke und Ziel", saved.includes('"type":"erklaerungen"') && saved.includes('"termRef"') && saved.includes('"jumpLink"') && saved.includes('"anchor":"s-'));
  await shot("erklaerungen-mitschrift");

  // 3. Übersicht „Erklärungen“ sammelt automatisch
  await page.getByRole("button", { name: "Erklärungen", exact: true }).click();
  const page2 = page.locator(".explanations");
  await page2.waitFor({ timeout: 10000 });
  const txt = await page2.innerText();
  check("Übersicht: beide Begriffe mit Erklärung und Quelle", txt.includes("dolus eventualis") && txt.includes("billigendes Inkaufnehmen des Erfolgs") && txt.includes("ultima ratio") && txt.includes("aus „3. Vorlesung“"), txt.slice(0, 300));
  await page.locator(".explanation", { hasText: "ultima ratio" }).getByRole("button", { name: "Ins Glossar" }).click();
  await page.locator(".explanation", { hasText: "ultima ratio" }).getByText("im Glossar").waitFor({ timeout: 5000 });
  const defs = await call("knowledgeList", { type: "definition" });
  check("Ins Glossar übernommen", defs.some((d) => d.title === "ultima ratio" && d.data.text === "letztes Mittel"));
  await shot("erklaerungen-uebersicht");
  await page.locator(".explanation", { hasText: "dolus eventualis" }).getByRole("button", { name: /aus „3. Vorlesung“/ }).click();
  await editor.waitFor();
  await sleep(800);
  const box = await editor.locator(".erklaerungen p", { hasText: "dolus eventualis" }).boundingBox();
  check("Quelle öffnet die Mitschrift am Eintrag (im Bild)", !!box && box.y > 0 && box.y < 820, JSON.stringify(box));
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.message);
  await shot("erklaerungen-abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
