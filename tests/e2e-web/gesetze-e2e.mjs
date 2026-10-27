// End-to-End-Test: mitgelieferte Gesetze (StGB, BGB) – Einrichtung, Ersatz unvollständiger Fassungen, Wortlaut-Fenster.
// iPad quer.
//
// Aufruf: node tests/e2e-web/gesetze-e2e.mjs   (nach npm run build:web)
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
const PORT = 4190;

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
    const text = "Der Versuch ist in § 23 geregelt. Zivilrechtlich gilt § 34 BGB.";
    await api.nodeCreate({ area_id: area.id, parent_id: c.id, kind: "note", title: "3. Vorlesung", content_json: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }), plain_text: text });
    // so sah ein BGB-Import mit einer älteren Version aus: nur 20 Paragraphen
    await api.legalSourceSave({ kind: "gesetz", title: "Bürgerliches Gesetzbuch", abbreviation: "BGB", origin: "BGB.pdf" }, Array.from({ length: 20 }, (_, i) => ({ norm: `§ ${600 + i}`, absatz: null, heading: "", text: "…" })));
  });

  // Neustart mit der neuen Version (Einrichtung im Testmodus nur mit ?gesetze)
  await page.goto(`http://127.0.0.1:${PORT}/?e2e&gesetze`);
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  const toasts = await waitFor(async () => {
    const t = await page.locator(".toast").allInnerTexts();
    return t.length >= 2 ? t : null;
  }, 30000);
  check("StGB eingerichtet, unvollständiges BGB ersetzt (Hinweise)", !!toasts && toasts.some((t) => t.startsWith("StGB ist eingerichtet")) && toasts.some((t) => t.startsWith("BGB war unvollständig")), String(toasts));
  const srcs = await call("legalSourcesList");
  const bgb = srcs.filter((s) => s.abbreviation === "BGB");
  check("Genau ein BGB, vollständig", bgb.length === 1 && bgb[0].chunk_count > 5000, JSON.stringify(srcs.map((s) => [s.abbreviation, s.chunk_count])));

  // Wortlaut-Fenster: § 23 (StGB aus dem Titel „Strafrecht AT“) mit beiden Knöpfen
  await page.locator("main.primary").getByText("3. Vorlesung").first().click();
  const refs = page.locator(".ProseMirror .norm-ref");
  await waitFor(async () => (await refs.count()) === 2);
  check("Beide Paragraphen in der Mitschrift erkannt", (await refs.count()) === 2);
  await refs.first().click();
  const pop = page.locator(".norm-pop");
  await pop.locator(".norm-pop-text").waitFor({ timeout: 8000 });
  const pt = await pop.innerText();
  check("§ 23 StGB: Wortlaut mit drei Absätzen", pt.includes("§ 23 StGB") && (await pop.locator(".norm-pop-text p").count()) === 3 && pt.includes("Der Versuch eines Verbrechens ist stets strafbar"), pt.slice(0, 200));
  check("Fenster hat „Kopieren“ und „In Mitschrift einfügen“", (await pop.getByRole("button", { name: "Kopieren" }).count()) === 1 && (await pop.getByRole("button", { name: "In Mitschrift einfügen" }).count()) === 1);
  await pop.getByRole("button", { name: "Schließen" }).click();
  await refs.nth(1).click();
  await pop.locator(".norm-pop-text").waitFor({ timeout: 8000 });
  check("§ 34 BGB gefunden", (await pop.innerText()).includes("Ein Mitglied ist nicht stimmberechtigt"));
  await page.keyboard.press("Escape");

  // Suche „§33 BGB“ (früher fehlend: „Satzungsänderung“)
  await page.locator(".side-search").click();
  await page.locator(".palette-input input").fill("§33 BGB");
  const item = page.locator(".palette-item", { hasText: "§ 33 BGB" });
  await item.waitFor({ timeout: 8000 });
  check("Suche findet § 33 BGB – Satzungsänderung", (await item.innerText()).includes("Satzungsänderung"));
  await page.keyboard.press("Escape");

  // Rechtsquellen zeigen Stand und Vollständigkeit
  await page.getByRole("button", { name: "KI-Assistent", exact: true }).click();
  await page.getByLabel(/Ich habe das gelesen/).check();
  await page.getByRole("button", { name: "Einschalten" }).click();
  await page.getByRole("tab", { name: /Rechtsquellen/ }).click();
  const box = page.locator(".bundled-laws");
  await box.waitFor({ timeout: 8000 });
  const bt = (await waitFor(async () => {
    const t = await box.innerText();
    return (t.match(/Paragraphen · vollständig/g) ?? []).length === 2 ? t : null;
  }, 10000)) ?? (await box.innerText());
  check("Rechtsquellen: StGB und BGB vollständig, mit Stand", (bt.match(/Paragraphen · vollständig/g) ?? []).length === 2 && !bt.includes("unvollständig") && bt.includes("Stand laut Quelle"), bt);
  await shot("gesetze-rechtsquellen");

  // Version in den Einstellungen
  await page.locator("nav, aside").getByText("Einstellungen & Backup").click();
  check("Einstellungen zeigen die App-Version", /Version \d+\.\d+\.\d+/.test(await page.locator("h1").first().innerText()));
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.message);
  await shot("gesetze-abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
