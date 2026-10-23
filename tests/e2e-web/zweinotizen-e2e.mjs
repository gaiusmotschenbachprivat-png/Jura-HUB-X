// End-to-End-Test: zwei Mitschriften nebeneinander ansehen und bearbeiten
// (iPad quer nebeneinander, hochkant untereinander), tauschen, Kontextmenü.
//
// Aufruf: node tests/e2e-web/zweinotizen-e2e.mjs   (nach npm run build:web)
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
const PORT = 4186;

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

const para = (text) => JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const noteText = async (id) => JSON.parse((await call("noteGet", id)).content_json).content.map((p) => (p.content ?? []).map((t) => t.text).join("")).join("\n");

try {
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  const ids = await page.evaluate(async (docs) => {
    const api = window.__STUDIUM_API__;
    const area = (await api.areasList())[0];
    const c = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "BGB AT" });
    const s = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "Strafrecht" });
    const out = { course: c.id };
    for (const [i, d] of docs.entries())
      out[`v${i + 1}`] = (await api.nodeCreate({ area_id: area.id, parent_id: c.id, kind: "note", title: `${i + 1}. Vorlesung`, content_json: d, meta: { noteType: "vorlesung", number: i + 1 } })).id;
    out.str = (await api.nodeCreate({ area_id: area.id, parent_id: s.id, kind: "note", title: "Vorsatz", content_json: docs[0] })).id;
    return out;
  }, [para("Willenserklärung"), para("Anfechtung"), para("Stellvertretung")]);
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });

  // 1. Zweite Notiz über den Knopf im Notizkopf
  await page.locator(".tree-row", { hasText: "BGB AT" }).click();
  await page.locator("main.primary").getByText("2. Vorlesung").click();
  await page.locator(".ProseMirror").waitFor();
  await page.getByRole("button", { name: "Zweite Notiz daneben öffnen" }).click();
  const dlg = page.getByRole("dialog", { name: "Zweite Notiz daneben öffnen" });
  await dlg.waitFor();
  const dt = await dlg.innerText();
  check("Auswahl: zuerst die Vorlesungen derselben Veranstaltung", /ebenfalls in bgb at/i.test(dt) && dt.indexOf("1. Vorlesung") < dt.indexOf("3. Vorlesung") && dt.indexOf("3. Vorlesung") < dt.indexOf("Vorsatz") && !dt.includes("2. Vorlesung"), dt.replace(/\n/g, " | "));
  await dlg.locator(".slide-pick", { hasText: "1. Vorlesung" }).click();
  const side = page.locator("section.secondary");
  await side.locator(".ProseMirror").waitFor();
  check("Zweite Notiz rechts geöffnet", (await side.locator(".note-title").inputValue()) === "1. Vorlesung");
  const [pb, sb] = [await page.locator("main.primary").boundingBox(), await side.boundingBox()];
  check("iPad quer: nebeneinander", sb.x > pb.x + 300 && Math.abs(sb.y - pb.y) < 4, JSON.stringify({ pb, sb }));
  await shot("zwei-1-nebeneinander");

  // 2. Beide bearbeiten
  await side.locator(".ProseMirror").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" – Ergänzung rechts");
  await page.locator("main.primary .ProseMirror").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" – Ergänzung links");
  await page.locator("main.primary").getByRole("button", { name: "Weitere Aktionen" }).waitFor();
  let ok1 = false;
  for (let i = 0; i < 40 && !ok1; i++) {
    ok1 = (await noteText(ids.v1)).includes("Ergänzung rechts") && (await noteText(ids.v2)).includes("Ergänzung links");
    if (!ok1) await sleep(200);
  }
  check("Beide Notizen bearbeitet und gespeichert", ok1, `${await noteText(ids.v1)} / ${await noteText(ids.v2)}`);
  check("Keine Vermischung", !(await noteText(ids.v1)).includes("links") && !(await noteText(ids.v2)).includes("rechts"));

  // 3. Tauschen
  await side.getByRole("button", { name: "Notizen tauschen" }).click();
  await page.waitForFunction(() => document.querySelector("main.primary .note-title")?.value === "1. Vorlesung");
  check("Tauschen: 1. Vorlesung links, 2. rechts", (await side.locator(".note-title").inputValue()) === "2. Vorlesung");
  check("Inhalte nach dem Tauschen erhalten", (await side.locator(".ProseMirror").innerText()).includes("Ergänzung links"));

  // 4. Hochkant: untereinander
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.waitForFunction(() => document.querySelector(".workspace")?.classList.contains("is-stacked"));
  const [pb2, sb2] = [await page.locator("main.primary").boundingBox(), await side.boundingBox()];
  check("iPad hochkant: untereinander", sb2.y + sb2.height <= pb2.y + 8, JSON.stringify({ pb2, sb2 }));
  await shot("zwei-2-untereinander");
  await side.getByRole("button", { name: "Nebeneinander anzeigen" }).click();
  await page.waitForFunction(() => !document.querySelector(".workspace")?.classList.contains("is-stacked"));
  check("Umschalten auf nebeneinander", true);
  await side.getByRole("button", { name: "Untereinander anzeigen" }).click();
  await page.setViewportSize({ width: 1180, height: 820 });

  // 5. Kontextmenü im Baum
  await page.locator(".tree-row", { hasText: "3. Vorlesung" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Neben der offenen Notiz öffnen" }).click();
  await page.waitForFunction(() => document.querySelector("section.secondary .note-title")?.value === "3. Vorlesung");
  check("Kontextmenü öffnet daneben", true);

  // 6. Dieselbe Notiz nie doppelt
  await page.locator(".tree-row", { hasText: "3. Vorlesung" }).click();
  await page.waitForFunction(() => document.querySelector("main.primary .note-title")?.value === "3. Vorlesung");
  check("Gleiche Notiz links: rechte Hälfte wird ausgeblendet", (await page.locator("section.secondary").count()) === 0 && (await page.locator(".ProseMirror").count()) === 1);

  // 7. Schließen
  await page.locator(".tree-row", { hasText: "2. Vorlesung" }).click();
  await side.locator(".ProseMirror").waitFor();
  check("Zweite Notiz erscheint wieder", (await side.locator(".note-title").inputValue()) === "3. Vorlesung");
  await side.getByRole("button", { name: "Zweite Notiz schließen" }).click();
  check("Schließen", (await page.locator("section.secondary").count()) === 0);
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Ablauf ohne Ausnahme", false, e.stack ?? String(e));
  await shot("zwei-fehler").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
process.exit(failed.length ? 1 : 0);
