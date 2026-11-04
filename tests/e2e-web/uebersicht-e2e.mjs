// End-to-End-Test: neue Übersicht – Jetzt/Weiterschreiben, Heute lernen, Prüfung, Offene Enden, Veranstaltungen,
// Gedanke festhalten, Anpassen.
//
// Aufruf: node tests/e2e-web/uebersicht-e2e.mjs   (nach npm run build:web)
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
const PORT = 4200;

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
  const now = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const ids = await page.evaluate(
    async ({ d3, exam, due, other }) => {
      const api = window.__STUDIUM_API__;
      const area = (await api.areasList())[0];
      const sem = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "semester", title: "WS 2026/27" });
      const c = await api.nodeCreate({ area_id: area.id, parent_id: sem.id, kind: "course", title: "StR AT", meta: { weekday: other, time: "8:30–10:00", room: "H 3" } });
      const P = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
      const H = (t) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: t }] });
      const v3 = await api.nodeCreate({
        area_id: area.id,
        parent_id: c.id,
        kind: "note",
        title: "3. Vorlesung",
        meta: { noteType: "vorlesung", number: 3, date: d3 },
        content_json: JSON.stringify({
          type: "doc",
          content: [
            H("Mitschrift"),
            P("Mord und Totschlag."),
            H("Offene Fragen"),
            { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [P("Ist § 211 eine Qualifikation?")] }, { type: "taskItem", attrs: { checked: true }, content: [P("erledigt")] }] },
            { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Aufnahme · 1.11.2026, 10:15 · 90 Min." }] },
            { type: "erklaerungen", content: [{ type: "paragraph", content: [{ type: "text", text: "Synallagma", marks: [{ type: "bold" }] }, { type: "text", text: " – " }] }] },
          ],
        }),
        plain_text: "Mord",
      });
      const v2 = await api.nodeCreate({ area_id: area.id, parent_id: c.id, kind: "note", title: "2. Vorlesung", meta: { noteType: "vorlesung", number: 2, date: d3 } });
      await api.cardCreate({ area_id: area.id, node_id: v2.id, kind: "frage", front: "Was ist Mord?", back: "§ 211", tags: "", source_type: "node", source_id: v2.id });
      await api.examSave(null, { title: "Klausur StR AT", date: exam, node_id: c.id, kind: "Klausur" });
      await api.taskCreate({ area_id: area.id, title: "Hausarbeit abgeben", kind: "aufgabe", due_date: due });
      return { v3: v3.id, v2: v2.id, area: area.id };
    },
    {
      d3: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3)),
      exam: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 10)),
      due: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3)),
      other: ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"][(now.getDay() + 2) % 7],
    },
  );
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  const card = (name) => page.locator(`section[aria-label="${name}"]`);

  // 1. Kacheln vorhanden, alte Bereiche weg
  await card("Offene Enden").getByText("Synallagma").waitFor({ timeout: 15000 });
  check("Alle Kacheln da", (await page.locator(".dash-slot").count()) === 7);
  check("Studienbereich-Kacheln und „Kürzlich importiert“ entfallen", (await page.locator(".area-card").count()) === 0 && (await page.getByText("Kürzlich importiert").count()) === 0);
  check("Backup als Statuszeile", (await page.locator(".dash-backup").innerText()).includes("Backup verwalten"));

  // 2. Offene Enden
  const ends = await card("Offene Enden").innerText();
  check("Offene Enden: offene Frage, fehlende Erklärung, Aufnahme ohne Lernskript, Aufgabe", ends.includes("Ist § 211 eine Qualifikation?") && ends.includes("„Synallagma“") && ends.includes("Aufnahme ohne Lernskript") && ends.includes("Hausarbeit abgeben"), ends);
  check("Erledigte Frage und nachbereitete Vorlesung (mit Karten) fehlen", !ends.includes("erledigt ·") && !ends.includes("2. Vorlesung"), ends);

  // 3. Prüfung, Lernen, Veranstaltungen
  const exam = await card("Nächste Prüfung").innerText();
  check("Prüfung: in 10 Tagen, Karteikarten des Fachs", exam.includes("Klausur StR AT") && exam.includes("in 10 Tagen") && exam.includes("Karteikarten: 0 von 1 sicher"), exam);
  check("Heute lernen: 7 Tagesbalken, Tagesziel", (await card("Heute lernen").locator(".week-bar").count()) === 7 && (await card("Heute lernen").innerText()).includes("von 20 heute"));
  const tile = card("Veranstaltungen").locator(".course-tile", { hasText: "StR AT" });
  check("Veranstaltung: 2 Vorlesungen · 1 nachbereitet, nächster Termin", /2 Vorlesungen · 1 nachbereitet/.test(await tile.innerText()) && /(Mo|Di|Mi|Do|Fr|Sa|So) 8:30/.test(await tile.innerText()), await tile.innerText());
  check("Jetzt: „Als Nächstes“ mit Termin", (await card("Jetzt").innerText()).includes("Als Nächstes: StR AT"), await card("Jetzt").innerText());
  await shot("uebersicht-1");

  // 4. Gedanke festhalten
  await card("Gedanke festhalten").getByRole("textbox").fill("Mordmerkmale wiederholen");
  await card("Gedanke festhalten").getByRole("button", { name: "Festhalten" }).click();
  await card("Gedanke festhalten").getByRole("button", { name: "Eingang öffnen" }).waitFor({ timeout: 5000 });
  const inbox = await page.evaluate(async () => {
    const api = window.__STUDIUM_API__;
    const n = (await api.nodesList(null)).find((x) => x.title === "Eingang");
    return n ? (await api.noteGet(n.id)).content_json : "";
  });
  check("Gedanke in „Eingang“ gespeichert", inbox.includes("Mordmerkmale wiederholen"));

  // 5. Lernskript direkt aus „Offene Enden“
  await card("Offene Enden").locator(".open-row", { hasText: "Aufnahme ohne Lernskript" }).getByRole("button", { name: "Lernskript", exact: true }).click();
  const dlg = page.getByRole("dialog", { name: /Mitschrift aufbereiten/ });
  await dlg.waitFor({ timeout: 8000 });
  check("Mitschrift öffnet mit dem Lernskript-Fenster", (await page.locator("#note-title").inputValue()) === "3. Vorlesung");
  await dlg.getByRole("button", { name: "Schließen" }).click();

  // 6. Weiterschreiben an der letzten Stelle
  await page.locator(".ProseMirror p", { hasText: "Mord und Totschlag" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Heimtücke.");
  const pos = await page.evaluate(() => getSelection().anchorOffset);
  await sleep(1200);
  await page.getByRole("button", { name: "Übersicht" }).first().click();
  await card("Jetzt").getByRole("button", { name: "Weiterschreiben" }).click();
  await page.locator(".ProseMirror").waitFor();
  await sleep(600);
  const back = await page.evaluate(() => ({ text: getSelection().anchorNode?.textContent ?? "", off: getSelection().anchorOffset }));
  check("Weiterschreiben: Schreibmarke an der letzten Stelle", back.text.includes("Heimtücke") && back.off === pos, JSON.stringify({ back, pos }));
  await page.getByRole("button", { name: "Übersicht" }).first().click();

  // 7. Anpassen: ausblenden, verschieben, bleibt gespeichert
  await page.getByRole("button", { name: "Anpassen" }).click();
  await page.locator(".dash-zuletzt").getByRole("button", { name: "Ausblenden" }).click();
  await page.locator(".dash-offen").getByRole("button", { name: "Nach vorn" }).click();
  await page.getByRole("button", { name: "Fertig" }).click();
  check("Ausgeblendet: „Zuletzt bearbeitet“", (await page.locator(".dash-zuletzt").count()) === 0);
  const setting = await page.evaluate(async () => (await window.__STUDIUM_API__.settingsAll())["ui.dashboard"]);
  check("Anordnung gespeichert", setting?.hidden?.includes("zuletzt") && setting.order.indexOf("offen") < setting.order.indexOf("pruefung"), JSON.stringify(setting));
  await shot("uebersicht-2-angepasst");

  // 8. 15 Minuten lernen
  await card("Heute lernen").getByRole("button", { name: "15 Minuten lernen" }).click();
  await page.locator(".learn").waitFor({ timeout: 5000 });
  check("Lernrunde mit Restzeit", /noch 1[45]:\d\d Min\./.test(await page.locator(".learn-head").innerText()), await page.locator(".learn-head").innerText());
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.message);
  await shot("uebersicht-abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
