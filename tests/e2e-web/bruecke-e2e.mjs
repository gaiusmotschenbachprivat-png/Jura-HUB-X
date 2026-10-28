// End-to-End-Test: Claude-App-Brücke – KI ohne API-Kosten (Assistent und Lernhilfen), ohne API-Schlüssel.
//
// Aufruf: node tests/e2e-web/bruecke-e2e.mjs   (nach npm run build:web)
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
const PORT = 4196;

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
  // Die Claude API darf bei der Brücke nie angesprochen werden
  const apiCalls = [];
  await page.route("https://api.anthropic.com/**", (route) => {
    apiCalls.push(route.request().url());
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.evaluate(async () => {
    const api = window.__STUDIUM_API__;
    await api.settingSet("ai.consent", true);
    const area = (await api.areasList())[0];
    const text = "Herr Müller erklärte heute die Anfechtung. Sie ist ein Gestaltungsrecht und vernichtet das Rechtsgeschäft rückwirkend nach § 142 Abs. 1 BGB. Anfechtungsgründe sind §§ 119, 120, 123 BGB.";
    await api.nodeCreate({
      area_id: area.id,
      parent_id: null,
      kind: "note",
      title: "Anfechtung",
      meta: { noteType: "vorlesung" },
      content_json: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }),
      plain_text: text,
    });
  });
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });

  // 1. Assistent: ohne API-Schlüssel über die Claude-App
  await page.getByRole("button", { name: "KI-Assistent", exact: true }).click();
  const input = page.getByPlaceholder(/./).and(page.locator(".ai-input textarea"));
  await input.fill("Muss Herr Müller nach Anfechtung den Kaufpreis zahlen?");
  check("Ohne Schlüssel: kein „Senden“, aber „In Claude-App fragen“", (await page.locator(".ai-input").getByRole("button", { name: "Senden" }).count()) === 0);
  await page.getByRole("button", { name: "In Claude-App fragen" }).click();
  const dlg = page.getByRole("dialog", { name: /Claude-App/ });
  await dlg.getByRole("button", { name: "Kopieren" }).click();
  await sleep(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check("Anfrage kopiert: Anweisungen, Quellenblock, anonymisiert", clip.includes("<quellen>") && clip.includes("Gutachtenstil") && clip.includes("[PERSON_1]") && !clip.includes("Müller"), clip.slice(-300));
  check("„Claude öffnen“ führt zu claude.ai", (await dlg.getByRole("link", { name: "Claude öffnen" }).getAttribute("href")) === "https://claude.ai/new");
  await dlg.getByLabel("Antwort von Claude").fill("**Ergebnis:** Herr [PERSON_1] muss nicht zahlen, wenn die Anfechtung wirksam ist (§ 142 Abs. 1 BGB).\n\nHinweis: Diese Ausgabe ersetzt keine anwaltliche Prüfung im Einzelfall.");
  await dlg.getByRole("button", { name: "Antwort übernehmen" }).click();
  await dlg.waitFor({ state: "detached", timeout: 8000 });
  const card = page.locator(".ai-entries").last();
  const shown = await card.innerText();
  check("Antwort im Verlauf: Name wieder eingesetzt, „ohne API-Kosten“", shown.includes("Herr Müller muss nicht zahlen") && shown.includes("ohne API-Kosten"), shown.slice(0, 300));
  await shot("bruecke-assistent");

  // 2. Lernhilfe Karteikarten über die Claude-App
  await page.locator(".tree-row", { hasText: "Anfechtung" }).first().click();
  await page.locator(".ProseMirror").waitFor();
  await page.getByRole("button", { name: "KI-Lernhilfen" }).click();
  await page.getByRole("menuitem", { name: /Karteikarten vorschlagen/ }).click();
  const study = page.getByRole("dialog");
  check("Ohne Schlüssel: kein „Starten“, aber „In Claude-App“", (await study.getByRole("button", { name: "Starten" }).count()) === 0);
  await study.getByRole("button", { name: "In Claude-App" }).click();
  await study.getByRole("button", { name: "Kopieren" }).click();
  await sleep(300);
  const clip2 = await page.evaluate(() => navigator.clipboard.readText());
  check("Lernhilfe: JSON-Format verlangt, anonymisiert", clip2.includes('"karten"') && clip2.includes("[PERSON_1]") && !clip2.includes("Müller"));
  await study.getByLabel("Antwort von Claude").fill(
    'Gern, hier die Karten:\n```json\n{"karten":[{"art":"definition","vorderseite":"Anfechtung","rueckseite":"Gestaltungsrecht (§ 142 Abs. 1 BGB), erklärt wie bei [PERSON_1]."},{"art":"frage","vorderseite":"Wirkt die Anfechtung ex nunc?","rueckseite":"Nein, ex tunc."}]}\n```',
  );
  await study.getByRole("button", { name: "Antwort übernehmen" }).click();
  await study.locator(".study-card").first().waitFor({ timeout: 5000 });
  check("Zwei Karten aus der eingefügten Antwort", (await study.locator(".study-card").count()) === 2);
  check("Name in der Karte wieder eingesetzt", (await study.locator(".study-card").first().innerText()).includes("Müller"));
  await study.getByRole("button", { name: "2 Karten anlegen" }).click();
  const countCards = () => page.evaluate(async () => (await window.__STUDIUM_API__.cardsList({})).length);
  await waitFor(async () => (await countCards()) === 2);
  const cards = await countCards();
  check("Karten angelegt", cards === 2, String(cards));
  check("Kein einziger Aufruf der Claude API", apiCalls.length === 0, apiCalls.join(", "));
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.message);
  await shot("bruecke-abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
