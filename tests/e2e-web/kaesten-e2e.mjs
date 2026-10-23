// End-to-End-Test: farbige Kästen (Beispiel, Gesetzestext, Definition …) im Skript
// anlegen, beschriften, Art ändern, verlassen, auflösen; Druckansicht (iPad-Größe).
//
// Aufruf: node tests/e2e-web/kaesten-e2e.mjs   (nach npm run build:web)
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
const PORT = 4188;

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
async function waitFor(fn, ms = 6000) {
  const t = Date.now();
  for (;;) {
    const v = await fn();
    if (v || Date.now() - t > ms) return v;
    await sleep(150);
  }
}

const P = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
try {
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  const id = await page.evaluate(async (doc) => {
    const api = window.__STUDIUM_API__;
    const area = (await api.areasList())[0];
    const c = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "BGB AT" });
    return (await api.nodeCreate({ area_id: area.id, parent_id: c.id, kind: "note", title: "Skript Kaufrecht", content_json: JSON.stringify(doc) })).id;
  }, { type: "doc", content: [P("Einleitung zum Kaufrecht."), P("Durch den Kaufvertrag wird der Verkäufer einer Sache verpflichtet, dem Käufer die Sache zu übergeben."), P("Weiter im Text.")] });
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.locator(".tree-row", { hasText: "BGB AT" }).click();
  await page.locator("main.primary").getByText("Skript Kaufrecht").click();
  await page.locator(".ProseMirror").waitFor();

  // 1. Absatz markieren → Kasten „Gesetzestext“
  await page.locator(".ProseMirror p", { hasText: "Durch den Kaufvertrag" }).click();
  await page.getByRole("button", { name: /^Kasten:/ }).click();
  await page.getByRole("menuitem", { name: "Gesetzestext" }).click();
  const box = page.locator(".ProseMirror .callout");
  await box.waitFor();
  check("Kasten um den Absatz", (await box.count()) === 1 && (await box.innerText()).includes("Durch den Kaufvertrag"));
  const style = await box.evaluate((el) => { const s = getComputedStyle(el); return { border: s.borderLeftColor, bg: s.backgroundColor, w: s.borderLeftWidth }; });
  check("Dezent: farbiger Rand links, helle Hinterlegung", style.border === "rgb(107, 79, 163)" && style.bg !== "rgba(0, 0, 0, 0)" && style.w === "3px", JSON.stringify(style));

  // 2. Beschriftung antippen → Überschrift
  await box.locator(".callout-label").click();
  await page.getByRole("menuitem", { name: /Überschrift ergänzen/ }).click();
  const dlg = page.getByRole("dialog", { name: /Überschrift für/ });
  await dlg.getByRole("textbox").fill("§ 433 BGB");
  await dlg.getByRole("button", { name: "Übernehmen" }).click();
  await dlg.waitFor({ state: "detached" });
  await page.waitForFunction(() => !!window.getSelection()?.anchorNode?.parentElement?.closest(".callout") && !!document.activeElement?.closest(".ProseMirror"), null, { timeout: 3000 }).catch(() => {});
  check("Nach dem Dialog steht die Schreibmarke im Kasten", await page.evaluate(() => !!document.activeElement?.closest(".ProseMirror") && !!window.getSelection()?.anchorNode?.parentElement?.closest(".callout")));
  check("Beschriftung mit Überschrift", (await box.locator(".callout-label").innerText()).toLowerCase() === "gesetzestext · § 433 bgb");

  // 3. Im Kasten weiterschreiben, mit Enter auf leerer Zeile heraus
  // Schreibmarke steht nach dem Dialog bereits am Ende des Kastens
  await page.keyboard.press("Enter");
  await page.keyboard.type("(2) Der Käufer ist verpflichtet, den Kaufpreis zu zahlen.");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Danach normal weiter.");
  check("Zweiter Absatz im Kasten", (await box.locator("p").count()) === 2, JSON.stringify(await page.locator(".ProseMirror").innerText()));
  check("Enter auf leerer Zeile verlässt den Kasten", !(await box.innerText()).includes("Danach normal weiter") && (await page.locator(".ProseMirror > p", { hasText: "Danach normal weiter" }).count()) === 1);

  // 4. Weitere Arten: Beispiel
  await page.locator(".ProseMirror p", { hasText: "Einleitung zum Kaufrecht" }).click();
  await page.getByRole("button", { name: /^Kasten:/ }).click();
  await page.getByRole("menuitem", { name: "Beispiel" }).click();
  check("Zwei Kästen verschiedener Art", (await page.locator(".ProseMirror .callout-beispiel").count()) === 1 && (await page.locator(".ProseMirror .callout-gesetz").count()) === 1);
  await shot("kaesten-1");

  // 5. Gespeichert
  let saved = "";
  for (let i = 0; i < 30; i++) {
    saved = (await call("noteGet", id)).content_json;
    if (saved.includes("Danach normal weiter") && saved.includes('"kind":"beispiel"')) break;
    await sleep(200);
  }
  check("Gespeichert mit Art und Überschrift", saved.includes('"kind":"gesetz"') && saved.includes('"title":"§ 433 BGB"') && saved.includes('"kind":"beispiel"'));

  // 6. Art ändern und auflösen
  await page.locator(".ProseMirror .callout-beispiel .callout-label").click();
  await page.getByRole("menuitem", { name: "Definition" }).click();
  check("Art geändert: Beispiel → Definition", (await page.locator(".ProseMirror .callout-definition").count()) === 1 && (await page.locator(".ProseMirror .callout-beispiel").count()) === 0);
  await page.locator(".ProseMirror .callout-definition .callout-label").click();
  await page.getByRole("menuitem", { name: /Kasten auflösen/ }).click();
  check("Kasten aufgelöst, Text bleibt", (await page.locator(".ProseMirror .callout").count()) === 1 && (await page.locator(".ProseMirror > p", { hasText: "Einleitung zum Kaufrecht" }).count()) === 1);

  // 7. Druckansicht zeigt den Kasten mit Beschriftung
  await page.getByRole("button", { name: "Drucken / als PDF" }).click();
  await page.locator(".pagedjs_page").first().waitFor({ timeout: 20000 });
  const pbox = page.locator(".pagedjs_page .callout").first();
  const label = await pbox.evaluate((el) => getComputedStyle(el, "::before").content);
  check("Druck: Kasten mit Beschriftung", label.includes("Gesetzestext · § 433 BGB"), label);
  await shot("kaesten-2-druck");
  await page.getByRole("button", { name: "Druckansicht schließen" }).click();
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Ablauf ohne Ausnahme", false, e.stack ?? String(e));
  await shot("kaesten-fehler").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
process.exit(failed.length ? 1 : 0);
