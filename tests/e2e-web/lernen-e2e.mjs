// End-to-End-Test: Lernstand nach Fach, Lernmodi (nur Definitionen, nach Fach),
// Definitionen aus der Mitschrift ins Glossar, Prüfungsschemata üben (iPad-Größe).
//
// Aufruf: node tests/e2e-web/lernen-e2e.mjs   (nach npm run build:web)
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
const PORT = 4184;

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

const b = (text) => ({ type: "text", text, marks: [{ type: "bold" }] });
const t = (text) => ({ type: "text", text });
const NOTE = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [t("Rechtsgeschäftslehre")] },
    { type: "paragraph", content: [b("Willenserklärung:"), t(" Äußerung eines auf eine Rechtsfolge gerichteten Willens.")] },
    { type: "paragraph", content: [b("Anfechtung"), t(" ist die rückwirkende Vernichtung einer Willenserklärung.")] },
    { type: "paragraph", content: [t("Klausurtipp: immer zuerst die Auslegung.")] },
  ],
};

try {
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  const ids = await page.evaluate(async (NOTE) => {
    const api = window.__STUDIUM_API__;
    const area = (await api.areasList())[0];
    const bgb = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "BGB AT" });
    const str = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "Strafrecht AT" });
    const note = await api.nodeCreate({ area_id: area.id, parent_id: bgb.id, kind: "note", title: "3. Vorlesung", content_json: JSON.stringify(NOTE), meta: { noteType: "vorlesung", number: 3 } });
    await api.knowledgeCreate({ type: "definition", area_id: area.id, title: "Anfechtung", field: "BGB AT", data: { text: "Vernichtung ex tunc" } });
    const schema = await api.knowledgeCreate({
      type: "schema",
      area_id: area.id,
      title: "Anspruch aus § 433 II BGB",
      data: {
        norm: "§ 433 Abs. 2 BGB",
        notes: "",
        items: [
          { id: "s1", text: "Anspruch entstanden", note: "", children: [{ id: "s2", text: "Wirksamer Kaufvertrag", note: "§§ 145 ff. BGB", children: [] }] },
          { id: "s3", text: "Anspruch nicht erloschen", note: "", children: [] },
          { id: "s4", text: "Anspruch durchsetzbar", note: "", children: [] },
        ],
      },
    });
    const mk = (node, kind, front) => api.cardCreate({ area_id: area.id, node_id: node, kind, front, back: "…" });
    const c1 = await mk(bgb.id, "definition", "Definiere: Rechtsgeschäft");
    await mk(bgb.id, "norm", "Was regelt § 119 BGB?");
    await mk(bgb.id, "frage", "Trennungsprinzip?");
    await mk(str.id, "frage", "Aufbau Vorsatzdelikt?");
    await mk(str.id, "definition", "Definiere: Vorsatz");
    // Eine BGB-Karte „sitzt“ (lange Stabilität, erst in 40 Tagen fällig)
    const due = new Date(Date.now() + 40 * 86400000).toISOString();
    await api.cardReview(c1.id, { rating: 3, due, stability: 45, difficulty: 5, elapsed_days: 10, scheduled_days: 40, learning_steps: 0, reps: 4, lapses: 0, state: 2 });
    return { bgb: bgb.id, note: note.id, schema: schema.id, area: area.id };
  }, NOTE);
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });

  // 1. Definitionen aus der Mitschrift ins Glossar
  await page.locator(".tree-row", { hasText: "BGB AT" }).click();
  await page.locator("main.primary").getByText("3. Vorlesung").click();
  await page.locator(".ProseMirror").waitFor();
  await page.getByRole("button", { name: "Weitere Aktionen" }).click();
  await page.getByRole("menuitem", { name: /Definitionen ins Glossar/ }).click();
  const dlg = page.getByRole("dialog", { name: "Definitionen ins Glossar" });
  await dlg.locator(".harvest-row").first().waitFor();
  const rows = await dlg.locator(".harvest-term").evaluateAll((els) => els.map((e) => e.value));
  check("Zwei Definitionen erkannt (fetter Begriff)", JSON.stringify(rows) === JSON.stringify(["Willenserklärung", "Anfechtung"]), JSON.stringify(rows));
  check("Schon vorhandener Begriff ist markiert und abgewählt", (await dlg.locator(".harvest-row", { hasText: "Steht schon im Glossar" }).count()) === 1 && !(await dlg.getByRole("checkbox", { name: "„Anfechtung“ übernehmen" }).isChecked()));
  check("Rechtsgebiet = Veranstaltung", (await dlg.getByRole("textbox", { name: /Rechtsgebiet/ }).inputValue().catch(() => dlg.locator("label", { hasText: "Rechtsgebiet" }).locator("input").inputValue())) === "BGB AT");
  await shot("lernen-1-glossar-dialog");
  await dlg.getByRole("button", { name: "1 übernehmen" }).click();
  await dlg.waitFor({ state: "detached" });
  const defs = await waitFor(async () => (await call("knowledgeList", { type: "definition" })).filter((k) => k.title === "Willenserklärung"));
  check("Glossareintrag angelegt (mit Text, Gebiet, Quelle Vorlesung)", defs.length === 1 && defs[0].field === "BGB AT" && defs[0].source_kind === "vorlesung" && defs[0].data.text.startsWith("Äußerung"), JSON.stringify(defs[0] ?? {}));
  const cards = await call("cardsList", {});
  check("Karteikarte „Definiere: Willenserklärung“ angelegt", cards.some((c) => c.front === "Definiere: Willenserklärung" && c.kind === "definition" && c.node_id === ids.bgb));
  const href = await page.locator(".ProseMirror a", { hasText: "Willenserklärung" }).getAttribute("href").catch(() => null);
  check("Begriff im Text mit dem Glossar verlinkt", href === `studium:knowledge/${defs[0]?.id}`, String(href));

  // 2. Lernstand nach Fach
  await page.getByRole("button", { name: /^Karteikarten/ }).click();
  const fach = page.locator(".fach-row", { hasText: "BGB AT" });
  await fach.waitFor();
  check("Lernstand: BGB AT – 1 von 4 sitzen, 3 fällig", /1 von 4 sitzen · 3 fällig/.test(await fach.innerText()), await fach.innerText());
  check("Lernstand: Strafrecht AT als eigenes Fach", (await page.locator(".fach-row", { hasText: "Strafrecht AT" }).count()) === 1);
  check("Sidebar zeigt fällige Karten", (await page.locator(".nav-badge").first().innerText()) === "5");
  await shot("lernen-2-fach");

  // 3. Lernmodus „nur Definitionen“
  await page.getByRole("button", { name: /^Nur Definitionen/ }).click();
  await page.locator(".flashcard").waitFor();
  check("Lernen · Definitionen", (await page.locator("h1").innerText()).includes("Definitionen"));
  const fronts = [];
  for (let i = 0; i < 6; i++) {
    const f = await page.locator(".fc-front").innerText({ timeout: 1500 }).catch(() => null);
    if (!f) break;
    if (!fronts.includes(f)) fronts.push(f);
    await page.getByRole("button", { name: /Antwort zeigen/ }).click();
    await page.locator(".fc-rate.r4").click();
    await page.waitForFunction((prev) => document.querySelector(".fc-front")?.textContent !== prev, f, { timeout: 3000 }).catch(() => {});
  }
  check("Nur Definitionskarten (fällige)", fronts.length === 2 && fronts.every((f) => f.startsWith("Definiere:")) && !fronts.includes("Definiere: Rechtsgeschäft"), fronts.join(" | "));
  // Fach-Lernen
  await page.getByRole("button", { name: /^Karteikarten/ }).click();
  await page.locator(".fach-row", { hasText: "BGB AT" }).getByRole("button", { name: /lernen|Üben/ }).click();
  await page.locator(".flashcard, .empty").first().waitFor();
  check("Lernen · BGB AT zeigt nur Karten des Fachs", (await page.locator("h1").innerText()).includes("BGB AT") && /BGB|Trennungsprinzip/.test(await page.locator(".fc-front").innerText()), await page.locator(".fc-front").innerText());
  await page.getByRole("tab", { name: "Normen" }).click();
  await page.waitForFunction(() => document.querySelector(".fc-front")?.textContent?.includes("§ 119"), null, { timeout: 4000 }).catch(() => {});
  check("Umschalten auf Normen im Fach", (await page.locator(".fc-front").innerText()).includes("§ 119"));

  // 4. Schema üben – Reihenfolge
  await page.getByRole("button", { name: /^Karteikarten/ }).click();
  const sp = page.locator(".learn-section", { hasText: "Schemata üben" });
  check("Schemata üben: noch nicht geübt", (await sp.innerText()).includes("noch nicht geübt"));
  await sp.locator(".list-row").first().click();
  await page.locator(".quiz-pool").waitFor();
  await page.locator(".quiz-chip", { hasText: "Anspruch durchsetzbar" }).click(); // falsch: zuerst kommt „entstanden“
  check("Falscher Punkt wird abgelehnt", (await page.locator(".quiz-line.is-placed").count()) === 0 && (await page.locator(".quiz").innerText()).includes("1 Fehlversuche"));
  for (const txt of ["Anspruch entstanden", "Wirksamer Kaufvertrag", "Anspruch nicht erloschen", "Anspruch durchsetzbar"]) await page.locator(".quiz-chip", { hasText: txt }).click();
  const res = await page.locator(".quiz-result").innerText();
  check("Reihenfolge vollständig mit Gliederung", res.includes("Reihenfolge vollständig") && res.includes("1 Fehlversuch") && (await page.locator(".quiz-line.is-placed").allInnerTexts()).some((l) => /^I\.\s+Wirksamer Kaufvertrag/.test(l)), res);
  await shot("lernen-3-reihenfolge");

  // 5. Schema üben – Abfragen
  await page.getByRole("tab", { name: /Abfragen/ }).click();
  await page.getByLabel("Deine Antwort").fill("anspruch entstanden");
  await page.getByRole("button", { name: "Aufdecken" }).click();
  check("Eingabe wird nachsichtig verglichen", (await page.locator(".quiz-verdict").innerText()).includes("passt"));
  await page.getByRole("button", { name: "Gewusst", exact: true }).click();
  await page.getByRole("button", { name: "Aufdecken" }).click(); // ohne Eingabe
  check("Pfad zur Orientierung", (await page.locator(".quiz-card").innerText()).includes("Anspruch entstanden") && (await page.locator(".quiz-card").innerText()).includes("§§ 145 ff. BGB"));
  await page.getByRole("button", { name: "Nicht gewusst" }).click();
  await page.getByLabel("Deine Antwort").fill("Rücktritt");
  await page.getByRole("button", { name: "Aufdecken" }).click();
  check("Falsche Eingabe: „passt eher nicht“", (await page.locator(".quiz-verdict").innerText()).includes("passt eher nicht"));
  await page.getByRole("button", { name: "Nicht gewusst" }).click();
  await page.getByRole("button", { name: "Aufdecken" }).click();
  await page.getByRole("button", { name: "Gewusst", exact: true }).click();
  check("Ergebnis: 2 von 4", (await page.locator(".quiz-result").innerText()).includes("2 von 4 Punkten gewusst (50 %)"));
  await page.getByRole("button", { name: "Nur die verpassten wiederholen" }).click();
  check("Wiederholung nur der verpassten Punkte", (await page.locator(".quiz").innerText()).includes("0 / 2"));
  await shot("lernen-4-abfragen");
  const saved = await waitFor(async () => (await call("settingsAll"))[`learn.schema.${ids.schema}`]);
  check("Ergebnis je Schema gemerkt", saved?.known === 2 && saved?.total === 4 && saved?.mode === "abfragen", JSON.stringify(saved));
  await page.getByRole("button", { name: /^Karteikarten/ }).click();
  check("Übersicht zeigt letztes Ergebnis", (await page.locator(".learn-section", { hasText: "Schemata üben" }).innerText()).includes("50 %"));

  // 6. Schema-Seite: Knopf „Schema üben“
  await page.locator(".learn-section", { hasText: "Schemata üben" }).locator(".list-row").first().click();
  await page.getByRole("button", { name: "zum Schema" }).click();
  await page.getByRole("button", { name: "Schema üben" }).waitFor();
  check("Schema-Seite hat „Schema üben“", true);

  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Ablauf ohne Ausnahme", false, e.stack ?? String(e));
  await shot("lernen-fehler").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
process.exit(failed.length ? 1 : 0);
