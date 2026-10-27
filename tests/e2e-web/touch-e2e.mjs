// End-to-End-Test: iPad-Bedienung ohne Hover – Knöpfe bleiben nach dem Antippen nicht hinterlegt.
// iPad quer.
//
// Aufruf: node tests/e2e-web/touch-e2e.mjs   (nach npm run build:web)
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
const PORT = 4194;

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
  // iPad nachstellen: kein Hover, grober Zeiger
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "none" }, { name: "any-hover", value: "none" }, { name: "pointer", value: "coarse" }] });
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  check("Emulation aktiv (kein Hover)", await page.evaluate(() => matchMedia("(hover: none)").matches));
  await page.evaluate(async () => {
    const api = window.__STUDIUM_API__;
    const area = (await api.areasList())[0];
    await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "note", title: "Mitschrift" });
  });
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.locator(".tree-row", { hasText: "Mitschrift" }).first().click();
  const editor = page.locator(".ProseMirror");
  await editor.waitFor();
  await editor.click();
  const bold = page.getByRole("button", { name: /^Fett/ });
  const bg = () => bold.evaluate((b) => getComputedStyle(b).backgroundColor);
  const idle = await bg();
  await bold.click(); // Maus bleibt über dem Knopf liegen – wie der Finger nach dem Antippen
  const on = await bg();
  check("Fett an: Knopf hinterlegt", (await bold.getAttribute("class")).includes("is-active") && on !== idle, `${idle} → ${on}`);
  await page.keyboard.type("fett ");
  await bold.click();
  const off = await bg();
  check("Fett aus: Knopf sofort nicht mehr hinterlegt (ohne Scrollen)", !(await bold.getAttribute("class")).includes("is-active") && off === idle, `${on} → ${off}`);
  await page.keyboard.type("normal");
  const html = await editor.innerHTML();
  check("Text: „fett“ fett, „normal“ nicht", /<strong>fett ?<\/strong>/.test(html) && !/<strong>[^<]*normal/.test(html), html.slice(0, 200));
  const italic = page.getByRole("button", { name: /^Kursiv/ });
  await italic.click();
  await italic.click();
  check("Kursiv an/aus: nicht hinterlegt", (await italic.evaluate((b) => getComputedStyle(b).backgroundColor)) === idle);
  check("Ohne Maus sichtbar: „+“ in der Seitenleiste", (await page.locator(".side-add").first().evaluate((e) => getComputedStyle(e).opacity)) === "1");
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.message);
  await shot("touch-abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
