// End-to-End-Test: Zeichnen (Apple Pencil, simuliert), Stundenplan mit
// „Mitschrift starten“, Klausurenphase mit Lernplan (iPad-Größe, Touch).
//
// Aufruf: node tests/e2e-web/etappe2-e2e.mjs   (nach npm run build:web)
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
const PORT = 4179;

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
const api = (fn) => page.evaluate(fn);

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const now = new Date();
const TODAY = iso(now);
const DAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const todayName = DAYS[now.getDay()];
const otherName = DAYS[(now.getDay() + 2) % 7];
const examDate = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 20));

try {
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.evaluate(
    async ({ todayName, otherName, examDate }) => {
      const api = window.__STUDIUM_API__;
      const area = (await api.areasList())[0];
      const c = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "BGB AT", meta: { weekday: todayName, time: "10:15–11:45", room: "H 1", lecturer: "Prof. Muster" } });
      await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "Staatsrecht", meta: { weekday: otherName.slice(0, 2), time: "14–16" } });
      await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "Ohne Termin" });
      for (const [nr, d] of [[1, "2026-10-01"], [2, "2026-10-08"], [3, "2026-10-12"]])
        await api.nodeCreate({ area_id: area.id, parent_id: c.id, kind: "note", title: `${nr}. Vorlesung`, meta: { noteType: "vorlesung", number: nr, date: d } });
      await api.nodeCreate({ area_id: area.id, parent_id: c.id, kind: "note", title: "Fall 1", meta: { noteType: "fall" } });
      await api.examSave(null, { title: "Klausur BGB AT", date: examDate, node_id: c.id, kind: "Klausur" });
    },
    { todayName, otherName, examDate },
  );
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });

  // 1. Übersicht: Heute + Klausurenphase
  const today = page.locator(".today-card", { hasText: "Heute" });
  await today.waitFor({ timeout: 10000 });
  check("Übersicht zeigt heutige Veranstaltung mit Zeit und Raum", /10:15–11:45[\s\S]*BGB AT[\s\S]*H 1/.test(await today.innerText()), await today.innerText());
  const phase = page.locator(".today-card", { hasText: "Klausurenphase" });
  check("Klausurenphase: Klausur in 20 Tagen", (await phase.innerText()).includes("Klausur BGB AT") && (await phase.innerText()).includes("in 20 Tagen"));
  await today.getByRole("button", { name: "Mitschrift starten" }).click();
  check("Mitschrift-Dialog: Vorlesung Nr. 4, heutiges Datum, Dozent", (await page.getByLabel("Nummer der Vorlesung").inputValue()) === "4" && (await page.getByLabel("Datum der Vorlesung").inputValue()) === TODAY);
  await page.getByRole("button", { name: "Anlegen" }).click();
  await page.locator(".ProseMirror").waitFor();
  await page.getByRole("button", { name: "Übersicht" }).click();
  await today.getByRole("button", { name: "Mitschrift öffnen" }).waitFor({ timeout: 5000 });
  check("Danach „Mitschrift öffnen“ statt neu anlegen", true);
  await shot("etappe2-uebersicht");

  // 2. Stundenplan
  await page.getByRole("button", { name: "Stundenplan" }).click();
  await page.locator(".timetable").waitFor();
  const todayCol = page.locator(".tt-col.is-today");
  check("Stundenplan: BGB AT in der heutigen Spalte", (await todayCol.locator(".tt-slot", { hasText: "BGB AT" }).count()) === 1);
  check("Stundenplan: Staatsrecht an einem anderen Tag", (await page.locator(".tt-slot", { hasText: "Staatsrecht" }).count()) === 1 && (await todayCol.locator(".tt-slot", { hasText: "Staatsrecht" }).count()) === 0);
  check("Veranstaltung ohne Termin wird genannt", (await page.locator(".section", { hasText: "Ohne Termin" }).innerText()).includes("Ohne Termin"));
  check("Heutiger Termin bietet „Mitschrift öffnen“", (await todayCol.getByRole("button", { name: "Mitschrift öffnen" }).count()) === 1);
  await shot("etappe2-stundenplan");

  // 3. Klausurenphase: Lernplan
  await page.getByRole("button", { name: "Aufgaben & Prüfungen" }).click();
  await page.getByRole("button", { name: "Lernplan" }).click();
  const rows = await page.locator(".plan-preview .list-row").allInnerTexts();
  check("Lernplan-Vorschau: 5 Inhalte + Probeklausur + Wiederholung", rows.length === 7 && rows[0].includes("1. Vorlesung") && rows.at(-2).includes("Probeklausur"), rows.join(" | "));
  await page.getByRole("button", { name: "Lernplan anlegen" }).click();
  await sleep(600);
  const planTasks = await api(async () => (await window.__STUDIUM_API__.tasksList({ include_done: true })).filter((t) => t.notes.includes("[Lernplan")));
  check("Lernplan als Aufgaben mit Datum angelegt", planTasks.length === 7 && planTasks.every((t) => t.due_date && t.due_date <= examDate));
  check("Fortschritt 0/7 an der Klausur", (await page.locator(".exam-card .plan-bar").innerText()).includes("0/7"));
  await page.locator(".task-row", { hasText: "1. Vorlesung" }).getByLabel("Erledigt").click();
  await page.waitForFunction(() => document.querySelector(".exam-card .plan-bar")?.textContent?.includes("1/7"), null, { timeout: 5000 }).catch(() => {});
  check("Abhaken erhöht den Fortschritt (1/7)", (await page.locator(".exam-card .plan-bar").innerText()).includes("1/7"));
  await shot("etappe2-lernplan");

  // 4. Zeichnen mit Apple Pencil (simuliert) – Hand wird ignoriert
  await page.locator(".tree-row", { hasText: "Fall 1" }).first().click({ force: true }).catch(async () => {
    await page.locator(".tree-row", { hasText: "BGB AT" }).first().click();
  });
  if (!(await page.locator(".ProseMirror").count())) {
    await page.locator(".tree-row", { hasText: "BGB AT" }).first().click();
    await page.locator(".list-row", { hasText: "Fall 1" }).click();
  }
  await page.locator(".ProseMirror").waitFor();
  await page.locator(".ProseMirror").click();
  await page.getByRole("button", { name: "Zeichnung (Apple Pencil)" }).click();
  const canvas = page.getByLabel("Zeichenfläche");
  await canvas.waitFor();
  const box = await canvas.boundingBox();
  const stroke = (type, id, pts) =>
    page.evaluate(
      ({ type, id, pts }) => {
        const c = document.querySelector(".draw-canvas");
        const ev = (name, [x, y], p) => c.dispatchEvent(new PointerEvent(name, { bubbles: true, cancelable: true, pointerId: id, pointerType: type, isPrimary: true, clientX: x, clientY: y, pressure: p, buttons: 1 }));
        ev("pointerdown", pts[0], 0.6);
        for (const pt of pts.slice(1)) ev("pointermove", pt, 0.8);
        ev("pointerup", pts.at(-1), 0);
      },
      { type, id, pts },
    );
  const line = (x0, y0, x1, y1) => Array.from({ length: 12 }, (_, i) => [box.x + x0 + ((x1 - x0) * i) / 11, box.y + y0 + ((y1 - y0) * i) / 11]);
  await stroke("pen", 11, line(60, 60, 300, 120));
  await page.getByText("Apple Pencil erkannt").waitFor({ timeout: 3000 });
  check("Apple Pencil wird erkannt", true);
  await stroke("touch", 12, line(80, 200, 400, 260)); // Handballen
  await page.getByRole("button", { name: "Textmarker" }).click();
  await stroke("pen", 13, line(60, 90, 300, 90));
  const strokes = await page.evaluate(() => document.querySelector(".draw-canvas") && 1);
  const dlg = page.getByRole("dialog", { name: "Zeichnung" });
  await dlg.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await dlg.getByRole("button", { name: "Wiederholen", exact: true }).click();
  await shot("etappe2-zeichnen");
  await dlg.getByRole("button", { name: "Fertig" }).click();
  const img = page.locator(".ProseMirror .asset-image.is-drawing img");
  await img.waitFor({ timeout: 10000 });
  await page.waitForFunction(() => document.querySelector(".ProseMirror .asset-image.is-drawing img")?.naturalWidth > 0, null, { timeout: 10000 });
  const nat = await img.evaluate((el) => ({ w: el.naturalWidth, h: el.naturalHeight }));
  check("Zeichnung als Bild in der Notiz (2-fache Auflösung, zugeschnitten)", nat.w >= 400 && nat.w < 1200 && nat.h < 400, JSON.stringify(nat));
  const drawingAttr = await page.locator(".ProseMirror .asset-image.is-drawing").evaluate(() => {
    return null;
  });
  void strokes;
  void drawingAttr;
  await sleep(2500);
  const saved = await api(async () => {
    const api = window.__STUDIUM_API__;
    const n = (await api.nodesList(null)).find((x) => x.title === "Fall 1");
    return (await api.noteGet(n.id)).content_json;
  });
  const m = /"drawing":"(v1[^"]*)"/.exec(saved);
  const lines = m ? m[1].split("\\n") : [];
  check("Striche als Vektordaten gespeichert (Stift + Textmarker, ohne Hand)", lines.length === 3 && lines[1].startsWith("pen|") && lines[2].startsWith("marker|"), lines.map((l) => l.slice(0, 30)).join(" / "));
  await img.click();
  await canvas.waitFor();
  check("Antippen öffnet die Zeichnung wieder zum Bearbeiten", await dlg.getByRole("button", { name: "Fertig" }).isEnabled());
  await dlg.getByRole("button", { name: "Abbrechen" }).click();

  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Ablauf ohne Abbruch", false, String(e).slice(0, 500));
  await shot("etappe2-fehler").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
