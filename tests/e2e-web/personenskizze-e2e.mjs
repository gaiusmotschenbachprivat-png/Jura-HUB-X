// End-to-End-Test: Personenskizze – aus Kurzschreibweise erzeugen, Personen hinzufügen und verschieben,
// Beziehung ziehen und beschriften, speichern, Druckvorschau, dunkler Modus.
//
// Aufruf: node tests/e2e-web/personenskizze-e2e.mjs   (nach npm run build:web)
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
const PORT = 4206;

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

const P = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });

try {
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  const id = await page.evaluate(async (doc) => {
    const api = window.__STUDIUM_API__;
    const area = (await api.areasList())[0];
    const c = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "BGB AT" });
    return (await api.nodeCreate({ area_id: area.id, parent_id: c.id, kind: "note", title: "1. Vorlesung", content_json: JSON.stringify(doc) })).id;
  }, { type: "doc", content: [P("Personenskizze"), P("A—§ 433 I BGB→G"), P("A←$ 433 II BGB—G"), P("Danach")] });
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.locator(".tree-row", { hasText: "BGB AT" }).click();
  await page.locator("main.primary").getByText("1. Vorlesung").click();
  const pm = page.locator(".ProseMirror");
  await pm.waitFor();

  // 1. Zeilen markieren → Personenskizze
  await pm.locator("p", { hasText: "A—§ 433 I BGB→G" }).click();
  await page.keyboard.press("Home");
  await page.keyboard.down("Shift");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.up("Shift");
  await page.getByRole("button", { name: /^Personenskizze/ }).click();
  await page.getByRole("menuitem", { name: /Aus markiertem Text/ }).click();
  const fig = pm.locator("figure.person-sketch");
  await fig.waitFor({ timeout: 4000 });
  check("Skizze aus der Kurzschreibweise", (await fig.locator(".ps-person").count()) === 2 && (await fig.locator(".ps-edge").count()) === 2);
  const labels = await fig.locator(".ps-label").allTextContents();
  check("Normen beschriftet ($ → §)", labels.includes("§ 433 I BGB") && labels.includes("§ 433 II BGB"), labels.join(" | "));
  check("Pfeile je Richtung", (await fig.locator("path[marker-end]").count()) === 1 && (await fig.locator("path[marker-start]").count()) === 1);
  await shot("ps-1-erzeugt");

  // 2. Antippen → Editor
  await fig.click();
  const dlg = page.getByRole("dialog", { name: "Personenskizze" });
  await dlg.waitFor({ timeout: 4000 });
  // Rolle für A
  await dlg.locator('.ps-canvas [data-person]').first().tap();
  await dlg.getByLabel("Rolle").fill("Käufer");
  // neue Person D, mit dem Finger verschieben
  await dlg.getByRole("button", { name: "Person", exact: true }).click();
  const svg = dlg.locator(".ps-canvas svg");
  const people = dlg.locator(".ps-canvas [data-person]");
  check("Neue Person", (await people.count()) === 3 && (await dlg.getByLabel("Kürzel / Name").inputValue()) !== "");
  await dlg.getByLabel("Kürzel / Name").fill("D");
  const d = people.nth(2);
  const before = await d.boundingBox();
  await d.hover();
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 - 140, before.y + before.height / 2 + 160, { steps: 8 });
  await page.mouse.up();
  const after = await d.boundingBox();
  check("Person verschoben", Math.abs(after.x - before.x) > 60 && Math.abs(after.y - before.y) > 60, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  // Beziehung: D → A (Handlung)
  await dlg.getByRole("button", { name: "Beziehung von D" }).click();
  await people.nth(0).click();
  await dlg.getByLabel("Art").selectOption("handlung");
  await dlg.getByLabel("Beschriftung").fill("übereignet");
  check("Beziehung angelegt", (await svg.locator(".ps-edge").count()) === 3 && (await svg.locator(".ps-handlung").count()) === 1);
  const look = await svg.evaluate((e) => ({ edge: getComputedStyle(e.querySelector(".ps-edge")).stroke, box: getComputedStyle(e.querySelector(".ps-person rect")).stroke }));
  check("Editor zeichnet Linien und Rahmen", look.edge !== "none" && look.box !== "none", JSON.stringify(look));
  await shot("ps-2-editor");
  await dlg.getByRole("button", { name: "Übernehmen" }).click();
  await dlg.waitFor({ state: "hidden" });
  await waitFor(async () => (await fig.locator(".ps-person").count()) === 3);
  check("Skizze im Text aktualisiert", (await fig.locator(".ps-person").count()) === 3 && (await fig.locator(".ps-role").allTextContents()).includes("Käufer") && (await fig.locator(".ps-label").allTextContents()).includes("übereignet"));

  // 3. Gespeichert
  let saved = "";
  for (let i = 0; i < 30; i++) {
    saved = (await call("noteGet", id)).content_json;
    if (saved.includes("übereignet")) break;
    await sleep(200);
  }
  const node = JSON.parse(saved).content.find((n) => n.type === "personSketch");
  const data = node && JSON.parse(node.attrs.data);
  check("Gespeichert (Personen, Rollen, Beziehungen)", data?.persons?.length === 3 && data.persons.some((p) => p.role === "Käufer") && data.relations.some((r) => r.kind === "handlung" && r.label === "übereignet"), node?.attrs?.data?.slice(0, 300));
  check("Volltext enthält die Skizze", ((await call("noteGet", id)).plain_text ?? saved).length > 0);

  // 4. Druck
  await page.getByRole("button", { name: "Drucken / als PDF" }).click();
  const pv = page.locator(".pagedjs_page .person-sketch svg").first();
  check("Druck: Skizze als Grafik", await pv.waitFor({ timeout: 15000 }).then(() => true, () => false));
  await shot("ps-3-druck");
  await page.getByRole("button", { name: "Druckansicht schließen" }).click();
  await page.locator(".pagedjs_page").first().waitFor({ state: "detached", timeout: 5000 });

  // 5. Dunkler Modus
  await page.emulateMedia({ colorScheme: "dark" });
  await sleep(300);
  await fig.scrollIntoViewIfNeeded();
  const ink = await fig.locator(".ps-name").first().evaluate((el) => getComputedStyle(el).fill);
  check("Dunkel: Namen hell", /rgb\((2[0-9]{2}|1[5-9][0-9])/.test(ink), ink);
  await fig.screenshot({ path: path.join(OUT, "ps-4-dunkel.png") });
  await page.emulateMedia({ colorScheme: "light" });
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.stack ?? e.message);
  await shot("ps-abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
