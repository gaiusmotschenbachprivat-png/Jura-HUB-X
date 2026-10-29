// End-to-End-Test: Werkzeugleiste ein-/ausklappen und Folien-Lupe (vergrößerte Ansicht im Bereich der Werkzeugleiste).
//
// Aufruf: node tests/e2e-web/lupe-e2e.mjs   (nach npm run build:web)
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
const PORT = 4197;
const PDF = path.join(ROOT, "tests/e2e/fixtures/folien.pdf");

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
    const c = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "StR AT" });
    await api.nodeCreate({ area_id: area.id, parent_id: c.id, kind: "note", title: "5. Vorlesung", meta: { noteType: "vorlesung", number: 5 } });
  });
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.locator(".tree-row", { hasText: "StR AT" }).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Dokumente importieren" }).first().click()]);
  await chooser.setFiles(PDF);
  await page.getByRole("dialog").getByRole("button", { name: "Importieren" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await waitFor(async () => (await call("documentsList", { kind: "all" })).length > 0);

  // 1. Werkzeugleiste einklappen und wieder ausklappen
  await page.locator("main.primary").getByText("5. Vorlesung").click();
  await page.locator(".ProseMirror").waitFor();
  const toolbar = page.locator("main.primary .toolbar");
  check("Werkzeugleiste sichtbar", await toolbar.isVisible());
  const editorTop = () => page.locator("main.primary .ProseMirror").evaluate((e) => e.getBoundingClientRect().top);
  const topOpen = await editorTop();
  await page.getByRole("button", { name: "Werkzeugleiste einklappen" }).click();
  check("Eingeklappt: Werkzeugleiste weg, Text rückt nach oben", (await toolbar.count()) === 0 && (await editorTop()) < topOpen - 100, `${topOpen} → ${await editorTop()}`);
  await sleep(1200);
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.locator(".tree-row", { hasText: "StR AT" }).click();
  await page.locator("main.primary").getByText("5. Vorlesung").click();
  await page.locator(".ProseMirror").waitFor();
  check("Bleibt nach Neuladen eingeklappt", (await page.locator("main.primary .toolbar").count()) === 0);
  await page.getByRole("button", { name: "Werkzeugleiste ausklappen" }).click();
  check("Ausgeklappt: Werkzeugleiste wieder da", await page.locator("main.primary .toolbar").isVisible());

  // 2. Folien öffnen, Lupe einschalten
  await page.getByRole("button", { name: "Folien", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Folien auswählen" });
  await picker.locator(".slide-pick").first().click();
  const side = page.locator("section.secondary");
  await side.locator(".pdf-page canvas").first().waitFor({ timeout: 15000 });
  await sleep(500);
  check("Ohne Lupe: keine Lupenansicht", (await page.locator(".slide-lens").count()) === 0);
  await side.getByRole("button", { name: /^Lupe/ }).click();
  const lens = page.locator("main.primary .slide-lens.in-toolbar");
  await lens.waitFor({ timeout: 5000 });
  check("Lupe erscheint in der Mitschrift an der Stelle der Werkzeugleiste", (await page.locator("main.primary .toolbar").count()) === 0);

  // 3. Mit der Maus über die Folie fahren → vergrößerter Ausschnitt
  const pageBox = await side.locator(".pdf-page").first().boundingBox();
  // über die Überschrift der Testfolie
  await page.mouse.move(pageBox.x + pageBox.width * 0.3, pageBox.y + pageBox.height * 0.06);
  await page.mouse.move(pageBox.x + pageBox.width * 0.32, pageBox.y + pageBox.height * 0.07);
  await waitFor(async () => (await lens.innerText()).includes("Seite 1"));
  check("Lupe zeigt die Seite unter dem Zeiger", (await lens.innerText()).includes("Seite 1"), await lens.innerText());
  const frame = side.locator(".lens-frame");
  check("Rahmen auf der Folie zeigt den Ausschnitt", await frame.isVisible());
  const painted = async () =>
    lens.locator("canvas").evaluate((c) => {
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 16) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) dark++;
      return { w: c.width, dark };
    });
  await sleep(800); // hochauflösende Seite
  const p1 = await painted();
  check("Lupe zeichnet die Folie (nicht leer)", p1.w > 200 && p1.dark > 20, JSON.stringify(p1));
  await shot("lupe-mitschrift");
  // Ausschnitt folgt dem Zeiger
  const f1 = await frame.boundingBox();
  await page.mouse.move(pageBox.x + pageBox.width * 0.7, pageBox.y + pageBox.height * 0.6);
  await sleep(200);
  const f2 = await frame.boundingBox();
  check("Rahmen folgt dem Zeiger", f2.x > f1.x + 50 && f2.y > f1.y, JSON.stringify({ f1, f2 }));
  // Rahmengröße passt zur Vergrößerung: Lupe breit / Zoom
  const lensW = (await lens.locator("canvas").boundingBox()).width;
  check("Rahmenbreite = Lupenbreite / Vergrößerung", Math.abs(f2.width - Math.min(pageBox.width, lensW / 2.5)) < 3, `${f2.width} vs ${lensW / 2.5}`);
  await lens.getByRole("button", { name: "Stärker vergrößern" }).click();
  await page.mouse.move(pageBox.x + pageBox.width * 0.71, pageBox.y + pageBox.height * 0.6);
  await sleep(200);
  check("Stärker vergrößern: kleinerer Ausschnitt", (await frame.boundingBox()).width < f2.width - 10 && (await lens.innerText()).includes("3×"));

  // 4. Finger: Antippen setzt die Lupe (Ziehen scrollt weiter)
  await side.locator(".pdf-page").first().tap({ position: { x: 20, y: 20 } });
  await sleep(200);
  check("Antippen mit dem Finger setzt den Ausschnitt", (await frame.boundingBox()).x < f2.x - 50);

  // 5. Lupe aus → Werkzeugleiste zurück
  await lens.getByRole("button", { name: "Lupe ausschalten" }).click();
  check("Lupe aus: Werkzeugleiste wieder da, Rahmen weg", (await page.locator("main.primary .toolbar").isVisible()) && (await side.locator(".lens-frame").count()) === 0);
  // Lupe geht aus, wenn die Folien geschlossen werden
  await side.getByRole("button", { name: /^Lupe/ }).click();
  await lens.waitFor();
  await side.getByRole("button", { name: "Geteilte Ansicht schließen" }).click();
  await sleep(300);
  check("Folien geschlossen: Lupe aus", (await page.locator(".slide-lens").count()) === 0 && (await page.locator("main.primary .toolbar").isVisible()));
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.message);
  await shot("lupe-abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
