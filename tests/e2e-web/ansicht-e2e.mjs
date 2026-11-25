// End-to-End-Test: iPad – verschiebt iPadOS beim Tippen Rahmen der App (oben abgeschnitten,
// unten leer), setzt die App sie zurück; der Textbereich selbst bleibt, wo er ist.
//
// Aufruf: node tests/e2e-web/ansicht-e2e.mjs   (nach npm run build:web)
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
const PORT = 4211;

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
// E2E_SLOW=4: langsameren Rechner nachbilden (wie in der Cloud)
if (process.env.E2E_SLOW) await (await ctx.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.E2E_SLOW) });
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
  const area = (await call("areasList"))[0];
  const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
  const content = JSON.stringify({ type: "doc", content: Array.from({ length: 60 }, (_, i) => para(`${i + 1}. A sticht B mit einem Messer in den Arm.`)) });
  await call("nodeCreate", { area_id: area.id, parent_id: null, kind: "note", title: "Fall 2 Krankenwagen", content_json: content });
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.locator(".tree-row", { hasText: "Fall 2 Krankenwagen" }).first().click();
  await page.locator(".ProseMirror").first().waitFor({ timeout: 10000 });
  const geo = () =>
    page.evaluate(() => ({
      topbar: Math.round(document.querySelector(".shell-main .topbar").getBoundingClientRect().top),
      foot: Math.round(document.querySelector(".note-foot").getBoundingClientRect().bottom),
      h: window.innerHeight,
      primary: document.querySelector(".primary").scrollTop,
      win: window.scrollY,
    }));
  const before = await geo();
  check("Ausgangslage: Leiste oben, Fußzeile unten", before.topbar === 0 && Math.abs(before.foot - before.h) <= 2, JSON.stringify(before));

  // Wie iPadOS beim Tippen: den (nicht scrollbaren) Rahmen nach oben schieben
  await page.evaluate(() => {
    const p = document.querySelector(".primary");
    const extra = document.createElement("div");
    extra.id = "__extra";
    extra.style.height = "1200px";
    p.appendChild(extra); // erst dann lässt er sich überhaupt verschieben
    p.scrollTop = 400;
  });
  await sleep(200);
  const after = await geo();
  check("Verschobener Rahmen wird sofort zurückgesetzt", after.primary === 0 && after.topbar === 0, JSON.stringify(after));

  // mehrfach hintereinander (früher: immer schlimmer)
  for (let i = 0; i < 5; i++) {
    await page.evaluate((i) => (document.querySelector(".primary").scrollTop = 100 * (i + 1)), i);
    await sleep(60);
  }
  await sleep(200);
  const many = await geo();
  check("Auch nach mehrfachem Verschieben nichts übrig", many.primary === 0 && many.topbar === 0, JSON.stringify(many));
  await page.evaluate(() => document.getElementById("__extra").remove());

  // Fenster verschoben (z. B. nach dem Zurückkehren in die App)
  await page.evaluate(() => {
    document.body.style.overflow = "visible";
    const extra = document.createElement("div");
    extra.id = "__tall";
    extra.style.height = "3000px";
    document.body.appendChild(extra);
    window.scrollTo(0, 500);
  });
  await sleep(200);
  check("Verschobenes Fenster wird zurückgesetzt", (await page.evaluate(() => window.scrollY)) === 0);
  await page.evaluate(() => {
    document.getElementById("__tall").remove();
    document.body.style.overflow = "";
  });

  // Der Text selbst scrollt weiterhin normal
  await page.locator(".note-scroll").evaluate((e) => (e.scrollTop = 600));
  await sleep(250);
  const s = await page.locator(".note-scroll").evaluate((e) => e.scrollTop);
  check("Textbereich bleibt gescrollt", s >= 590, String(s));
  // Tippen am Ende: Schreibstelle bleibt mit Abstand über dem unteren Rand
  await page.locator(".ProseMirror p").last().click();
  await page.keyboard.press("End");
  for (let i = 0; i < 4; i++) await page.keyboard.press("Enter");
  await page.keyboard.type("A könnte sich gem. § 212 I StGB strafbar gemacht haben.");
  await sleep(300);
  const caret = await page.evaluate(() => {
    const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
    const sc = document.querySelector(".note-scroll").getBoundingClientRect();
    return { caret: Math.round(r.bottom), bottom: Math.round(sc.bottom) };
  });
  check("Schreibstelle sichtbar, mit Abstand zum unteren Rand", caret.caret <= caret.bottom - 60, JSON.stringify(caret));
  // Zeilenwechsel am unteren Rand: nur der Textbereich scrollt, die Rahmen und das Fenster nie
  await page.evaluate(() => {
    window.__frameScrolls = 0;
    window.__textScroll = [];
    document.addEventListener("scroll", (e) => {
      const t = e.target;
      if (t === document || (t instanceof Element && t.matches(".primary, .shell-main, .note, .workspace, #root, body, html"))) window.__frameScrolls++;
      if (t instanceof Element && t.classList.contains("note-scroll")) window.__textScroll.push(t.scrollTop);
    }, true);
  });
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Enter");
    await page.keyboard.type(`Zeile ${i + 1} am unteren Rand.`);
  }
  await sleep(300);
  const wob = await page.evaluate(() => {
    const ts = window.__textScroll;
    let back = 0;
    for (let i = 1; i < ts.length; i++) if (ts[i] < ts[i - 1] - 1) back++;
    const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
    const sc = document.querySelector(".note-scroll").getBoundingClientRect();
    return { frames: window.__frameScrolls, back, n: ts.length, gap: Math.round(sc.bottom - r.bottom) };
  });
  check("Zeilenwechsel: kein Wackeln (Rahmen/Fenster unbewegt, Text scrollt nur vorwärts)", wob.frames === 0 && wob.back === 0 && wob.n > 0, JSON.stringify(wob));
  check("Schreibstelle bleibt über dem unteren Rand", wob.gap >= 60, JSON.stringify(wob));
  const end = await geo();
  check("Leiste und Fußzeile nach dem Tippen an ihrem Platz", end.topbar === 0 && Math.abs(end.foot - end.h) <= 2 && end.primary === 0, JSON.stringify(end));
  await page.screenshot({ path: path.join(OUT, "ansicht-1.png") });
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
