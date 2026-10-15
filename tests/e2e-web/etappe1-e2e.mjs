// End-to-End-Test: Gutachtenstil, Prüfungsschema einfügen, Suchen/Ersetzen,
// Inhaltsverzeichnis, Druckansicht (Paged.js) und Backup-Erinnerung
// (iPad-Größe, Touch, Playwright/Chromium).
//
// Aufruf: node tests/e2e-web/etappe1-e2e.mjs   (nach npm run build:web)
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
const PORT = 4178;

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
const editor = page.locator(".ProseMirror");
const tb = page.locator(".toolbar");
const focusEditor = () => page.waitForFunction(() => document.activeElement?.closest?.(".ProseMirror"), null, { timeout: 3000 }).catch(() => {});

try {
  await page.goto(`http://127.0.0.1:${PORT}/?e2e&remind`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.evaluate(async () => {
    const api = window.__STUDIUM_API__;
    const area = (await api.areasList())[0];
    await api.knowledgeCreate({
      type: "schema",
      area_id: area.id,
      title: "Anspruch aus Kaufvertrag",
      data: {
        norm: "§ 433 Abs. 2 BGB",
        notes: "",
        items: [
          { id: "a", text: "Anspruch entstanden", note: "", children: [{ id: "b", text: "Wirksamer Kaufvertrag", note: "§§ 145 ff. BGB", children: [] }] },
          { id: "c", text: "Anspruch durchsetzbar", note: "", children: [] },
        ],
      },
    });
    await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "note", title: "Fall 1", meta: { noteType: "fall" } });
  });
  await page.reload();

  // Backup-Erinnerung erscheint (noch nie in Dateien gesichert)
  const reminder = page.locator(".backup-reminder");
  const shown = await reminder.waitFor({ timeout: 15000 }).then(() => true, () => false);
  check("Backup-Erinnerung erscheint, Backup liegt bereit", shown && (await reminder.innerText()).includes("In Dateien sichern"));
  if (shown) {
    await reminder.getByRole("button", { name: "In 3 Tagen" }).click();
    const snooze = await page.evaluate(async () => (await window.__STUDIUM_API__.settingsAll())["backup.snooze_until"]);
    check("„In 3 Tagen“ pausiert die Erinnerung", (await reminder.count()) === 0 && typeof snooze === "string" && Date.parse(snooze) > Date.now() + 2.5 * 86400000);
  }

  await page.locator(".tree-row", { hasText: "Fall 1" }).first().click();
  await editor.waitFor();
  await editor.click();

  // 1. Gutachtenstil: Obersatz, Platzhalter überschreiben
  await tb.getByRole("button", { name: /^Gutachtenstil/ }).click();
  await page.getByRole("menuitem", { name: "Obersatz Zivilrecht (Anspruch)" }).click();
  await focusEditor();
  await page.keyboard.type("V");
  let text = await editor.innerText();
  check("Obersatz eingefügt, erster Platzhalter direkt überschreibbar", text.includes("V könnte gegen … einen Anspruch auf … aus § … haben."), text.slice(0, 200));
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await tb.getByRole("button", { name: /^Gutachtenstil/ }).click();
  await page.getByRole("menuitem", { name: "Streitstand" }).click();
  check("Streitstand mit Stellungnahme", (await editor.innerText()).includes("Stellungnahme:"));

  // 2. Prüfungsschema einfügen
  await page.keyboard.press("Control+End");
  await tb.getByRole("button", { name: /^Gutachtenstil/ }).click();
  await page.getByRole("menuitem", { name: /Prüfungsschema einfügen/ }).click();
  await page.getByRole("option", { name: /Anspruch aus Kaufvertrag/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Einfügen", exact: true }).click();
  text = await editor.innerText();
  check("Schema als Gliederung A./I. mit Hinweis", /A\. Anspruch entstanden[\s\S]*I\. Wirksamer Kaufvertrag[\s\S]*§§ 145 ff\. BGB[\s\S]*B\. Anspruch durchsetzbar/.test(text), text.slice(-300));
  check("Schema-Überschriften im Editor", (await editor.locator("h3").count()) >= 2);

  // 3. Suchen und Ersetzen (⌘F)
  await editor.click();
  await page.keyboard.press("Control+f");
  const find = page.locator(".find-bar");
  await find.waitFor({ timeout: 3000 });
  await find.getByLabel("Suchen im Text").fill("anspruch");
  await sleep(200);
  const count = await find.locator(".find-count").innerText();
  check("Suche zählt Treffer (ohne Groß/klein)", /^\d+\/[4-9]$/.test(count), count);
  check("Treffer im Text markiert", (await editor.locator(".search-hit").count()) >= 4);
  await find.getByLabel("Ersetzen durch").fill("Begehren");
  await find.getByRole("button", { name: "Alle ersetzen" }).click();
  await sleep(200);
  check("Alle ersetzen", !(await editor.innerText()).toLowerCase().includes("anspruch") && (await editor.innerText()).includes("Begehren"));
  await find.getByLabel("Suchen im Text").press("Escape");
  check("Suche schließt mit Esc", (await find.count()) === 0 && (await editor.locator(".search-hit").count()) === 0);

  // 4. Inhaltsverzeichnis springt zur Überschrift
  await page.getByRole("button", { name: "Inhaltsverzeichnis" }).click();
  const tocItems = await page.getByRole("menuitem").allInnerTexts();
  check("Inhaltsverzeichnis listet Überschriften", tocItems.some((t) => t.includes("Begehren aus Kaufvertrag")) && tocItems.some((t) => t.includes("B. Begehren durchsetzbar")), tocItems.join(" | "));
  await page.getByRole("menuitem", { name: /B\. Begehren durchsetzbar/ }).click();
  await page.waitForFunction(() => (getSelection()?.anchorNode?.textContent ?? "").includes("B. Begehren durchsetzbar"), null, { timeout: 3000 }).catch(() => {});
  const at = await page.evaluate(() => getSelection()?.anchorNode?.textContent ?? "");
  check("Antippen springt zur Überschrift", at.includes("B. Begehren durchsetzbar"), at);

  // Fußnote für den Druck
  await page.keyboard.press("End");
  await tb.getByRole("button", { name: /^Fußnote einfügen/ }).click();
  await page.getByLabel("Text der Fußnote").fill("Palandt/Weidenkaff, § 433 Rn. 1.");
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await shot("etappe1-editor");

  // 5. Druckansicht mit Seiten, Seitenzahlen, Fußnoten unten
  await page.getByRole("button", { name: "Drucken / als PDF" }).click();
  const overlay = page.locator(".print-overlay");
  await overlay.waitFor();
  await overlay.locator(".pagedjs_page").first().waitFor({ timeout: 20000 });
  const pages = await overlay.locator(".pagedjs_page").count();
  check("Druckansicht setzt A4-Seiten", pages >= 1, `${pages} Seiten`);
  const fnArea = await overlay.locator(".pagedjs_footnote_area").first().innerText().catch(() => "");
  check("Fußnote steht unten auf der Seite", fnArea.includes("Palandt/Weidenkaff"), fnArea.slice(0, 120));
  const pageNo = await overlay.locator(".pagedjs_margin-bottom-center").first().evaluate((el) => getComputedStyle(el.querySelector(".pagedjs_margin-content") ?? el, "::after").content).catch(() => "");
  check("Seitenzahl unten", /counter|"1"/.test(pageNo), pageNo);
  await overlay.getByLabel("Seitenränder").selectOption("korrektur");
  await overlay.getByText("Inhaltsverzeichnis").click();
  await sleep(1500);
  await overlay.locator(".pagedjs_page").first().waitFor({ timeout: 20000 });
  const tocText = await overlay.locator(".toc").first().innerText().catch(() => "");
  check("Inhaltsverzeichnis im Druck, ohne Fußnotentext", tocText.includes("Inhaltsverzeichnis") && tocText.includes("Begehren durchsetzbar") && !tocText.includes("Palandt"), tocText.slice(0, 200));
  const tocNo = await overlay.locator(".toc li a").first().evaluate((el) => getComputedStyle(el, "::after").content);
  check("Inhaltsverzeichnis mit Seitenzahlen", /^"\d+"$|^counter\(target-counter/.test(tocNo), tocNo);
  const marginRight = await overlay.locator(".pagedjs_page").first().evaluate((el) => getComputedStyle(el).getPropertyValue("--pagedjs-margin-right").trim());
  check("Korrekturrand 7 cm rechts", marginRight === "7cm", marginRight);
  await shot("etappe1-druck");
  // Druckdialog: im Test abgefangen
  await page.evaluate(() => {
    window.__printed = 0;
    window.print = () => (window.__printed += 1);
  });
  await overlay.getByRole("button", { name: "Drucken / PDF" }).click();
  check("„Drucken / PDF“ öffnet den Druckdialog", (await page.evaluate(() => window.__printed)) === 1);
  await page.emulateMedia({ media: "print" });
  const appHidden = await page.evaluate(() => getComputedStyle(document.getElementById("root")).display === "none");
  check("Beim Drucken nur die Seiten (App ausgeblendet)", appHidden);
  await page.emulateMedia({ media: "screen" });
  await overlay.getByRole("button", { name: "Druckansicht schließen" }).click();
  const leftovers = await page.evaluate(() => document.querySelectorAll("style[data-pagedjs-inserted-styles]").length);
  check("Nach dem Schließen keine Druck-Stile übrig", (await overlay.count()) === 0 && leftovers === 0, String(leftovers));
  check("Editor nach der Druckansicht unverändert", (await editor.locator(".footnote-ref").count()) === 1);

  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Ablauf ohne Abbruch", false, String(e).slice(0, 500));
  await shot("etappe1-fehler").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
