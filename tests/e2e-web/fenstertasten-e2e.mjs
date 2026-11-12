// End-to-End-Test: iPadOS 26 – als App vom Home-Bildschirm bleibt oben ein Streifen für die
// Fenstertasten (● ● ●) und den Weichzeichner frei; im Browser nicht. Einstellbar.
//
// Aufruf: node tests/e2e-web/fenstertasten-e2e.mjs   (nach npm run build:web)
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
const PORT = 4209;

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
const IPAD_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const errors = [];

async function open(standalone, width = 700) {
  const ctx = await browser.newContext({ viewport: { width, height: 820 }, deviceScaleFactor: 2, hasTouch: true, userAgent: IPAD_UA });
  await ctx.addInitScript((sa) => {
    Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
    Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });
    if (sa) Object.defineProperty(navigator, "standalone", { get: () => true });
  }, standalone);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  return { ctx, page };
}
// alle sichtbaren Knöpfe, die in den Streifen oben (Fenstertasten, Weichzeichner) ragen
const inBand = (page, h) =>
  page.evaluate((h) => [...document.querySelectorAll("button, a, input, select, [role=button]")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < h && getComputedStyle(e).visibility !== "hidden"; }).map((e) => e.getAttribute("aria-label") || e.textContent.trim().slice(0, 20)), h);
const topOf = (page, sel) => page.locator(sel).first().evaluate((e) => Math.round(e.getBoundingClientRect().top));

try {
  // 1. Im Safari-Tab: kein Streifen
  const tab = await open(false);
  check("Im Browser beginnt die obere Leiste ganz oben", (await topOf(tab.page, ".shell-main .topbar")) === 0);
  await tab.ctx.close();

  // 2. Als App vom Home-Bildschirm (schmales Fenster wie in der geteilten Ansicht)
  const app = await open(true);
  const page = app.page;
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const t = await topOf(page, ".shell-main .topbar");
  check("Als App: obere Leiste unter dem Streifen für die Fenstertasten", t === 46, String(t));
  const band = await inBand(page, 46);
  check("Kein Knopf im Streifen (Fenstertasten, Weichzeichner)", band.length === 0, band.join(", "));
  // Seitenleiste ein/aus und Pfeile liegen darunter
  for (const name of ["Zurück", "Vor"]) {
    const b = page.getByRole("button", { name, exact: true }).first();
    if (await b.count()) check(`„${name}“ unterhalb des Streifens`, (await b.evaluate((e) => e.getBoundingClientRect().top)) >= 46);
  }
  await shot("fenster-1-app");

  // Dialoge ebenfalls unterhalb
  await page.getByRole("button", { name: "Einstellungen & Backup" }).click();
  const slider = page.getByLabel("Abstand oben in Pixeln");
  await slider.waitFor({ timeout: 5000 });
  check("Einstellung zeigt „Automatisch“ mit 46 px", (await slider.inputValue()) === "46" && (await page.getByText("(46 px)").count()) === 1);
  // von Hand verkleinern
  await slider.fill("0");
  await page.waitForFunction(() => Math.round(document.querySelector(".shell-main .topbar").getBoundingClientRect().top) === 0, null, { timeout: 5000 });
  check("Von Hand auf 0 px", (await topOf(page, ".shell-main .topbar")) === 0);
  await page.getByRole("button", { name: "Automatisch", exact: true }).click();
  await page.waitForFunction(() => Math.round(document.querySelector(".shell-main .topbar").getBoundingClientRect().top) === 46, null, { timeout: 5000 });
  check("„Automatisch“ stellt den Streifen wieder her", (await topOf(page, ".shell-main .topbar")) === 46);
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  check("Nach dem Neuladen weiterhin frei", (await topOf(page, ".shell-main .topbar")) === 46);
  await app.ctx.close();

  // 3. Breites Fenster (Vollbild): ebenfalls frei, Seitenleiste auch
  const wide = await open(true, 1180);
  const side = await topOf(wide.page, ".shell-side > *");
  check("Vollbild: Seitenleiste und Hauptbereich unter dem Streifen", (await topOf(wide.page, ".shell-main .topbar")) === 46 && side >= 46, String(side));
  const band2 = await inBand(wide.page, 46);
  check("Vollbild: kein Knopf im Streifen", band2.length === 0, band2.join(", "));
  await wide.page.screenshot({ path: path.join(OUT, "fenster-2-vollbild.png") });
  await wide.ctx.close();
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.stack ?? e.message);
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
