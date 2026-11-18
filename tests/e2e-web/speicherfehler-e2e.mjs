// End-to-End-Test: Speicherfehler – der Stand bleibt als Notfall-Entwurf auf dem Gerät und lässt
// sich nach einem Neustart der App wiederherstellen; nach erfolgreichem Speichern ist er weg.
//
// Aufruf: node tests/e2e-web/speicherfehler-e2e.mjs   (nach npm run build:web)
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
const PORT = 4210;

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
  const doc = (t) => JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
  const n = await call("nodeCreate", { area_id: area.id, parent_id: null, kind: "note", title: "Fall 4 PÜ StGB", content_json: doc("Jürgen wirft das Glas.") });
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  const openNote = async () => {
    await page.locator(".tree-row", { hasText: "Fall 4 PÜ StGB" }).first().click();
    await page.locator(".ProseMirror").first().waitFor({ timeout: 10000 });
  };
  await openNote();

  // 1. Speichern scheitert (wie der Datenbankfehler auf dem iPad)
  await page.evaluate(() => {
    const api = window.__STUDIUM_API__;
    window.__origSave = api.noteSave;
    api.noteSave = () => Promise.reject(new Error("Datenbankfehler: SQLITE_IOERR"));
  });
  await page.locator(".ProseMirror p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Enno schreit vor Schmerz auf.");
  await page.getByText(/Nicht gespeichert/).first().waitFor({ timeout: 8000 });
  const draft = await page.evaluate((id) => localStorage.getItem(`studium.draft.${id}`), n.id);
  check("Fehlgeschlagenes Speichern: Entwurf auf dem Gerät", !!draft && draft.includes("Enno schreit"));
  await page.keyboard.type(" Hämatom.");
  await sleep(1500);
  const draft2 = await page.evaluate((id) => localStorage.getItem(`studium.draft.${id}`), n.id);
  check("Weitertippen hält den Entwurf aktuell", !!draft2 && draft2.includes("Hämatom."));

  // 2. Neustart der App (der Fehler ist danach weg) → Wiederherstellen
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  check("Datenbank hat noch den alten Stand", !(await call("noteGet", n.id)).content_json.includes("Enno"));
  await openNote();
  const banner = page.locator(".draft-banner");
  await banner.waitFor({ timeout: 8000 });
  await shot("speicherfehler-1-entwurf");
  check("Hinweis: ungespeicherte Änderungen gefunden", (await banner.innerText()).includes("Ungespeicherte Änderungen gefunden"));
  await banner.getByRole("button", { name: "Wiederherstellen" }).click();
  await waitFor(async () => (await call("noteGet", n.id)).content_json.includes("Hämatom."), 8000);
  check("Wiederhergestellt und gespeichert", (await call("noteGet", n.id)).content_json.includes("Enno schreit vor Schmerz auf. Hämatom."));
  check("Text im Editor", (await page.locator(".ProseMirror").first().innerText()).includes("Hämatom."));
  await waitFor(async () => !(await page.evaluate((id) => localStorage.getItem(`studium.draft.${id}`), n.id)));
  check("Entwurf nach dem Speichern gelöscht", !(await page.evaluate((id) => localStorage.getItem(`studium.draft.${id}`), n.id)));

  // 3. „Erneut versuchen“ nach vorübergehendem Fehler: Entwurf verschwindet, kein Hinweis beim nächsten Öffnen
  await page.evaluate(() => {
    const api = window.__STUDIUM_API__;
    window.__origSave = api.noteSave;
    api.noteSave = () => Promise.reject(new Error("Datenbankfehler: SQLITE_BUSY"));
  });
  await page.locator(".ProseMirror p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Scherben.");
  await page.getByText(/Nicht gespeichert/).first().waitFor({ timeout: 8000 });
  await page.evaluate(() => (window.__STUDIUM_API__.noteSave = window.__origSave));
  await page.getByRole("button", { name: "Erneut versuchen" }).first().click();
  await waitFor(async () => (await call("noteGet", n.id)).content_json.includes("Scherben."), 8000);
  check("Erneut versuchen speichert", (await call("noteGet", n.id)).content_json.includes("Scherben."));
  check("… und löscht den Entwurf", !(await page.evaluate((id) => localStorage.getItem(`studium.draft.${id}`), n.id)));
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await openNote();
  await sleep(800);
  check("Kein Hinweis, wenn alles gespeichert ist", (await page.locator(".draft-banner").count()) === 0);
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.stack ?? e.message);
  await shot("speicherfehler-abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
