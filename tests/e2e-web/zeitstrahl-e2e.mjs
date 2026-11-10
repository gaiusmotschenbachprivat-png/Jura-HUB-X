// End-to-End-Test: Zeitstrahl – aus dem Sachverhalt anlegen, Hinweis bei ungeordneter Reihenfolge, sortieren,
// Einträge von Hand (Enter/Tab), gespeichert, Druckvorschau.
//
// Aufruf: node tests/e2e-web/zeitstrahl-e2e.mjs   (nach npm run build:web)
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
const PORT = 4203;

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

const T = (text) => ({ type: "text", text });
const P = (text) => ({ type: "paragraph", content: [T(text)] });
const H = (text) => ({ type: "heading", attrs: { level: 2 }, content: [T(text)] });
// erfundener Übungssachverhalt
const SV =
  "A ist Eigentümer eines gebrauchten Fahrrads. Am 1.3.2024 einigt er sich mit B auf einen Kaufpreis von 300 €. Zwei Tage nach der Einigung holt B das Rad ab und zahlt bar. Am 10.3.2024 erklärt A die Anfechtung wegen Irrtums. Am 5.3.2024 um 14 Uhr bemerkt B einen Rahmenbruch.";

try {
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  const id = await page.evaluate(async (doc) => {
    const api = window.__STUDIUM_API__;
    const area = (await api.areasList())[0];
    const c = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "BGB AT" });
    return (await api.nodeCreate({ area_id: area.id, parent_id: c.id, kind: "note", title: "Fall 3: Fahrrad", meta: { noteType: "fall" }, content_json: JSON.stringify(doc) })).id;
  }, { type: "doc", content: [H("Sachverhalt"), P(SV), H("Lösungsskizze"), P("…")] });
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.locator(".tree-row", { hasText: "BGB AT" }).click();
  await page.locator("main.primary").getByText("Fall 3: Fahrrad").click();
  await page.locator(".ProseMirror").waitFor();

  // 1. Zeitstrahl aus dem Abschnitt „Sachverhalt“
  await page.locator(".ProseMirror h2", { hasText: "Lösungsskizze" }).click();
  await page.getByRole("button", { name: /^Zeitstrahl/ }).click();
  await page.getByRole("menuitem", { name: "Zeitstrahl aus dem Abschnitt „Sachverhalt“" }).click();
  const tl = page.locator(".ProseMirror .timeline");
  await tl.waitFor({ timeout: 4000 });
  const times = () => tl.locator(".tl-time").allInnerTexts();
  check("Einträge aus dem Sachverhalt", JSON.stringify(await times()) === JSON.stringify(["Ausgangslage", "1.3.2024", "Zwei Tage nach der Einigung", "10.3.2024", "5.3.2024, 14 Uhr"]), JSON.stringify(await times()));
  const order = await page.evaluate(() => [...document.querySelectorAll(".ProseMirror > *")].map((e) => e.tagName + (e.classList.contains("timeline") ? ".tl" : "")).join(","));
  check("Zeitstrahl unter dem Sachverhalt, vor der Lösungsskizze", order.startsWith("H2,P,DIV.tl,H2"), order);
  check("Hinweis: nicht chronologisch", (await tl.locator(".tl-hint").innerText()) === "Reihenfolge nicht chronologisch");
  const look = await tl.locator(".tl-entry").nth(1).evaluate((el) => {
    const t = el.querySelector(".tl-time");
    return { grid: getComputedStyle(el).display, color: getComputedStyle(t).color, dot: getComputedStyle(el, "::after").borderTopWidth };
  });
  check("Darstellung: Zeitpunkt links, Punkt auf der Linie", look.grid === "grid" && look.dot === "2px", JSON.stringify(look));
  await shot("zeitstrahl-1-erstellt");

  // 2. Sortieren
  await tl.getByRole("button", { name: "Nach Zeit sortieren" }).click();
  await waitFor(async () => (await times())[1] === "1.3.2024" && (await times())[4] === "10.3.2024");
  check("Sortiert (relative Angabe bleibt beim Vorgänger)", JSON.stringify(await times()) === JSON.stringify(["Ausgangslage", "1.3.2024", "Zwei Tage nach der Einigung", "5.3.2024, 14 Uhr", "10.3.2024"]), JSON.stringify(await times()));
  check("Hinweis verschwindet", (await tl.locator(".tl-hint").innerText()) === "");

  // 3. Von Hand: + Eintrag, Zeit, Enter, Text, Enter → nächster Eintrag
  await tl.getByRole("button", { name: "+ Eintrag" }).click();
  await page.keyboard.type("12.3.2024");
  await page.keyboard.press("Enter");
  await page.keyboard.type("B verlangt Rückzahlung");
  await page.keyboard.press("Enter");
  await page.keyboard.type("11.3.2024");
  await page.keyboard.press("Tab");
  await page.keyboard.type("A widerspricht");
  const entries = tl.locator(".tl-entry");
  check("Einträge von Hand (Enter/Tab)", (await entries.count()) === 7 && (await entries.nth(5).innerText()).includes("B verlangt Rückzahlung") && (await entries.nth(6).locator(".tl-time").innerText()) === "11.3.2024", await tl.innerText());
  check("Neuer Eintrag außer der Reihe → Hinweis", (await tl.locator(".tl-hint").innerText()) === "Reihenfolge nicht chronologisch");
  // über das Werkzeugleisten-Menü sortieren
  await page.getByRole("button", { name: /^Zeitstrahl/ }).click();
  await page.getByRole("menuitem", { name: "Nach Zeit sortieren" }).click();
  await waitFor(async () => (await times())[5] === "11.3.2024");
  check("Sortieren über die Werkzeugleiste", (await times()).slice(4).join("|") === "10.3.2024|11.3.2024|12.3.2024", JSON.stringify(await times()));
  // Enter im leeren letzten Eintrag verlässt den Zeitstrahl
  await tl.locator(".tl-text").last().click();
  await page.waitForFunction(() => {
    const n = window.getSelection()?.anchorNode;
    return !!(n?.nodeType === 3 ? n.parentElement : n)?.closest(".tl-entry:last-child .tl-text");
  }, null, { timeout: 3000 }).catch(() => {});
  await sleep(300); // Editor übernimmt die Klick-Auswahl asynchron
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Danach geht es normal weiter.");
  check("Enter auf leerem Eintrag verlässt den Zeitstrahl", (await entries.count()) === 7 && (await page.locator(".ProseMirror > p", { hasText: "Danach geht es normal weiter." }).count()) === 1, await tl.innerText());
  await shot("zeitstrahl-2-sortiert");

  // 4. Gespeichert
  let saved = "";
  for (let i = 0; i < 30; i++) {
    saved = (await call("noteGet", id)).content_json;
    if (saved.includes("Danach geht es normal weiter")) break;
    await sleep(200);
  }
  const doc = JSON.parse(saved);
  const stl = doc.content.find((n) => n.type === "timeline");
  check("Gespeichert als Zeitstrahl", stl?.content?.length === 7 && stl.content[1].content[0].content[0].text === "1.3.2024", JSON.stringify(stl?.content?.map((e) => e.content[0].content?.[0]?.text)));

  // 5. Druckvorschau
  await page.getByRole("button", { name: "Drucken / als PDF" }).click();
  const pv = page.locator(".pagedjs_page .timeline").first();
  const ok = await pv.waitFor({ timeout: 15000 }).then(() => true, () => false);
  if (ok) {
    const label = await pv.evaluate((el) => getComputedStyle(el, "::before").content);
    check("Druck: Zeitstrahl mit Beschriftung", label.includes("Zeitstrahl"), label);
    await shot("zeitstrahl-3-druck");
  } else check("Druckvorschau geöffnet", false, "keine Vorschau");
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.stack ?? e.message);
  await shot("zeitstrahl-abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
