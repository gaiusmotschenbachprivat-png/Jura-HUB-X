// End-to-End-Test des KI-Assistenten in der Browser-Version (Playwright, Chromium).
// Die Claude API wird im Browser abgefangen und mit festen Antworten beantwortet:
// Das echte Anthropic-SDK, die Oberfläche, Anonymisierung, Werkzeuge und
// Zitatprüfung laufen wirklich – es entstehen keine Kosten und kein Netzverkehr.
//
// Aufruf: node tests/e2e-web/ki-e2e.mjs   (nach npm run build:web)
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
const PORT = 4174;
const URL_ = `http://127.0.0.1:${PORT}/?e2e`;

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  – " + extra : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Erfundenes Testgesetz (kein echter Gesetzestext)
const LAW = path.join(OUT, "mustg.xml");
fs.writeFileSync(
  LAW,
  `<?xml version="1.0" encoding="UTF-8"?><dokumente><norm><metadaten><jurabk>MustG</jurabk><langue>Mustergesetz</langue>
<standangabe><standtyp>Stand</standtyp><standkommentar>Testfassung</standkommentar></standangabe></metadaten></norm>
<norm><metadaten><jurabk>MustG</jurabk><enbez>§ 1</enbez><titel>Pflichten</titel></metadaten><textdaten><text><Content>
<P>(1) Der Verkäufer einer Mustersache hat sie zu übergeben.</P><P>(2) Der Käufer hat den Musterpreis zu zahlen.</P></Content></text></textdaten></norm>
<norm><metadaten><jurabk>MustG</jurabk><enbez>§ 2</enbez><titel>Frist</titel></metadaten><textdaten><text><Content><P>Die Musterfrist beträgt zwei Wochen.</P></Content></text></textdaten></norm>
</dokumente>`,
);

const server = spawn("npx", ["vite", "preview", "--mode", "web", "--outDir", "dist-web", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], {
  cwd: ROOT,
  stdio: "ignore",
});
for (let i = 0; i < 50; i++) {
  try {
    await fetch(`http://127.0.0.1:${PORT}/`);
    break;
  } catch {
    await sleep(200);
  }
}

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// ---- nachgebildete Claude API ----
const requests = [];
const message = (content, stop) => ({
  id: `msg_${requests.length}`,
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content,
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: requests.length > 1 ? 900 : 0 },
});
const script = [
  () => message([{ type: "text", text: "Ich rufe die Frist ab." }, { type: "tool_use", id: "tu_1", name: "norm_abrufen", input: { gesetz: "MustG", norm: "§ 2", absatz: 0 } }], "tool_use"),
  () =>
    message(
      [{ type: "text", text: "## Ergebnis\n\nHerr [PERSON_1] muss als Käufer zahlen (§ 1 Abs. 2 MustG) [Q2]. Zudem gilt § 1 Abs. 9 MustG." }],
      "end_turn",
    ),
  () =>
    message(
      [
        {
          type: "text",
          text: "## Ergebnis\n\nHerr [PERSON_1] muss als Käufer den Musterpreis zahlen (§ 1 Abs. 2 MustG) [Q2].\n\n- Frist: zwei Wochen (§ 2 MustG) [Q3]",
        },
      ],
      "end_turn",
    ),
];
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
await page.route("https://api.anthropic.com/**", async (route) => {
  const req = route.request();
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  requests.push({ url: req.url(), headers: req.headers(), body: req.postDataJSON() });
  const next = script.shift();
  if (!next) return route.fulfill({ status: 500, headers: cors, body: "{}" });
  return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(next()) });
});
// Kein anderer Netzverkehr außer der App selbst
const foreign = [];
page.on("request", (r) => {
  const u = new URL(r.url());
  if (u.hostname !== "127.0.0.1" && u.hostname !== "api.anthropic.com") foreign.push(r.url());
});

try {
  await page.goto(URL_);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor();

  // 1. Zustimmung
  await page.getByRole("button", { name: "KI-Assistent" }).click();
  await page.getByText("KI-Assistent einschalten?").waitFor();
  check("Assistent ist ohne Zustimmung gesperrt", await page.getByRole("button", { name: "Einschalten" }).isDisabled());
  await page.getByLabel(/Ich habe das gelesen/).check();
  await page.getByRole("button", { name: "Einschalten" }).click();

  // 2. Schlüssel nur für die Sitzung
  await page.getByPlaceholder("sk-ant-…").fill("sk-ant-test-schluessel");
  await page.getByRole("button", { name: "Verwenden" }).click();
  await page.getByText("API-Schlüssel für diese Sitzung").waitFor({ state: "detached" });
  const stored = await page.evaluate(async () => {
    const ls = JSON.stringify(localStorage);
    const s = JSON.stringify(await window.__STUDIUM_API__.settingsAll());
    return ls.includes("sk-ant") || s.includes("sk-ant");
  });
  check("Schlüssel wird nicht gespeichert", !stored);

  // 3. Rechtsquelle importieren
  await page.getByRole("tab", { name: /Rechtsquellen/ }).click();
  await page.locator("select").first().selectOption("gesetz");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Datei wählen …" }).click()]);
  await chooser.setFiles(LAW);
  await page.getByRole("cell", { name: /MustG/ }).waitFor({ timeout: 15000 });
  check("Gesetz im Format von gesetze-im-internet.de importiert", (await page.getByRole("cell", { name: "3" }).count()) >= 1);

  // 4. Frage stellen
  await page.getByRole("tab", { name: /Fragen/ }).click();
  await page.locator(".ai-input textarea").fill("Muss Herr Müller als Käufer der Mustersache den Musterpreis zahlen?");
  await page.getByRole("button", { name: "Senden" }).click();
  await page.locator(".ai-card").waitFor({ timeout: 30000 });
  await shot("ki-antwort");

  // Anfragen an die API
  check("Drei API-Aufrufe (Werkzeug, Antwort, Überarbeitung)", requests.length === 3, String(requests.length));
  const first = requests[0];
  check("Schlüssel geht nur im Header an api.anthropic.com", first?.headers["x-api-key"] === "sk-ant-test-schluessel");
  check("Modell Claude Opus 5.5 mit Ausweichmodell", first?.body.model === "claude-opus-5-5" && first?.body.fallbacks === "default");
  check("Name wurde vor dem Senden anonymisiert", !JSON.stringify(requests.map((r) => r.body)).includes("Müller"));
  check("Quellen werden mitgeschickt", JSON.stringify(first?.body.messages).includes("[Q1]"));
  check("Werkzeugergebnis ging zurück", JSON.stringify(requests[1]?.body.messages).includes("Musterfrist"));
  check("Überarbeitung nach unbelegtem Zitat angefordert", JSON.stringify(requests[2]?.body.messages).includes("§ 1 Abs. 9 MustG"));
  check("Kein anderer Netzverkehr", foreign.length === 0, foreign.join(", "));

  // Anzeige
  const card = page.locator(".ai-card").last();
  const txt = await card.innerText();
  check("Antwort zeigt Originalnamen (zurückübersetzt)", txt.includes("Herr Müller"));
  check("Zitatprüfung: belegt, nach Überarbeitung", /Zitatprüfung: 2 belegt/.test(txt) && txt.includes("Überarbeitung"), txt.match(/Zitatprüfung[^\n]*/)?.[0]);
  check("Hinweis auf fehlende anwaltliche Prüfung ergänzt", txt.includes("ersetzt keine anwaltliche Prüfung"));
  await card.locator(".src-chip", { hasText: "Q2" }).first().click();
  check("Quelle per Klick einsehbar", (await card.locator(".ai-source").innerText()).includes("MustG"));
  await card.getByText("An Anthropic gesendet").click();
  check("Gesendete Daten einsehbar (anonymisiert)", (await card.locator(".ai-sent").innerText()).includes("[PERSON_1]"));

  // 5. Als Notiz speichern
  await card.getByRole("button", { name: "Als Notiz speichern" }).click();
  await sleep(800);
  const notes = await page.evaluate(async () => (await window.__STUDIUM_API__.nodesList(null)).filter((n) => n.kind === "note").map((n) => n.title));
  check("Antwort als Notiz gespeichert", notes.some((t) => t.startsWith("KI:")), notes.join(", "));
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.message);
  await shot("ki-abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

async function shot(name) {
  await page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: false });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
