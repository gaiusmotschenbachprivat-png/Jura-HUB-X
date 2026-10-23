// End-to-End-Test: Gliederung oben antippen → Sprung zur Stelle in der langen
// Mitschrift, fehlende Stelle anlegen, „zurück zur Gliederung“ (iPad-Größe).
//
// Aufruf: node tests/e2e-web/gliederung-e2e.mjs   (nach npm run build:web)
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
const PORT = 4187;

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

const T = (text) => ({ type: "text", text });
const P = (text) => ({ type: "paragraph", content: text ? [T(text)] : [] });
const H = (level, text) => ({ type: "heading", attrs: { level }, content: [T(text)] });
const LI = (text) => ({ type: "listItem", content: [P(text)] });
const filler = (n, what) => Array.from({ length: n }, (_, i) => P(`${what}: Absatz ${i + 1} mit ausführlicher Mitschrift aus der Vorlesung, damit der Text lang wird.`));
const DOC = {
  type: "doc",
  content: [
    H(1, "5. Vorlesung"),
    H(2, "Gliederung"),
    { type: "orderedList", attrs: { start: 1 }, content: [LI("Erklärung StGB"), LI("Tatbestand"), LI("Rechtswidrigkeit"), LI("Schuld"), LI("Strafzumessung")] },
    H(2, "Mitschrift"),
    H(3, "1. Erklärung StGB"),
    ...filler(12, "Einleitung"),
    P("Tatbestand: objektiv und subjektiv"),
    ...filler(12, "Tatbestand"),
    H(3, "Rechtswidrigkeit"),
    ...filler(12, "Rechtfertigung"),
    P("4. Schuld – Vorwerfbarkeit"),
    ...filler(12, "Schuld"),
    H(2, "Offene Fragen"),
    P(""),
  ],
};
const noteJson = async (id) => (await call("noteGet", id)).content_json;

try {
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  const id = await page.evaluate(async (doc) => {
    const api = window.__STUDIUM_API__;
    const area = (await api.areasList())[0];
    const c = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "Strafrecht AT" });
    return (await api.nodeCreate({ area_id: area.id, parent_id: c.id, kind: "note", title: "5. Vorlesung", content_json: JSON.stringify(doc), meta: { noteType: "vorlesung", number: 5 } })).id;
  }, DOC);
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.locator(".tree-row", { hasText: "Strafrecht AT" }).click();
  await page.locator("main.primary").getByText("5. Vorlesung").click();
  await page.locator(".ProseMirror").waitFor();

  // 1. Symbole an jedem Gliederungspunkt
  const jumps = page.locator(".ProseMirror .outline-jump");
  await jumps.first().waitFor();
  check("Jeder Gliederungspunkt hat ein Sprung-Symbol", (await jumps.count()) === 5);
  check("Zugeordnet: 4 von 5 (Strafzumessung fehlt noch)", (await page.locator(".outline-jump.has-target").count()) === 4 && (await page.locator(".outline-jump.is-new").count()) === 1);
  await shot("gliederung-1-oben");

  // 2. Punkt 4 antippen → weit unten in der Mitschrift
  const scroller = page.locator("main.primary .note-scroll");
  const before = await scroller.evaluate((e) => e.scrollTop);
  await page.getByRole("button", { name: "Zu „Schuld“ springen" }).click();
  await page.waitForTimeout(900);
  const after = await scroller.evaluate((e) => e.scrollTop);
  const target = page.locator(".ProseMirror p", { hasText: "4. Schuld – Vorwerfbarkeit" });
  const tb = await target.boundingBox();
  const vp = await scroller.boundingBox();
  check("Sprung: weit nach unten gescrollt", after > before + 800, `${before} → ${after}`);
  check("Ziel ist sichtbar", tb && tb.y >= vp.y - 2 && tb.y < vp.y + vp.height, JSON.stringify({ tb, vp }));
  check("Cursor steht an der Stelle", await page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.closest("p")?.textContent?.startsWith("4. Schuld")));
  await shot("gliederung-2-sprung");

  // 3. Zurück zur Gliederung
  await page.getByRole("button", { name: "↑ Zurück zur Gliederung" }).click();
  await page.waitForTimeout(900);
  const outlineBox = await page.locator(".ProseMirror ol").first().boundingBox();
  check("Zurück: Gliederung wieder sichtbar", outlineBox && outlineBox.y >= vp.y - 40 && outlineBox.y < vp.y + vp.height);

  // 4. Fehlende Stelle anlegen
  await page.getByRole("button", { name: "Abschnitt „Strafzumessung“ in der Mitschrift anlegen" }).click();
  await page.waitForTimeout(500);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Strafrahmen und Zumessung nach § 46 StGB.");
  let saved = "";
  for (let i = 0; i < 30; i++) {
    saved = await noteJson(id);
    if (saved.includes("Strafrahmen")) break;
    await sleep(200);
  }
  const doc = JSON.parse(saved);
  const titles = doc.content.map((n) => (n.content ?? []).map((c) => c.text ?? "").join(""));
  const at = titles.indexOf("Strafzumessung");
  check("Neue Überschrift am Ende der Mitschrift, vor „Offene Fragen“", at > 0 && doc.content[at].type === "heading" && doc.content[at].attrs.level === 3 && titles.indexOf("Offene Fragen") > at, titles.slice(-5).join(" | "));
  check("Direkt darunter weitergeschrieben", titles[at + 1]?.includes("Strafrahmen"));
  check("Jetzt alle 5 Punkte zugeordnet", (await page.locator(".outline-jump.has-target").count()) === 5);
  check("Sprung-Symbole werden nicht gespeichert", !saved.includes("outline-jump") && !saved.includes("↓"));

  // 5. Gliederungspunkt umbenennen und neu tippen bleibt möglich
  await page.locator(".ProseMirror ol li", { hasText: "Tatbestand" }).first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" (objektiv)");
  check("Gliederung bleibt editierbar", (await page.locator(".ProseMirror ol li").nth(1).innerText()).includes("Tatbestand (objektiv)"));
  check("Zuordnung über den Anfang bleibt", (await page.locator('.outline-jump[aria-label*="Tatbestand (objektiv)"]').getAttribute("class")).includes("has-target"));

  // 6. Auch im Lesemodus
  await page.getByRole("button", { name: "Lesemodus" }).click();
  await page.getByRole("button", { name: "Zu „Rechtswidrigkeit“ springen" }).click();
  await page.waitForTimeout(900);
  const rw = await page.locator(".ProseMirror h3", { hasText: "Rechtswidrigkeit" }).boundingBox();
  const vp2 = await page.locator("main.primary .note-scroll").boundingBox();
  check("Sprung funktioniert im Lesemodus", rw && rw.y >= vp2.y - 2 && rw.y < vp2.y + vp2.height);
  check("Lesemodus legt nichts an", (await page.locator(".ProseMirror").getAttribute("contenteditable")) === "false");
  await page.getByRole("button", { name: "Bearbeiten" }).click();
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Ablauf ohne Ausnahme", false, e.stack ?? String(e));
  await shot("gliederung-fehler").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
process.exit(failed.length ? 1 : 0);
