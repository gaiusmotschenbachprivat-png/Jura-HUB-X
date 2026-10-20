// End-to-End-Test: Abgleich zweier Geräte über eine Backup-Datei (zwei getrennte
// Browser-Profile), Lesemodus, Diktat (Spracherkennung nachgebildet), Zeitstempel.
//
// Aufruf: node tests/e2e-web/alltag-e2e.mjs   (nach npm run build:web)
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
const PORT = 4185;
const URL0 = `http://127.0.0.1:${PORT}/?e2e`;

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
const errors = [];
const device = async (name) => {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true });
  // Spracherkennung nachbilden (kein Mikrofon im Test)
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
    window.__say = (text, isFinal = true) =>
      window.__rec.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(URL0);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  return { ctx, page, call: (n, ...a) => page.evaluate(([n, a]) => window.__STUDIUM_API__[n](...a), [n, a]) };
};
const doc = (text) => JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

async function exportBackup(page, file) {
  await page.getByRole("button", { name: "Einstellungen & Backup" }).click();
  await page.getByRole("tab", { name: "Backup" }).click();
  await page.getByRole("button", { name: "Jetzt Backup erstellen" }).click();
  await page.locator(".toast", { hasText: "Backup erstellt" }).waitFor({ timeout: 30000 });
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.getByRole("button", { name: "In Dateien sichern" }).first().click()]);
  await download.saveAs(file);
}
async function openMerge(page, file) {
  await page.getByRole("button", { name: "Einstellungen & Backup" }).click();
  await page.getByRole("tab", { name: "Backup" }).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /Backup des anderen Geräts abgleichen/ }).click()]);
  await chooser.setFiles(file);
  const dlg = page.getByRole("dialog", { name: "Abgleich mit anderem Gerät" });
  await dlg.waitFor({ timeout: 20000 });
  return dlg;
}

try {
  // Gerät A (iPad)
  const A = await device("iPad");
  const ids = await A.page.evaluate(async (content) => {
    const api = window.__STUDIUM_API__;
    const area = (await api.areasList())[0];
    const c = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "BGB AT" });
    const n = await api.nodeCreate({ area_id: area.id, parent_id: c.id, kind: "note", title: "Gemeinsame Notiz", content_json: content });
    return { area: area.id, course: c.id, note: n.id };
  }, doc("Ausgangsfassung"));
  const fileA = path.join(OUT, "alltag-A.studiumbackup");
  await exportBackup(A.page, fileA);

  // Gerät B (Laptop): einmalig mit „Wiederherstellen“ einrichten
  const B = await device("Laptop");
  await B.page.getByRole("button", { name: "Einstellungen & Backup" }).click();
  await B.page.getByRole("tab", { name: "Backup" }).click();
  const [ch] = await Promise.all([B.page.waitForEvent("filechooser"), B.page.getByRole("button", { name: /Aus Backup-Datei wiederherstellen/ }).click()]);
  await ch.setFiles(fileA);
  await B.page.getByRole("dialog", { name: "Backup ist in Ordnung" }).getByRole("button", { name: "Wiederherstellen" }).click({ timeout: 15000 });
  await B.page.getByRole("dialog", { name: "Backup wiederherstellen?" }).getByRole("button", { name: "Wiederherstellen" }).click();
  await B.page.waitForEvent("load", { timeout: 30000 });
  await B.page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  check("Gerät B mit dem Backup von A eingerichtet", (await B.call("noteGet", ids.note)).content_json.includes("Ausgangsfassung"));

  // Beide ändern dieselbe Notiz (A zuerst, B später), B legt außerdem Neues an
  await A.call("noteSave", ids.note, doc("Fassung vom iPad"), "Fassung vom iPad");
  await sleep(30);
  await B.call("noteSave", ids.note, doc("Fassung vom Laptop"), "Fassung vom Laptop");
  const newNote = await B.call("nodeCreate", { area_id: ids.area, parent_id: ids.course, kind: "note", title: "Notiz vom Laptop", content_json: doc("Nur auf dem Laptop") });
  await B.call("cardCreate", { area_id: ids.area, node_id: ids.course, kind: "definition", front: "Definiere: Dissens", back: "…" });
  const fileB = path.join(OUT, "alltag-B.studiumbackup");
  await exportBackup(B.page, fileB);

  // Auf A abgleichen: Vorschau, dann übernehmen
  const dlg = await openMerge(A.page, fileB);
  const txt = await dlg.innerText();
  // Die iPad-Fassung steht schon in einer automatischen Version → kein Konflikt-Hinweis nötig
  check("Vorschau: neue Notiz, geänderte Notiz, neue Karte", /Struktur und Notizen\s+1\s+1/.test(txt) && /Notizinhalte\s+1\s+1/.test(txt) && /Karteikarten\s+1\s+0/.test(txt), txt.replace(/\n/g, " | "));
  check("Keine Warnung wegen doppelter Studienbereiche", !txt.includes("doppelt erscheinen"));
  await shot(A.page, "alltag-1-abgleich");
  await dlg.getByRole("button", { name: "Jetzt abgleichen" }).click();
  await A.page.waitForEvent("load", { timeout: 30000 });
  await A.page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  check("Notiz vom Laptop ist auf dem iPad", (await A.call("noteGet", newNote.id)).content_json.includes("Nur auf dem Laptop"));
  check("Jüngere Fassung gilt", (await A.call("noteGet", ids.note)).content_json.includes("Fassung vom Laptop"));
  const versions = await A.call("noteVersions", ids.note);
  let kept = false;
  for (const v of versions) if ((await A.call("noteVersionContent", v.id)).includes("Fassung vom iPad")) kept = true;
  check("iPad-Fassung bleibt in der Versionshistorie", kept, versions.map((v) => v.reason).join(", "));
  check("Karteikarte übernommen", (await A.call("cardsList", {})).some((c) => c.front === "Definiere: Dissens"));
  check("Sicherung vor dem Abgleich angelegt", (await A.page.evaluate(() => window.__STUDIUM_API__.webBackups.list())).some((b) => b.name.includes("vor-Abgleich")));
  // Zweiter Abgleich: nichts mehr zu tun
  const dlg2 = await openMerge(A.page, fileB);
  check("Erneuter Abgleich: nichts zu übernehmen", (await dlg2.innerText()).includes("auf demselben Stand"));
  await dlg2.getByRole("button", { name: "Abbrechen" }).click();

  // Unabhängig eingerichtetes Gerät C: Warnung vor doppelten Bereichen
  const C = await device("Fremd");
  const dlg3 = await openMerge(C.page, fileB);
  check("Warnung bei unabhängig eingerichteten Geräten", (await dlg3.innerText()).includes("doppelt erscheinen"));
  await dlg3.getByRole("button", { name: "Abbrechen" }).click();
  await C.ctx.close();

  // Lesemodus
  const page = A.page;
  await page.locator(".tree-row", { hasText: "BGB AT" }).click();
  await page.locator("main.primary").getByText("Gemeinsame Notiz").click();
  await page.locator(".ProseMirror").waitFor();
  await page.getByRole("button", { name: "Lesemodus" }).click();
  check("Lesemodus: nicht bearbeitbar, ohne Werkzeugleiste, Seitenleiste aus", (await page.locator(".ProseMirror").getAttribute("contenteditable")) === "false" && !(await page.locator(".note .toolbar").isVisible()) && !(await page.locator(".shell-side").count()));
  await shot(page, "alltag-2-lesemodus");
  await page.getByRole("button", { name: "Bearbeiten" }).click();
  check("Zurück zum Bearbeiten", (await page.locator(".ProseMirror").getAttribute("contenteditable")) === "true" && (await page.locator(".shell-side").count()) === 1);

  // Diktat (nachgebildet)
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("End");
  await page.getByRole("button", { name: "Diktat", exact: true }).click();
  const consent = page.getByRole("dialog", { name: "Diktat einschalten?" });
  await consent.waitFor();
  check("Vor dem ersten Diktat: Hinweis auf Spracherkennung durch iPadOS", (await consent.innerText()).includes("Apple"));
  await consent.getByRole("button", { name: "Diktat einschalten" }).click();
  await page.locator(".dictation-bar").waitFor();
  await page.evaluate(() => window.__say("die Willenserklärung", false));
  check("Zwischenergebnis wird angezeigt", (await page.locator(".dictation-bar").innerText()).includes("die Willenserklärung"));
  await page.evaluate(() => window.__say("Die Willenserklärung ist empfangsbedürftig."));
  await page.getByRole("button", { name: "Stopp" }).click();
  const text = await page.locator(".ProseMirror").innerText();
  check("Diktat mit Zeitstempel eingefügt", /\[\d\d:\d\d\] Die Willenserklärung ist empfangsbedürftig\./.test(text), text);
  await page.getByRole("button", { name: "Diktat", exact: true }).click();
  await page.locator(".dictation-bar").waitFor();
  check("Zustimmung wird nur einmal erfragt", (await page.getByRole("dialog", { name: "Diktat einschalten?" }).count()) === 0);
  await page.getByRole("button", { name: "Stopp" }).click();

  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Ablauf ohne Ausnahme", false, e.stack ?? String(e));
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
process.exit(failed.length ? 1 : 0);
