// End-to-End-Test: Normen antippen (Wortlaut aus importiertem Gesetz) und
// Zitierhilfe (Quellen, Fußnoten, Literaturverzeichnis in Druck und Word).
// iPad-Größe, Touch, Playwright/Chromium.
//
// Aufruf: node tests/e2e-web/zitieren-e2e.mjs   (nach npm run build:web)
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "../..");
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const JSZip = require(path.join(ROOT, "node_modules/jszip"));
const OUT = process.env.E2E_OUT ?? path.join(ROOT, "target/e2e-web");
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4181;

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
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const editor = page.locator(".ProseMirror");
const dlg = page.getByRole("dialog");

try {
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.evaluate(async () => {
    const api = window.__STUDIUM_API__;
    // Testgesetz (gekürzter Beispieltext, kein amtlicher Wortlaut)
    await api.legalSourceSave({ kind: "gesetz", title: "Bürgerliches Gesetzbuch (Testauszug)", abbreviation: "BGB", version: "Testfassung" }, [
      { norm: "§ 119", absatz: 1, heading: "Anfechtbarkeit wegen Irrtums", text: "Wer bei der Abgabe einer Willenserklärung über deren Inhalt im Irrtum war, kann die Erklärung anfechten (Testtext)." },
      { norm: "§ 119", absatz: 2, heading: "Anfechtbarkeit wegen Irrtums", text: "Als Irrtum über den Inhalt gilt auch der Irrtum über verkehrswesentliche Eigenschaften (Testtext)." },
    ]);
    const area = (await api.areasList())[0];
    const text = "Nach § 119 Abs. 1 BGB ist die Erklärung anfechtbar. Strafbar ist das nicht (§ 263 StGB).";
    await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "note", title: "Hausarbeit BGB", meta: { noteType: "hausarbeit" }, content_json: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }), plain_text: text });
  });
  await page.reload();
  await page.locator(".tree-row", { hasText: "Hausarbeit BGB" }).first().click();
  await editor.waitFor();

  // 1. Normen antippen
  const refs = editor.locator(".norm-ref");
  check("Normzitate im Text erkannt und unterstrichen", (await refs.count()) === 2, String(await refs.count()));
  await refs.first().click();
  const pop = page.locator(".norm-pop");
  await pop.waitFor({ timeout: 5000 });
  await pop.locator(".norm-pop-text").waitFor({ timeout: 5000 });
  const popText = await pop.innerText();
  check("Wortlaut aus dem importierten Gesetz mit Überschrift", popText.includes("Anfechtbarkeit wegen Irrtums") && popText.includes("Wer bei der Abgabe"), popText.slice(0, 160));
  check("Zitierter Absatz hervorgehoben", (await pop.locator("p.is-cited").innerText()).includes("Wer bei der Abgabe"));
  check("Hinweis: Stand nicht geprüft", popText.includes("Testfassung") && popText.includes("prüft Studium OS nicht"));
  await shot("zitieren-norm");
  await pop.getByRole("button", { name: "Schließen" }).click();
  await refs.nth(1).click();
  await pop.waitFor();
  await pop.getByText("noch nicht importiert").waitFor({ timeout: 5000 });
  check("Nicht importiertes Gesetz: Hinweis mit Weg zu den Rechtsquellen", (await pop.getByRole("button", { name: "Zu den Rechtsquellen" }).count()) === 1);
  await page.keyboard.press("Escape");

  // 2. Kommentar zitieren (neue Quelle direkt im Fußnotendialog)
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  await page.getByRole("button", { name: /^Fußnote einfügen/ }).click();
  await dlg.getByRole("tab", { name: "Quelle zitieren" }).click();
  await dlg.getByRole("button", { name: "Neue Quelle" }).click();
  await dlg.getByLabel("Art der Quelle").selectOption("kommentar");
  await dlg.getByLabel("Bearbeiter/in").fill("Ellenberger, Jürgen");
  await dlg.getByLabel("Kommentar").fill("Grüneberg, Bürgerliches Gesetzbuch");
  await dlg.getByLabel("Auflage").fill("83");
  await dlg.getByLabel("Ort").fill("München");
  await dlg.getByLabel("Jahr").fill("2024");
  check("Vorschau Kurzzitat", (await dlg.locator(".quelle-preview").innerText()).includes("Grüneberg/Ellenberger, § 119 Rn. 10."));
  await dlg.getByRole("button", { name: "Quelle anlegen" }).click();
  await dlg.getByLabel("Zitierte Stelle").fill("§ 119 Rn. 10");
  await dlg.getByLabel(/Vgl\./).check();
  check("Fußnotentext entsteht automatisch", (await dlg.locator(".quelle-preview").innerText()).includes("Vgl. Grüneberg/Ellenberger, § 119 Rn. 10."));
  await shot("zitieren-dialog");
  await dlg.getByRole("button", { name: "Übernehmen" }).click();
  await page.waitForFunction(() => document.querySelector(".footnotes")?.textContent?.includes("Grüneberg"), null, { timeout: 5000 });

  // 3. Urteil zitieren
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  await page.getByRole("button", { name: /^Fußnote einfügen/ }).click();
  const citeFirst = await page
    .waitForFunction(() => document.querySelector('[role="dialog"] [role="tab"][aria-selected="true"]')?.textContent?.includes("Quelle zitieren"), null, { timeout: 5000 })
    .then(() => true, () => false);
  check("Mit vorhandenen Quellen startet „Quelle zitieren“", citeFirst);
  await dlg.getByRole("button", { name: "Neue Quelle" }).click();
  await dlg.getByLabel("Art der Quelle").selectOption("urteil");
  await dlg.getByLabel("Gericht").fill("BGH");
  await dlg.getByLabel("Datum").fill("12.3.2020");
  await dlg.getByLabel("Aktenzeichen").fill("I ZR 1/19");
  await dlg.getByLabel("Fundstelle", { exact: true }).fill("NJW 2020, 123");
  await dlg.getByRole("button", { name: "Quelle anlegen" }).click();
  await dlg.getByLabel("Zitierte Stelle").fill("125");
  await dlg.getByRole("button", { name: "Übernehmen" }).click();
  await sleep(300);
  const fns = await page.locator(".footnotes").innerText();
  check("Urteil als Fußnote", fns.includes("BGH, Urt. v. 12.3.2020 – I ZR 1/19, NJW 2020, 123 (125)."), fns);

  // 4. Literaturverzeichnis (nur Literatur, keine Urteile)
  await sleep(1500);
  await page.getByRole("button", { name: "Weitere Aktionen" }).click();
  await page.getByRole("menuitem", { name: /Literaturverzeichnis/ }).click();
  await dlg.locator(".bib-entry").first().waitFor({ timeout: 5000 });
  const bib = await dlg.locator(".bib-entry").allInnerTexts();
  check("Literaturverzeichnis: Kommentar, ohne Urteil", bib.length === 1 && bib[0].startsWith("Ellenberger, Jürgen, Grüneberg, Bürgerliches Gesetzbuch, 83. Aufl., München 2024"), bib.join(" | "));
  await dlg.getByRole("button", { name: "Schließen" }).click().catch(() => page.keyboard.press("Escape"));
  await page.keyboard.press("Escape");

  // 5. Druckansicht mit Literaturverzeichnis
  await page.getByRole("button", { name: "Drucken / als PDF" }).click();
  const overlay = page.locator(".print-overlay");
  await overlay.locator(".pagedjs_page").first().waitFor({ timeout: 20000 });
  check("Druck: Literaturverzeichnis vor dem Text", (await overlay.locator(".bib").innerText()).includes("Grüneberg, Bürgerliches Gesetzbuch"));
  const areas = await overlay.locator(".pagedjs_footnote_area").allInnerTexts();
  check("Druck: Fußnoten unten auf der Seite", areas.some((t) => t.includes("Vgl. Grüneberg/Ellenberger")), areas.join(" | "));
  await shot("zitieren-druck");
  await overlay.getByRole("button", { name: "Druckansicht schließen" }).click();

  // 6. Word-Export
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    (async () => {
      await page.getByRole("button", { name: "Weitere Aktionen" }).click();
      await page.getByRole("menuitem", { name: /Word-Datei/ }).click();
    })(),
  ]);
  const file = path.join(OUT, "zitieren.docx");
  await dl.saveAs(file);
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const xml = await zip.file("word/document.xml").async("string");
  const notes = await zip.file("word/footnotes.xml").async("string");
  check("Word: Literaturverzeichnis vor dem Text, Fußnoten echt", xml.indexOf("Literaturverzeichnis") >= 0 && xml.indexOf("Literaturverzeichnis") < xml.indexOf("anfechtbar") && notes.includes("I ZR 1/19"));

  // 7. Quellen in „Wissen“; Änderung wirkt auf das Verzeichnis
  await page.getByRole("button", { name: "Literatur & Urteile" }).click();
  await page.getByText("Grüneberg/Ellenberger – Grüneberg, Bürgerliches Gesetzbuch").click();
  await page.getByLabel("Auflage").fill("84");
  await sleep(1200);
  await page.locator(".tree-row", { hasText: "Hausarbeit BGB" }).first().click();
  await editor.waitFor();
  await page.getByRole("button", { name: "Weitere Aktionen" }).click();
  await page.getByRole("menuitem", { name: /Literaturverzeichnis/ }).click();
  await dlg.locator(".bib-entry").first().waitFor({ timeout: 5000 });
  check("Geänderte Auflage erscheint im Verzeichnis", (await dlg.locator(".bib-entry").first().innerText()).includes("84. Aufl."));

  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Ablauf ohne Abbruch", false, String(e).slice(0, 500));
  await shot("zitieren-fehler").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
