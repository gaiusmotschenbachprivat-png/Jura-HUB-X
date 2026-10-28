// End-to-End-Test: Schema-Bibliothek (Zivil-, Straf-, Öffentliches Recht), farbige Grafik, Bausteine.
// iPad quer.
//
// Aufruf: node tests/e2e-web/schemata-e2e.mjs   (nach npm run build:web)
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
const PORT = 4191;

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
  await page.evaluate(async () => {
    const api = window.__STUDIUM_API__;
    const area = (await api.areasList())[0];
    const c = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "Strafrecht AT" });
    await api.nodeCreate({ area_id: area.id, parent_id: c.id, kind: "note", title: "Fall 3" });
  });
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });

  // 1. Prüfungsschemata: Vorlagen nach Rechtsgebiet
  await page.getByRole("button", { name: "Prüfungsschemata" }).click();
  const lib = page.locator(".schema-lib").first();
  await lib.waitFor();
  const tabs = await lib.getByRole("tab").allInnerTexts();
  check("Vorlagen für Zivilrecht, Strafrecht, Öffentliches Recht", tabs.join("|") === "Zivilrecht|Strafrecht|Öffentliches Recht", tabs.join("|"));
  await lib.getByRole("tab", { name: "Strafrecht" }).click();
  const cards = await lib.locator(".schema-card").allInnerTexts();
  check("Strafrecht: Standardaufbauten (Versuch, Notwehr, Diebstahl, Betrug …)", ["Versuch", "Notwehr", "Diebstahl", "Betrug", "Mittäterschaft"].every((t) => cards.some((c) => c.startsWith(t))), cards.length + "");
  await lib.locator(".schema-card", { hasText: /^Diebstahl/ }).click();
  const sd = lib.locator(".sd");
  await sd.waitFor();
  const stages = sd.locator(".sd-stage");
  const colors = await stages.evaluateAll((els) => els.map((e) => getComputedStyle(e).borderLeftColor));
  check("Grafik: Tatbestand, Rechtswidrigkeit, Schuld in eigenen Farben", (await stages.count()) >= 3 && new Set(colors.slice(0, 3)).size === 3, colors.join(" "));
  check("Klausurprobleme mit P markiert", (await sd.locator(".sd-p").count()) >= 1);
  check("Kopf in der Farbe des Strafrechts mit Norm", (await sd.locator(".sd-head").innerText()).includes("§ 242 I StGB"));
  await shot("schemata-1-bibliothek");

  // 2. In meine Schemata übernehmen → Grafik, Fachgebiet, üben
  await lib.getByRole("button", { name: "In meine Schemata übernehmen" }).click();
  await page.getByRole("tab", { name: "Grafik" }).waitFor({ timeout: 8000 });
  check("Übernommen: eigenes Schema mit Grafikansicht", (await page.locator(".kn-body .sd").count()) === 1);
  const k = await page.evaluate(async () => (await window.__STUDIUM_API__.knowledgeList({ type: "schema" }))[0]);
  check("Fachgebiet Strafrecht, alle Punkte übernommen", k?.field === "Strafrecht" && JSON.stringify(k.data).includes("Gewahrsams"), k?.field);
  check("Schema üben möglich", (await page.getByRole("button", { name: "Schema üben" }).count()) === 1);
  await page.getByRole("tab", { name: "Bearbeiten" }).click();
  check("Umschalten auf Bearbeiten", (await page.locator(".schema-editor").count()) === 1);

  // 3. In der Mitschrift: Bausteine nach Rechtsgebiet, Vorlage farbig einfügen
  await page.locator(".tree-row", { hasText: "Strafrecht AT" }).first().click();
  await page.locator("main.primary").getByText("Fall 3").first().click();
  const editor = page.locator(".ProseMirror");
  await editor.waitFor();
  await editor.click();
  const tb = page.getByRole("toolbar", { name: /Format/ });
  await page.getByRole("button", { name: /^Gutachtenstil/ }).click();
  const menuText = await page.locator(".menu").innerText();
  check("Bausteine nach Rechtsgebiet gruppiert", /zivilrecht[\s\S]*strafrecht[\s\S]*öffentliches recht[\s\S]*für jedes gutachten/i.test(menuText), menuText.slice(0, 200));
  await page.getByRole("menuitem", { name: /Deliktsaufbau/ }).click();
  const t1 = await editor.innerText();
  check("Deliktsaufbau eingefügt", /I\. Tatbestand[\s\S]*II\. Rechtswidrigkeit[\s\S]*III\. Schuld/.test(t1), t1.slice(0, 200));
  await page.keyboard.press("Control+End");
  await page.getByRole("button", { name: /^Gutachtenstil/ }).click();
  await page.getByRole("menuitem", { name: /Prüfungsschema einfügen/ }).click();
  const dlg = page.getByRole("dialog", { name: "Prüfungsschema einfügen" });
  await dlg.waitFor();
  await dlg.getByRole("tab", { name: "Vorlagen", exact: true }).click();
  check("Vorlagen öffnen beim Rechtsgebiet der Notiz (Strafrecht)", (await dlg.locator(".schema-lib-tab.is-active").innerText()) === "Strafrecht");
  await dlg.getByRole("tab", { name: "Öffentliches Recht" }).click();
  await dlg.locator(".schema-card", { hasText: "Anfechtungsklage" }).click();
  await dlg.getByRole("button", { name: "In die Mitschrift einfügen" }).click();
  await dlg.waitFor({ state: "detached" });
  const t2 = await editor.innerText();
  check("Anfechtungsklage als Gliederung eingefügt", /Anfechtungsklage \(§ 42 I Alt\. 1 VwGO\)[\s\S]*A\. Zulässigkeit[\s\S]*B\. Begründetheit/.test(t2), t2.slice(-300));
  const h = editor.locator("h3", { hasText: "Zulässigkeit" }).locator("span[style*='color']");
  check("Prüfungsstufen farbig", (await h.count()) >= 1);
  await shot("schemata-2-mitschrift");
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.message);
  await shot("schemata-abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
