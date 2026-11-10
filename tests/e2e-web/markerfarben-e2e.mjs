// End-to-End-Test: Markerfarben – anpassen (Farbe, Bedeutung, eigene Farbe), vorhandene Markierungen ändern sich mit,
// gespeichert, im dunklen Modus lesbar (Kontrast), Word-Export.
//
// Aufruf: node tests/e2e-web/markerfarben-e2e.mjs   (nach npm run build:web)
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
const PORT = 4204;

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

const T = (text, marks) => ({ type: "text", text, ...(marks ? { marks } : {}) });
const HL = (color) => [{ type: "highlight", attrs: { color } }];
// Kontrast nach WCAG
const lum = (rgb) => {
  const scale = rgb.startsWith("color(") ? 1 : 255;
  const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => v / scale).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

try {
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  const id = await page.evaluate(async (doc) => {
    const api = window.__STUDIUM_API__;
    const area = (await api.areasList())[0];
    const c = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "BGB AT" });
    return (await api.nodeCreate({ area_id: area.id, parent_id: c.id, kind: "note", title: "Fall Hieb", content_json: JSON.stringify(doc) })).id;
  }, { type: "doc", content: [{ type: "paragraph", content: [T("Hieb ("), T("H", HL("#d7c8ff")), T(") bietet "), T("Stich", HL("#fff59d")), T(" Waren an. Neuer Text zum Markieren.")] }] });
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.locator(".tree-row", { hasText: "BGB AT" }).click();
  await page.locator("main.primary").getByText("Fall Hieb").click();
  const editor = page.locator(".ProseMirror");
  await editor.waitFor();
  const bg = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);
  const stich = editor.locator("mark", { hasText: "Stich" });
  check("Vorhandene Markierung (ältere Notiz) erscheint gelb", (await bg(stich)) === "rgb(255, 245, 157)", await bg(stich));

  // 1. Farbauswahl zeigt Bedeutungen und „Farben anpassen …“
  const tb = page.getByRole("toolbar").first();
  await tb.getByRole("button", { name: /^Hervorheben/ }).click();
  const pop = page.locator(".color-pop");
  check("Farben mit Namen", (await pop.getByRole("button", { name: /^Gelb/ }).count()) === 1 && (await pop.getByRole("button", { name: /^Lila/ }).count()) === 1);
  await pop.getByRole("button", { name: "Farben anpassen …" }).click();
  const dlg = page.getByRole("dialog", { name: "Markerfarben anpassen" });
  await dlg.waitFor({ timeout: 4000 });
  const rows = dlg.getByRole("listitem");
  check("Dialog mit 7 Farben", (await rows.count()) === 7);
  // Gelb → kräftiges Gelb „Definition“
  await rows.nth(0).getByLabel("Bedeutung").fill("Definition");
  await rows.nth(0).getByRole("button", { name: "Farbe #ffe066" }).click();
  // eigene Farbe „Problem“
  await dlg.getByRole("button", { name: "Farbe hinzufügen" }).click();
  await rows.nth(7).getByLabel("Bedeutung").fill("Problem");
  await rows.nth(7).getByLabel(/^Farbe für/).fill("#ff8787");
  await shot("markerfarben-1-dialog");
  await dlg.getByRole("button", { name: "Speichern" }).click();
  await dlg.waitFor({ state: "hidden", timeout: 4000 });
  await waitFor(async () => (await bg(stich)) === "rgb(255, 224, 102)");
  check("Vorhandene Markierung folgt der neuen Farbe", (await bg(stich)) === "rgb(255, 224, 102)", await bg(stich));
  const setting = (await call("settingsAll"))["editor.highlights"];
  check("Gespeichert (nur Abweichungen + eigene Farbe)", JSON.stringify(setting?.slots?.map((s) => [s.slot, s.color, s.label])) === JSON.stringify([["1", "#ffe066", "Definition"], ["8", "#ff8787", "Problem"]]), JSON.stringify(setting));

  // 2. Neue Farbe verwenden
  await editor.locator("p").click();
  await page.keyboard.press("End");
  await page.keyboard.down("Shift");
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Shift");
  await tb.getByRole("button", { name: /^Hervorheben/ }).click();
  await pop.getByRole("button", { name: /^Problem/ }).click();
  const prob = editor.locator('mark[data-hl="8"]');
  await prob.waitFor({ timeout: 3000 });
  check("Eigene Farbe „Problem“ markiert", (await bg(prob)) === "rgb(255, 135, 135)" && (await prob.getAttribute("title")) === "Problem", await bg(prob));
  let saved = "";
  for (let i = 0; i < 30; i++) {
    saved = (await call("noteGet", id)).content_json;
    if (saved.includes('"slot":"8"')) break;
    await sleep(200);
  }
  check("Gespeichert mit Platz", saved.includes('"color":"#ff8787","slot":"8"') || saved.includes('"slot":"8"'), saved.slice(0, 400));
  await shot("markerfarben-2-hell");

  // 3. Dunkler Modus: Schrift auf der Markierung gut lesbar
  await page.emulateMedia({ colorScheme: "dark" });
  await sleep(300);
  const h = editor.locator("mark", { hasText: "H" }).first();
  const dark = await h.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color, bar: getComputedStyle(el).boxShadow }));
  const k = contrast(dark.bg, dark.fg);
  check("Dunkel: Kontrast Schrift/Markierung mindestens 4,5:1", k >= 4.5, `${k.toFixed(2)} ${JSON.stringify(dark)}`);
  check("Dunkel: Farbe als Strich erkennbar", /inset/.test(dark.bar), dark.bar);
  for (const loc of [stich, prob]) {
    const d = await loc.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }));
    check(`Dunkel: lesbar (${await loc.innerText()})`, contrast(d.bg, d.fg) >= 4.5, `${contrast(d.bg, d.fg).toFixed(2)} ${JSON.stringify(d)}`);
  }
  await shot("markerfarben-3-dunkel");
  await page.emulateMedia({ colorScheme: "light" });

  // 4. Nach dem Neuladen bleiben die Farben
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.locator(".tree-row", { hasText: "BGB AT" }).click();
  await page.locator("main.primary").getByText("Fall Hieb").click();
  await editor.waitFor();
  await waitFor(async () => (await bg(editor.locator("mark", { hasText: "Stich" }))) === "rgb(255, 224, 102)");
  check("Nach Neuladen: angepasste Farben", (await bg(editor.locator("mark", { hasText: "Stich" }))) === "rgb(255, 224, 102)" && (await bg(editor.locator('mark[data-hl="8"]'))) === "rgb(255, 135, 135)");
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.stack ?? e.message);
  await shot("markerfarben-abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
