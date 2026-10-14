// End-to-End-Test der Browser-/iPad-Version (Build aus `npm run build:web`).
// Startet `vite preview`, bedient die Oberfläche mit Playwright und prüft den
// Weg Oberfläche → Worker → SQLite (OPFS) → Dateispeicher, inkl. Neuladen,
// Backup, Wiederherstellung und Offline-Betrieb.
//
// Aufruf: node tests/e2e-web/web-e2e.mjs   (Umgebung: PLAYWRIGHT_MODULE, CHROMIUM)
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "../..");
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const PDF = path.join(ROOT, "tests/e2e/fixtures/folien.pdf");
const OUT = process.env.E2E_OUT ?? path.join(ROOT, "target/e2e-web");
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4173;
const URL_ = `http://127.0.0.1:${PORT}/?e2e`;

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  – " + extra : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, acceptDownloads: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "warning" || m.type() === "error") console.log("  [browser]", m.text()); });
const api = (method, ...args) =>
  page.evaluate(
    async ([m, a]) => {
      try {
        return { ok: (await window.__STUDIUM_API__[m](...a)) ?? null };
      } catch (e) {
        return { err: e };
      }
    },
    [method, args],
  );
const shot = (name) => page.screenshot({ path: path.join(OUT, name + ".png") });

try {
  // 1. Start und Ersteinrichtung
  await page.goto(URL_);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor();
  check("Ersteinrichtung legt 3 Studienbereiche + Gesamtansicht an", (await page.locator(".area-tab").count()) === 4);
  const info = (await api("appInfo")).ok;
  check("Daten liegen im Browser-Speicher (Plattform web, Schema 2)", info?.platform === "web" && info?.schema_version === 2, JSON.stringify(info));

  // 2. Veranstaltung und Notiz über die Oberfläche
  await page.locator(".area-tab").first().click();
  await page.locator(".tree-row").first().click({ button: "right" });
  await page.locator("button, [role=menuitem]", { hasText: "Veranstaltung hinzufügen" }).first().click();
  const rename = page.locator(".tree-rename");
  await rename.fill("BGB AT");
  await rename.press("Enter");
  await sleep(500);
  check("Veranstaltung anlegen und umbenennen", (await page.locator(".page-title").inputValue()) === "BGB AT");
  await page.getByRole("button", { name: "Notiz", exact: true }).click();
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("Die Anfechtung nach § 119 BGB wirkt rückwirkend. Stichwort Gestaltungsrecht.");
  await page.locator(".save-status", { hasText: "Gespeichert" }).waitFor({ timeout: 8000 });
  check("Autosave meldet „Gespeichert“", true);
  await shot("01-note");

  // 3. PDF-Import über die echte Dateiauswahl
  await page.getByRole("button", { name: "Einstellungen & Backup" }).waitFor();
  await page.locator(".tree-row", { hasText: "BGB AT" }).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Dokumente importieren" }).first().click()]);
  await chooser.setFiles(PDF);
  await page.getByRole("dialog").getByRole("button", { name: "Importieren" }).click();
  // Bei Erfolg schließt sich der Dialog von selbst
  await page.getByRole("dialog").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  let docs = [];
  for (let i = 0; i < 40; i++) {
    docs = (await api("documentsList", { kind: "all" })).ok ?? [];
    if (docs[0]?.text_status === "ok") break;
    await sleep(300);
  }
  check("PDF über die Dateiauswahl importiert", docs.length === 1 && docs[0].file_present === true, JSON.stringify(docs[0]?.text_status));
  check("PDF-Text lokal ausgelesen", docs[0]?.text_status === "ok");

  // 4. Suche über die Oberfläche
  await page.keyboard.press("Control+k");
  const input = page.locator(".palette-input input");
  await input.fill("Weinversteigerung");
  await sleep(700);
  check("Suche findet PDF-Text mit Seitenangabe (S. 2)", (await page.locator(".palette-item", { hasText: "S. 2" }).count()) >= 1);
  await input.fill("Gestaltungsrecht");
  await sleep(700);
  check("Suche findet die Notiz", (await page.locator(".palette-item").count()) >= 1);
  await input.fill("Weinversteigerung");
  await sleep(500);
  await input.press("Enter");
  await page.locator(".pdf-page canvas").first().waitFor({ timeout: 15000 });
  await sleep(1200);
  check("PDF öffnet auf der gefundenen Seite", (await page.locator(".pdf-page-input").inputValue()) === "2");
  await shot("02-pdf");

  // 5. Neu laden: alles ist noch da (Speicherung im Gerät)
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  const nodes = (await api("nodesList", null)).ok;
  const note = nodes.find((n) => n.kind === "note");
  const saved = (await api("noteGet", note.id)).ok;
  check("Nach Neuladen: Notiz vorhanden", saved.content_json.includes("Gestaltungsrecht"));
  check("Nach Neuladen: Dokument vorhanden", ((await api("documentsList", { kind: "all" })).ok ?? []).length === 1);

  // 6. Backup über die Oberfläche
  await page.getByRole("button", { name: "Einstellungen & Backup" }).click();
  await page.getByRole("tab", { name: "Backup" }).click();
  await page.getByRole("button", { name: "Jetzt Backup erstellen" }).click();
  await page.locator(".toast", { hasText: "Backup erstellt" }).waitFor({ timeout: 30000 });
  const list = await page.evaluate(() => window.__STUDIUM_API__.webBackups.list());
  check("Backup im App-Speicher erstellt und geprüft", list.length === 1, list[0]?.name);
  await shot("03-backup");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    page.getByRole("button", { name: "In Dateien sichern" }).first().click(),
  ]);
  const backupFile = path.join(OUT, download.suggestedFilename());
  await download.saveAs(backupFile);
  check("„In Dateien sichern“ gibt die Backup-Datei heraus", fs.statSync(backupFile).size > 1000, download.suggestedFilename());

  // Inhalt nach dem Backup ändern
  await api("noteSave", note.id, JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Versehentlich überschrieben" }] }] }), "Versehentlich überschrieben");

  // 7. Wiederherstellen aus der herausgegebenen Datei (über die Oberfläche)
  const [chooser2] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /Aus Backup-Datei wiederherstellen/ }).click()]);
  await chooser2.setFiles(backupFile);
  await page.getByRole("dialog", { name: "Backup ist in Ordnung" }).getByRole("button", { name: "Wiederherstellen" }).click({ timeout: 15000 });
  await page.getByRole("dialog", { name: "Backup wiederherstellen?" }).getByRole("button", { name: "Wiederherstellen" }).click();
  await page.waitForEvent("load", { timeout: 30000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  const restored = (await api("noteGet", note.id)).ok;
  check("Notizinhalt aus dem Backup ist zurück", restored.content_json.includes("Gestaltungsrecht") && !restored.content_json.includes("Versehentlich"));
  const docAfter = ((await api("documentsList", { kind: "all" })).ok ?? [])[0];
  check("Dokument und Datei nach Wiederherstellung vorhanden", docAfter?.file_present === true);
  const all = await page.evaluate(() => window.__STUDIUM_API__.webBackups.list());
  check("Vorheriger Stand als eigenes Backup aufbewahrt", all.some((b) => b.name.includes("vor-Wiederherstellung")));

  // 8. Beschädigtes Backup wird abgelehnt
  const raw = fs.readFileSync(backupFile);
  const broken = path.join(OUT, "kaputt.studiumbackup");
  fs.writeFileSync(broken, raw.subarray(0, Math.floor(raw.length * 0.6)));
  await page.getByRole("button", { name: "Einstellungen & Backup" }).click();
  await page.getByRole("tab", { name: "Backup" }).click();
  const [chooser3] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /Backup-Datei prüfen/ }).click()]);
  await chooser3.setFiles(broken);
  await page.getByRole("dialog", { name: /beschädigt/ }).waitFor({ timeout: 15000 });
  check("Beschädigtes Backup wird erkannt", true);
  await page.getByRole("dialog").getByRole("button", { name: "Schließen" }).click();

  // 9. Sicherheitsgrenzen
  const net = await page.evaluate(() => fetch("https://example.org").then(() => "erreicht", () => "blockiert"));
  check("Netzwerkzugriff auf fremde Server ist blockiert (CSP)", net === "blockiert", net);
  const bad = await api("noteSave", "../../etc", "{}", "");
  check("Ungültige Kennungen werden abgelehnt", bad.err?.code === "invalid");

  // 10. Zweiter Tab: kein gleichzeitiger Zugriff auf die Datenbank
  const second = await context.newPage();
  await second.goto(URL_);
  await second.getByText("bereits in einem anderen Tab").waitFor({ timeout: 20000 }).then(
    () => check("Zweiter Tab wird sicher abgewiesen (kein Datenchaos)", true),
    () => check("Zweiter Tab wird sicher abgewiesen (kein Datenchaos)", false),
  );
  await second.close();

  // 11. Offline: App startet ohne Server aus dem Service Worker
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await sleep(1500);
  await context.setOffline(true);
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 }).then(
    () => check("Startet offline (Service Worker)", true),
    () => check("Startet offline (Service Worker)", false),
  );
  const offlineNote = (await api("noteGet", note.id)).ok;
  check("Offline: Daten verfügbar", offlineNote?.content_json.includes("Gestaltungsrecht"));
  await context.setOffline(false);

  // 12. iPad hochkant
  await page.setViewportSize({ width: 820, height: 1180 });
  await sleep(500);
  await shot("04-hochkant");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check("Hochkant (820 px) ohne seitliches Scrollen", !overflow);

  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.message);
  await shot("abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
