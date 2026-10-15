// End-to-End-Test der KI-Lernhilfen (Mitschrift aufbereiten, Karteikarten,
// Übungsfall, Lösung besprechen). Die Claude API wird im Browser abgefangen:
// keine Kosten, kein Netzverkehr. iPad-Größe, Touch.
//
// Aufruf: node tests/e2e-web/etappe3-e2e.mjs   (nach npm run build:web)
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
const PORT = 4180;

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

// ---- nachgebildete Claude API ----
const requests = [];
const msg = (text) => ({ id: `msg_${requests.length}`, type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 900, output_tokens: 300 } });
const replies = [
  () => msg("# Lernskript: Anfechtung\n\n## Gliederung\n1. Anfechtungsgrund\n2. Anfechtungserklärung\n\n## Kernaussagen\nNach Herrn [PERSON_1] ist die Anfechtung ein Gestaltungsrecht (§ 142 Abs. 1 BGB).\n\n## Lücken und Unklarheiten\n- Frist des § 121 BGB fehlt.\n\n## Zum Wiederholen\n- Welche Anfechtungsgründe gibt es?"),
  () => msg(JSON.stringify({ karten: [
    { art: "definition", vorderseite: "Anfechtung", rueckseite: "Gestaltungsrecht, das ein Rechtsgeschäft rückwirkend vernichtet (§ 142 Abs. 1 BGB)." },
    { art: "norm", vorderseite: "§ 121 Abs. 1 BGB", rueckseite: "Anfechtung wegen Irrtums unverzüglich." },
    { art: "frage", vorderseite: "Wirkt die Anfechtung ex nunc?", rueckseite: "Nein, ex tunc (§ 142 Abs. 1 BGB)." },
  ] })),
  () => msg(JSON.stringify({ titel: "Der verschriebene Preis", sachverhalt: "A bietet B ein Fahrrad für 150 € an, wollte aber 510 € schreiben.\nB nimmt an.", fallfrage: "Kann B Übereignung gegen 150 € verlangen?", bearbeitungshinweis: "Bearbeitungszeit 60 Minuten.", loesungsskizze: "A. Anspruch aus § 433 Abs. 1 BGB\nI. Entstanden\nII. Erloschen durch Anfechtung (§ 142 I, § 119 I Alt. 2 BGB)" })),
  () => msg("## Gesamteindruck\nSolider Ansatz.\n\n## Probleme erkannt?\n- Erklärungsirrtum: angesprochen, aber zu knapp\n\n## Nächste Schritte\n- Obersatz ausformulieren."),
];
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
await page.route("https://api.anthropic.com/**", async (route) => {
  const req = route.request();
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  requests.push(req.postDataJSON());
  await sleep(300);
  const next = replies.shift();
  return next ? route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(next()) }) : route.fulfill({ status: 500, headers: cors, body: "{}" });
});

try {
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.evaluate(async () => {
    const api = window.__STUDIUM_API__;
    const area = (await api.areasList())[0];
    const c = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "BGB AT" });
    const text = "Herr Müller erklärte heute die Anfechtung. Sie ist ein Gestaltungsrecht und vernichtet das Rechtsgeschäft rückwirkend nach § 142 Abs. 1 BGB. Anfechtungsgründe sind §§ 119, 120, 123 BGB.";
    await api.nodeCreate({
      area_id: area.id,
      parent_id: c.id,
      kind: "note",
      title: "3. Vorlesung: Anfechtung",
      meta: { noteType: "vorlesung", date: "2026-10-15", number: 3 },
      content_json: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }),
      plain_text: text,
    });
  });
  await page.reload();
  await page.locator(".tree-row", { hasText: "BGB AT" }).first().click();
  await page.locator(".list-row", { hasText: "3. Vorlesung" }).click();
  await page.locator(".ProseMirror").waitFor();

  // 0. Ohne Einrichtung: Hinweis statt Fehler
  await page.getByRole("button", { name: "KI-Lernhilfen" }).click();
  await page.getByRole("menuitem", { name: /Mitschrift aufbereiten/ }).click();
  const dlg = page.getByRole("dialog");
  const hint = await dlg.getByRole("button", { name: "KI-Assistent öffnen" }).waitFor({ timeout: 5000 }).then(() => true, () => false);
  check("Ohne Zustimmung/Schlüssel: Hinweis mit „KI-Assistent öffnen“", hint);
  await dlg.getByRole("button", { name: "KI-Assistent öffnen" }).click();
  // Einrichtung in der Seitenleiste
  const panel = page.locator(".ai-panel");
  await panel.getByLabel(/Ich habe das gelesen/).check();
  await panel.getByRole("button", { name: "Einschalten" }).click();
  await panel.getByPlaceholder("sk-ant-…").fill("sk-ant-test");
  await panel.getByLabel(/Auf diesem iPad merken/).uncheck();
  await panel.getByRole("button", { name: "Verwenden" }).click();
  await panel.getByPlaceholder("sk-ant-…").waitFor({ state: "detached", timeout: 10000 });
  await panel.getByRole("button", { name: "Schließen" }).click();

  // 1. Mitschrift aufbereiten
  await page.getByRole("button", { name: "KI-Lernhilfen" }).click();
  await page.getByRole("menuitem", { name: /Mitschrift aufbereiten/ }).click();
  await dlg.getByRole("button", { name: "Starten" }).click();
  await dlg.locator(".study-result").waitFor({ timeout: 15000 });
  const body0 = JSON.stringify(requests[0]);
  check("Gesendet: anonymisiert (kein Klarname), Lern-Prompt", !body0.includes("Müller") && body0.includes("[PERSON_1]") && body0.includes("Lernskript"));
  check("Ergebnis mit Originalnamen angezeigt", (await dlg.locator(".study-result").innerText()).includes("Herrn Müller"));
  await shot("etappe3-aufbereiten");
  await dlg.getByRole("button", { name: "Als neue Zusammenfassung speichern" }).click();
  await page.locator(".tree-row", { hasText: "Lernskript: 3. Vorlesung" }).first().waitFor({ timeout: 5000 });
  const skript = await page.evaluate(async () => (await window.__STUDIUM_API__.nodesList(null)).find((n) => n.title.startsWith("Lernskript:")));
  check("Lernskript als Zusammenfassung neben der Vorlesung", skript?.meta?.noteType === "zusammenfassung" && (await page.locator(".ProseMirror").innerText()).includes("ungeprüft"));

  // 2. Karteikarten (zurück zur Vorlesung)
  await page.locator(".tree-row", { hasText: "3. Vorlesung" }).first().click();
  await page.locator(".ProseMirror").waitFor();
  await page.getByRole("button", { name: "KI-Lernhilfen" }).click();
  await page.getByRole("menuitem", { name: /Karteikarten vorschlagen/ }).click();
  await dlg.getByRole("button", { name: "Starten" }).click();
  await dlg.locator(".study-card").first().waitFor({ timeout: 15000 });
  check("Karteikarten mit Schema angefragt", requests[1]?.output_config?.format?.type === "json_schema");
  check("Drei Vorschläge zur Auswahl", (await dlg.locator(".study-card").count()) === 3);
  await dlg.locator(".study-card").nth(1).locator("input").uncheck();
  await dlg.getByRole("button", { name: "2 Karten anlegen" }).click();
  await sleep(500);
  const cards = await page.evaluate(async () => (await window.__STUDIUM_API__.cardsList({})).map((c) => [c.kind, c.front, c.tags, c.source_type]));
  check("Nur ausgewählte Karten angelegt, mit Quelle", cards.length === 2 && cards.every((c) => c[2] === "KI-Vorschlag" && c[3] === "node"), JSON.stringify(cards));

  // 3. Übungsfall
  await page.getByRole("button", { name: "KI-Lernhilfen" }).click();
  await page.getByRole("menuitem", { name: /Übungsfall erstellen/ }).click();
  await dlg.getByLabel("Schwierigkeit").selectOption("fortgeschritten");
  await dlg.getByRole("button", { name: "Starten" }).click();
  await page.locator(".note-title").waitFor();
  await page.waitForFunction(() => document.querySelector(".note-title")?.value?.startsWith("Übungsfall"), null, { timeout: 15000 });
  const caseText = await page.locator(".ProseMirror").innerText();
  check("Fall-Notiz mit Sachverhalt, Fallfrage und leerer Lösung", /Sachverhalt[\s\S]*150 €[\s\S]*Fallfrage[\s\S]*Lösung/.test(caseText) && !caseText.includes("Anspruch aus § 433 Abs. 1"), caseText.slice(0, 200));
  check("Lösungsskizze verdeckt gespeichert", (await page.getByLabel("Art der Notiz").inputValue()) === "fall");

  // 4. Lösung schreiben und besprechen
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("B könnte gegen A einen Anspruch auf Übereignung aus § 433 Abs. 1 BGB haben. A hat jedoch angefochten.");
  await sleep(1500);
  await page.getByRole("button", { name: "KI-Lernhilfen" }).click();
  await page.getByRole("menuitem", { name: /Lösung besprechen/ }).click();
  await dlg.getByRole("button", { name: "Starten" }).click();
  await dlg.locator(".study-result").waitFor({ timeout: 15000 });
  const rv = JSON.stringify(requests[3]);
  check("Besprechung: Lösung und verdeckte Skizze gesendet", rv.includes("B könnte gegen A") && rv.includes("loesungsskizze_nur_fuer_dich"));
  await dlg.getByRole("button", { name: "Lösungsskizze aufdecken" }).click();
  check("Lösungsskizze erst auf Wunsch sichtbar", (await dlg.innerText()).includes("Erloschen durch Anfechtung"));
  await shot("etappe3-besprechung");
  await dlg.getByRole("button", { name: "Unter der Lösung einfügen" }).click();
  check("Rückmeldung unter der Lösung eingefügt", (await page.locator(".ProseMirror").innerText()).includes("Rückmeldung (KI, ungeprüft)"));

  check("Genau vier Anfragen an die Claude API", requests.length === 4, String(requests.length));
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Ablauf ohne Abbruch", false, String(e).slice(0, 500));
  await shot("etappe3-fehler").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
