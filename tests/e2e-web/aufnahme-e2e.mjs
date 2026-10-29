// End-to-End-Test: Vorlesung aufnehmen – Ton, Live-Transkript (Spracherkennung nachgebildet), Speichern an der
// Mitschrift, Anhören mit Transkript, Wiederherstellen nach Abbruch, Lernskript aus dem Transkript.
//
// Aufruf: node tests/e2e-web/aufnahme-e2e.mjs   (nach npm run build:web)
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
const PORT = 4198;

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
const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true, permissions: ["clipboard-read", "clipboard-write", "microphone"] });
// Spracherkennung nachbilden
await ctx.addInitScript(() => {
  class FakeRecognition {
    constructor() {
      window.__rec = this;
    }
    start() {
      window.__recStarted = (window.__recStarted ?? 0) + 1;
    }
    stop() {
      this.onend?.();
    }
    abort() {}
  }
  window.webkitSpeechRecognition = FakeRecognition;
  window.SpeechRecognition = FakeRecognition;
  window.__say = (text) => window.__rec?.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
});
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
    await api.settingSet("ai.consent", true);
    const area = (await api.areasList())[0];
    const c = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "StR AT" });
    await api.nodeCreate({ area_id: area.id, parent_id: c.id, kind: "note", title: "5. Vorlesung", meta: { noteType: "vorlesung", number: 5 } });
  });
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  const openNote = async () => {
    await page.locator(".tree-row", { hasText: "StR AT" }).first().click();
    await page.locator("main.primary").getByText("5. Vorlesung").first().click();
    await page.locator(".ProseMirror").waitFor();
  };
  await openNote();
  const editor = page.locator("main.primary .ProseMirror");
  check("Diktat klar beschriftet (ohne Tonaufnahme)", (await page.getByRole("button", { name: /Diktat \(Sprache wird Text, ohne Tonaufnahme\)/ }).count()) === 1);

  // 1. Aufnahme starten – mit Hinweis auf die Erlaubnis der Lehrperson
  await page.getByRole("button", { name: "Vorlesung aufnehmen" }).click();
  const consent = page.getByRole("dialog", { name: "Vorlesung aufnehmen?" });
  check("Vor der ersten Aufnahme: Hinweis auf Erlaubnis und § 201 StGB", (await consent.innerText()).includes("§ 201 StGB"));
  await consent.getByRole("button", { name: "Verstanden, aufnehmen" }).click();
  const bar = page.locator(".recording-bar");
  await bar.waitFor({ timeout: 8000 });
  check("Aufnahmeleiste mit Zeit", /\d:\d\d/.test(await bar.textContent()));
  await sleep(2200);
  await page.evaluate(() => window.__say("Heute behandeln wir den Totschlag nach § 212 StGB."));
  await sleep(1200);
  await page.evaluate(() => window.__say("Ein anderer Mensch muss getötet worden sein."));
  await sleep(300);
  check("Leiste zeigt das Transkript", (await bar.textContent()).includes("getötet"), await bar.textContent());
  await editor.click();
  await bar.getByRole("button", { name: "Zeitmarke in die Mitschrift" }).click();
  check("Zeitmarke in der Mitschrift", /\[Aufnahme 0:0\d\]/.test(await editor.innerText()), await editor.innerText());
  await bar.getByRole("button", { name: "Pause" }).click();
  await sleep(200);
  check("Pause", (await bar.textContent()).includes("Pausiert"));
  await sleep(1500);
  await bar.getByRole("button", { name: "Fortsetzen" }).click();

  // 2. Läuft weiter, auch wenn man woanders hinwechselt
  await page.getByRole("button", { name: "Übersicht" }).first().click();
  await sleep(500);
  check("Aufnahme läuft beim Wechseln weiter", await bar.isVisible());
  await bar.getByRole("button", { name: /Stopp & speichern/ }).click();
  const done = page.getByRole("dialog", { name: "Aufnahme gespeichert" });
  await done.waitFor({ timeout: 15000 });
  check("Nach dem Stopp zurück in der Mitschrift, Dialog „Aufnahme gespeichert“", (await done.innerText()).includes("2 Transkript-Abschnitte"), await done.innerText());
  check("Mitschrift verweist auf die Aufnahme", (await editor.innerText()).includes("Anhören und Transkript lesen"));
  await done.getByRole("button", { name: "Transkript in die Mitschrift einfügen" }).click();
  check("Transkript in der Mitschrift", (await editor.innerText()).includes("Transkript (automatisch, ungeprüft)") && (await editor.innerText()).includes("Totschlag nach § 212 StGB"));
  const docs = await call("documentsList", { kind: "all" });
  const rec = docs.find((d) => d.doc_type === "aufnahme");
  check("Gespeichert als „Vorlesungsaufnahme“ mit Transkripttext", !!rec && rec.text_status === "ok" && rec.size > 1000 && ["webm", "m4a"].includes(rec.ext), JSON.stringify(rec));
  check("Transkript ist durchsuchbar", (await call("search", "Totschlag", null)).some((h) => h.entity_id === rec?.id));

  // 3. Anhören: Verweis öffnet Wiedergabe mit Transkript
  await editor.getByText("Anhören und Transkript lesen").click({ modifiers: ["ControlOrMeta"] });
  const audio = page.locator("audio");
  await audio.waitFor({ timeout: 10000 });
  const lines = page.locator(".transcript-line");
  check("Wiedergabe mit zwei Transkript-Zeilen", (await lines.count()) === 2);
  const dur = await audio.evaluate((a) => new Promise((r) => (a.readyState >= 1 ? r(a.duration) : a.addEventListener("loadedmetadata", () => r(a.duration), { once: true }))));
  check("Aufnahme abspielbar (Dauer bekannt)", Number.isFinite(dur) ? dur > 1 : dur === Infinity, String(dur));
  await lines.nth(1).click();
  await sleep(300);
  const pos = await audio.evaluate((a) => a.currentTime);
  check("Antippen einer Zeile springt an die Stelle", pos >= 1, String(pos));
  await shot("aufnahme-anhoeren");

  // 4. Abgebrochene Aufnahme wiederherstellen (App neu geladen ohne Stopp)
  await openNote();
  await page.getByRole("button", { name: "Vorlesung aufnehmen" }).click();
  await bar.waitFor({ timeout: 8000 });
  await page.evaluate(() => window.__say("Nun zur Körperverletzung nach § 223 StGB."));
  await sleep(11500); // erstes Teilstück wird gesichert
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await openNote();
  await page.getByRole("button", { name: "Vorlesung aufnehmen" }).click();
  const recover = page.getByRole("dialog", { name: "Unterbrochene Aufnahme" });
  await recover.waitFor({ timeout: 8000 });
  check("Unterbrochene Aufnahme wird angeboten", (await recover.innerText()).includes("1 Transkript-Abschnitte"), await recover.innerText());
  await recover.getByRole("button", { name: "Sichern" }).click();
  const done2 = page.getByRole("dialog", { name: "Aufnahme gespeichert" });
  await done2.waitFor({ timeout: 15000 });
  check("Wiederhergestellte Aufnahme gespeichert", (await call("documentsList", { kind: "all" })).filter((d) => d.doc_type === "aufnahme").length === 2);
  check("Keine neue Aufnahme gestartet", (await bar.count()) === 0);

  // 5. Lernskript aus dem Transkript (über die Claude-App, ohne Schlüssel)
  await done2.getByRole("button", { name: /Lernskript/ }).click();
  const study = page.getByRole("dialog", { name: /Mitschrift aufbereiten/ });
  await study.getByRole("button", { name: "In Claude-App" }).click();
  await study.getByRole("button", { name: "Kopieren" }).click();
  await sleep(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check("Lernskript-Anfrage enthält das Transkript", clip.includes("Transkript der Vorlesungsaufnahme") && clip.includes("Körperverletzung nach § 223 StGB"), clip.slice(-300));
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.message);
  await shot("aufnahme-abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
