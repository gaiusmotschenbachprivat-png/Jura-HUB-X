// End-to-End-Test: Juristisches Glossar (Definitionen) – alphabetisch mit
// A–Z-Register, Suche, Rechtsgebiet-Filter, Bearbeiten im Dialog, Kopieren,
// Karteikarte, Norm antippen. iPad-Größe, Touch, Playwright/Chromium.
//
// Aufruf: node tests/e2e-web/glossar-e2e.mjs   (nach npm run build:web)
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
const PORT = 4182;

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
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: `http://127.0.0.1:${PORT}` });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const g = page.locator(".glossar");
const dlg = page.locator("dialog.g-dialog");

const add = async (term, def, norm = "", area = "") => {
  await g.getByRole("button", { name: /Begriff/ }).click();
  await dlg.locator("#g-term").fill(term);
  if (norm) await dlg.locator("#g-norm").fill(norm);
  if (area) await dlg.locator("#g-area").fill(area);
  await dlg.locator("#g-def").fill(def);
  await dlg.getByRole("button", { name: "Speichern" }).click();
};

try {
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });

  await page.getByRole("button", { name: "Glossar" }).click();
  await g.waitFor();
  check("Seitenleiste: „Glossar“ öffnet das Juristische Glossar", (await g.locator("h1").innerText()) === "Juristisches Glossar");
  check("Leeres Glossar mit Hinweis", (await g.locator(".g-empty").innerText()).includes("Dein Glossar ist noch leer"));

  await add("Willenserklärung", "Äußerung eines auf die Herbeiführung einer Rechtsfolge gerichteten Willens.", "§ 133 BGB", "Zivilrecht");
  await g.locator(".g-entry").first().waitFor();
  await add("Anfechtung", "Gestaltungsrecht, das ein Rechtsgeschäft rückwirkend vernichtet.", "§ 142 Abs. 1 BGB", "Zivilrecht");
  await add("Ärgernis", "Beispiel für Umlaute im Register.", "", "Strafrecht");
  await add("Verwaltungsakt", "Hoheitliche Maßnahme einer Behörde zur Regelung eines Einzelfalls.", "§ 35 S. 1 VwVfG", "Öffentliches Recht");
  await add("1. Testbegriff", "Beginnt mit einer Zahl.");
  await page.waitForFunction(() => document.querySelectorAll(".g-entry").length === 5, null, { timeout: 5000 }).catch(() => {});

  const letters = await g.locator(".g-letter").allInnerTexts();
  check("Gruppen nach Anfangsbuchstaben, Ä unter A, Zahlen unter #", letters.join("") === "AVW#", letters.join(","));
  const termsA = await g.locator(".g-group").first().locator(".g-term").allInnerTexts();
  check("Alphabetisch sortiert (Anfechtung vor Ärgernis)", termsA.join("|") === "Anfechtung|Ärgernis", termsA.join("|"));
  const reg = await g.locator(".g-register button").allInnerTexts();
  check("A–Z-Register mit vorhandenen Buchstaben", reg.join("") === "AVW#", reg.join(""));
  check("Leere Buchstaben ausgegraut", (await g.locator(".g-register span").count()) === 23);
  check("Zähler", (await g.locator(".g-count").innerText()) === "5 Begriffe");
  const fonts = await g.locator(".g-term").first().evaluate((el) => getComputedStyle(el).fontFamily);
  check("Serifenschrift (Literata) wie im Glossar", fonts.includes("Literata"), fonts);
  await shot("glossar-hell");

  // Doppelter Begriff
  await g.getByRole("button", { name: /Begriff/ }).click();
  await dlg.locator("#g-term").fill("willenserklärung");
  await dlg.locator("#g-def").fill("doppelt");
  await dlg.getByRole("button", { name: "Speichern" }).click();
  check("Doppelte Begriffe werden abgelehnt", (await dlg.locator(".g-err").innerText()).includes("steht schon in deinem Glossar"));
  await dlg.getByRole("button", { name: "Abbrechen" }).click();

  // Suche mit Hervorhebung und „/“
  await page.locator(".g-main").click();
  await page.keyboard.press("/");
  check("„/“ springt in die Suche", await g.getByLabel("Glossar durchsuchen").evaluate((el) => el === document.activeElement));
  await page.keyboard.type("rückwirkend");
  await sleep(200);
  check("Suche findet Text in der Definition", (await g.locator(".g-entry").count()) === 1 && (await g.locator(".g-entry mark").innerText()) === "rückwirkend");
  await g.getByLabel("Glossar durchsuchen").fill("VwVfG");
  check("Suche findet Normen", (await g.locator(".g-term").allInnerTexts()).join() === "Verwaltungsakt");
  await g.getByLabel("Glossar durchsuchen").fill("");

  // Filter nach Rechtsgebiet
  const chips = await g.locator(".g-chip").allInnerTexts();
  check("Filter-Chips aus verwendeten Rechtsgebieten", chips.join("|") === "Alle|Zivilrecht|Strafrecht|Öffentliches Recht", chips.join("|"));
  await g.getByRole("button", { name: "Strafrecht" }).click();
  check("Filter Strafrecht", (await g.locator(".g-term").allInnerTexts()).join() === "Ärgernis");
  await g.getByRole("button", { name: "Alle" }).click();

  // Kopieren
  const anf = g.locator(".g-entry", { hasText: "Anfechtung" });
  await anf.getByRole("button", { name: "Definition kopieren" }).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check("Kopieren: Begriff (Norm): Definition", clip === "Anfechtung (§ 142 Abs. 1 BGB): Gestaltungsrecht, das ein Rechtsgeschäft rückwirkend vernichtet.", clip);

  // Norm antippen
  await anf.locator(".g-norm").click();
  await page.locator(".norm-pop").getByText("noch nicht importiert").waitFor({ timeout: 5000 });
  check("Norm antippen zeigt Wortlaut bzw. Import-Hinweis", true);
  await page.keyboard.press("Escape");

  // Bearbeiten im Dialog
  await anf.getByRole("button", { name: "Anfechtung bearbeiten" }).click();
  check("Bearbeiten-Dialog mit vorhandenen Angaben", (await dlg.locator("#g-norm").inputValue()) === "§ 142 Abs. 1 BGB");
  await dlg.locator("#g-def").fill("Gestaltungsrecht; vernichtet das Rechtsgeschäft ex tunc (§ 142 Abs. 1 BGB).");
  await dlg.getByRole("button", { name: "Speichern" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("ex tunc"), null, { timeout: 5000 }).catch(() => {});
  check("Änderung gespeichert", (await anf.locator(".g-def").innerText()).includes("ex tunc"));

  // Karteikarte
  await anf.getByRole("button", { name: "Als Karteikarte lernen" }).click();
  await page.getByRole("button", { name: /Speichern|Anlegen|Erstellen/ }).last().click();
  await sleep(500);
  const cards = await page.evaluate(async () => (await window.__STUDIUM_API__.cardsList({})).map((c) => [c.front, c.source_type]));
  check("Karteikarte aus dem Glossar", cards.some((c) => c[0] === "Anfechtung" && c[1] === "knowledge"), JSON.stringify(cards));

  // Löschen mit Rückfrage
  const arg = g.locator(".g-entry", { hasText: "Ärgernis" });
  await arg.getByRole("button", { name: "Ärgernis bearbeiten" }).click();
  await dlg.getByRole("button", { name: "Löschen" }).click();
  check("Löschen fragt nach („Wirklich?“)", (await dlg.getByRole("button", { name: "Wirklich?" }).count()) === 1);
  await dlg.getByRole("button", { name: "Wirklich?" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".g-entry").length === 4, null, { timeout: 5000 }).catch(() => {});
  check("Gelöscht (in den Papierkorb)", (await g.locator(".g-entry").count()) === 4);

  // Daten sind dieselben wie bei „Definition aus Auswahl“ und im Wissen
  const defs = await page.evaluate(async () => (await window.__STUDIUM_API__.knowledgeList({ type: "definition" })).map((k) => [k.title, k.field, k.data.citation]));
  check("Glossar speichert als Definitionen (Wissen)", defs.length === 4 && defs.some((d) => d[0] === "Verwaltungsakt" && d[1] === "Öffentliches Recht" && d[2] === "§ 35 S. 1 VwVfG"));

  // Dunkelmodus und Hochformat
  await page.emulateMedia({ colorScheme: "dark" });
  await sleep(300);
  await shot("glossar-dunkel");
  await page.setViewportSize({ width: 820, height: 1180 });
  await sleep(300);
  const over = await page.evaluate(() => document.querySelector(".glossar").scrollWidth - document.querySelector(".glossar").clientWidth);
  check("Hochformat: nichts ragt heraus", over <= 1, String(over));
  await shot("glossar-hoch");

  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Ablauf ohne Abbruch", false, String(e).slice(0, 500));
  await shot("glossar-fehler").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
