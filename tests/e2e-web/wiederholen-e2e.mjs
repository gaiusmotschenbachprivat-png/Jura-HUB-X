// End-to-End-Test: „Zum Wiederholen“ – Einträge aller Mitschriften gesammelt, Suche, Filter, Sprung in die Mitschrift,
// neue Einträge erscheinen automatisch.
//
// Aufruf: node tests/e2e-web/wiederholen-e2e.mjs   (nach npm run build:web)
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
const PORT = 4202;

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

try {
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  const ids = await page.evaluate(async () => {
    const api = window.__STUDIUM_API__;
    const area = (await api.areasList())[0];
    const T = (text) => ({ type: "text", text });
    const P = (t) => ({ type: "paragraph", content: [T(t)] });
    const H = (l, t) => ({ type: "heading", attrs: { level: l }, content: [T(t)] });
    const UL = (...t) => ({ type: "bulletList", content: t.map((x) => ({ type: "listItem", content: [P(x)] })) });
    const doc = (title, ...rev) => JSON.stringify({ type: "doc", content: [H(1, title), H(2, "Mitschrift"), P("Abstraktionsprinzip"), H(2, "Offene Fragen"), UL("Nicht sammeln"), H(2, "Zum Wiederholen"), ...rev] });
    const sem = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "semester", title: "WS 2026/27" });
    const sr = await api.nodeCreate({ area_id: area.id, parent_id: sem.id, kind: "course", title: "Sachenrecht" });
    const str = await api.nodeCreate({ area_id: area.id, parent_id: sem.id, kind: "course", title: "Strafrecht AT" });
    const mk = (parent, title, date, ...rev) =>
      api.nodeCreate({ area_id: area.id, parent_id: parent, kind: "note", title, meta: { noteType: "vorlesung", date }, content_json: doc(title, ...rev), plain_text: title });
    const v2 = await mk(sr.id, "2. Vorlesung", "2026-10-28", UL("Trennungsprinzip", "§ 929 S. 1 BGB"));
    const v1 = await mk(sr.id, "1. Vorlesung", "2026-10-21", UL("Abstraktionsprinzip"), { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [P("Besitz und Eigentum unterscheiden")] }] });
    const s1 = await mk(str.id, "1. Vorlesung", "2026-10-22", UL("Kausalität: conditio-sine-qua-non"));
    await mk(str.id, "2. Vorlesung", "2026-10-29", UL("…"));
    return { v1: v1.id, v2: v2.id, s1: s1.id };
  });
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });

  // 1. Sammlung öffnen
  await page.getByRole("button", { name: "Zum Wiederholen" }).first().click();
  const list = page.getByRole("list", { name: "Einträge zum Wiederholen" });
  await list.waitFor({ timeout: 10000 });
  const items = list.locator(".review-item");
  await waitFor(async () => (await items.count()) === 5);
  const txt = await list.innerText();
  check("Alle Einträge aus allen Mitschriften (ohne Platzhalter, ohne andere Bereiche)", (await items.count()) === 5 && !/Nicht sammeln|…/.test(txt), txt);
  check("Nach Veranstaltung geordnet", txt.indexOf("SACHENRECHT") < txt.indexOf("STRAFRECHT AT") || txt.indexOf("Sachenrecht") < txt.indexOf("Strafrecht AT"), txt);
  check("Vorlesungen nach Datum", txt.indexOf("Abstraktionsprinzip") < txt.indexOf("Trennungsprinzip"), txt);
  check("Abgehakter Punkt als erledigt", (await list.locator(".review-item.is-done").innerText()).includes("Besitz und Eigentum"));
  check("Zähler", /5 Einträge aus 3 Mitschriften/.test(await page.locator(".review-page .page-head").innerText()), await page.locator(".review-page .page-head").innerText());
  await shot("wiederholen-1-sammlung");

  // 2. Suche, Filter, Erledigte ausblenden, kopieren
  await page.getByLabel("Einträge zum Wiederholen durchsuchen").fill("prinzip");
  await waitFor(async () => (await items.count()) === 2);
  check("Suche", (await items.count()) === 2 && /2 von 5 Einträgen/.test(await page.locator(".review-page .page-head").innerText()));
  await page.getByLabel("Einträge zum Wiederholen durchsuchen").fill("");
  await page.getByLabel("Veranstaltung").selectOption({ label: "Strafrecht AT" });
  await waitFor(async () => (await items.count()) === 1);
  check("Filter nach Veranstaltung", (await items.count()) === 1 && (await items.first().innerText()).includes("Kausalität"));
  await page.getByLabel("Veranstaltung").selectOption({ label: "Alle Veranstaltungen" });
  await page.getByLabel("Erledigte ausblenden").check();
  await waitFor(async () => (await items.count()) === 4);
  check("Erledigte ausblenden", (await items.count()) === 4);
  await page.getByLabel("Erledigte ausblenden").uncheck();
  await page.getByRole("button", { name: "Liste kopieren" }).click();
  const clip = await waitFor(() => page.evaluate(() => navigator.clipboard.readText().catch(() => "")));
  check("Liste kopieren", /Sachenrecht[\s\S]*1\. Vorlesung\n  – Abstraktionsprinzip\n  ☑ Besitz und Eigentum unterscheiden/.test(clip ?? ""), clip);

  // 3. Antippen: Mitschrift öffnet an der Stelle (nicht beim gleichlautenden Absatz oben)
  await items.filter({ hasText: "Abstraktionsprinzip" }).getByRole("button").click();
  await page.locator(".ProseMirror").waitFor({ timeout: 10000 });
  const where = await waitFor(() => page.evaluate(() => document.querySelector(".ProseMirror .outline-flash")?.closest("li")?.textContent ?? null), 4000);
  const visible = await page.locator(".ProseMirror li", { hasText: "Abstraktionsprinzip" }).isVisible();
  check("Sprung zum Eintrag im Bereich „Zum Wiederholen“ (hervorgehoben)", where === "Abstraktionsprinzip" && visible, String(where));
  await shot("wiederholen-2-sprung");

  // 4. Neuer Eintrag in der Mitschrift erscheint in der Sammlung
  await page.locator(".ProseMirror li p", { hasText: "Abstraktionsprinzip" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Publizitätsprinzip");
  for (let i = 0; i < 30; i++) {
    if ((await call("noteGet", ids.v1)).content_json.includes("Publizitätsprinzip")) break;
    await sleep(200);
  }
  await page.getByRole("button", { name: "Zum Wiederholen" }).first().click();
  await list.waitFor({ timeout: 10000 });
  await waitFor(async () => (await items.count()) === 6);
  check("Neuer Eintrag automatisch übernommen", (await items.count()) === 6 && (await list.innerText()).includes("Publizitätsprinzip"), await list.innerText());
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.message);
  await shot("wiederholen-abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
