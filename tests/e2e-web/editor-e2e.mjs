// End-to-End-Test der Word-ähnlichen Formatierung in der iPad-Version
// (Playwright, Chromium mit iPad-Bildschirmgröße und Touch).
//
// Aufruf: node tests/e2e-web/editor-e2e.mjs   (nach npm run build:web)
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
const PORT = 4175;
const URL_ = `http://127.0.0.1:${PORT}/?e2e`;

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  – " + extra : ""}`);
  // Im GitHub-Workflow erscheinen Fehler direkt als Hinweis am Lauf
  if (!ok && process.env.GITHUB_ACTIONS) console.log(`::error::${name} – ${String(extra).replace(/\n/g, " ").slice(0, 600)}`);
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
// iPad Air quer
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

const editor = page.locator(".ProseMirror");
const tb = page.locator(".toolbar");
const html = () => editor.innerHTML();

try {
  await page.goto(URL_);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  // Notiz anlegen und öffnen
  await page.evaluate(async () => {
    const api = window.__STUDIUM_API__;
    const area = (await api.areasList())[0];
    await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "note", title: "Vorlesung BGB AT" });
  });
  await page.reload();
  await page.locator(".tree-row", { hasText: "Vorlesung BGB AT" }).first().click();
  await editor.waitFor();
  await editor.click();
  await page.keyboard.type("Anfechtung ist ein Gestaltungsrecht");

  // 1. Schriftart, Größe, Farbe, Hervorhebung auf markierten Text
  await page.keyboard.press("Control+a");
  await tb.getByLabel("Schriftart").selectOption({ label: "Times New Roman" });
  await tb.getByLabel("Schriftgröße").selectOption("14");
  await tb.getByRole("button", { name: "Schriftfarbe" }).click();
  await page.locator(".color-pop").getByRole("button", { name: "Farbe #c00000" }).click();
  await tb.getByRole("button", { name: /^Hervorheben/ }).click();
  await page.locator(".color-pop").getByRole("button", { name: "Farbe #c5f5c1" }).click();
  let h = await html();
  check("Schriftart Times New Roman", h.includes("Times New Roman"), h.slice(0, 300));
  check("Schriftgröße 14 pt", h.includes("font-size: 14pt"));
  check("Schriftfarbe rot", /color: (#c00000|rgb\(192, 0, 0\))/.test(h));
  check("Farbige Hervorhebung", /<mark[^>]*data-color="#c5f5c1"/.test(h));
  check("Werkzeugleiste zeigt aktuelle Schrift", (await tb.getByLabel("Schriftart").inputValue()).includes("Times New Roman"));

  // 2. Absatz: Blocksatz, Zeilenabstand, Einzug (Knopf und Tab)
  await tb.getByRole("button", { name: "Blocksatz" }).click();
  await tb.getByRole("button", { name: "Zeilenabstand" }).click();
  await page.getByRole("menuitem", { name: /^1,5/ }).click();
  await tb.getByRole("button", { name: /^Einzug vergrößern/ }).click();
  await editor.press("Tab");
  h = await html();
  check("Blocksatz", h.includes("text-align: justify"));
  check("Zeilenabstand 1,5", h.includes("line-height: 1.5"));
  check("Einzug zwei Stufen (Knopf + Tab)", h.includes('data-indent="2"'));
  await editor.press("Shift+Tab");
  check("Einzug verkleinern mit ⇧Tab", (await html()).includes('data-indent="1"'));

  // 3. Hochstellen
  // Cursor ans Textende (Fokus kommt von der Werkzeugleiste zurück)
  await editor.locator("p").first().click();
  await sleep(150);
  await page.keyboard.press("End");
  await sleep(100);
  await page.keyboard.press("Control+.");
  await page.keyboard.type("2");
  await page.keyboard.press("Control+.");
  check("Hochgestellt", (await html()).includes("<sup>2</sup>"), (await html()).slice(0, 400));

  // 4. Fußnote einfügen, Nummer, Liste, bearbeiten
  await tb.getByRole("button", { name: /^Fußnote einfügen/ }).click();
  await page.getByLabel("Text der Fußnote").fill("Vgl. BGH NJW 2020, 123.");
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await page.keyboard.type(" Weiter im Text");
  check("Fußnote im Text", (await editor.locator(".footnote-ref").count()) === 1);
  const num = await editor.locator(".footnote-ref").evaluate((el) => getComputedStyle(el, "::after").content);
  check("Fußnote automatisch nummeriert", num.includes("counter") || num === '"1"' || num.includes("1"), num);
  check("Fußnotenliste unter dem Text", (await page.locator(".footnotes").innerText()).includes("Vgl. BGH NJW 2020, 123."));
  await editor.locator(".footnote-ref").tap();
  await page.getByRole("dialog").getByText("Fußnote 1").waitFor({ timeout: 5000 });
  await page.getByLabel("Text der Fußnote").fill("BGH NJW 2020, 123 (125).");
  await page.getByRole("button", { name: "Übernehmen" }).click();
  check("Fußnote per Antippen bearbeitet", (await page.locator(".footnotes").innerText()).includes("(125)"));
  await page.keyboard.type("!");
  check("Nach Bearbeiten steht der Cursor hinter der Fußnote", /class="footnote-ref"[^>]*><\/sup>!/.test(await html()), (await html()).slice(-300));

  // 5. Seitenumbruch
  await tb.getByRole("button", { name: /^Seitenumbruch/ }).click();
  await page.keyboard.type("Zweite Seite");
  check("Seitenumbruch eingefügt, Weiterschreiben auf neuer Seite", (await editor.locator(".page-break").count()) === 1 && (await editor.locator(".page-break + p").innerText()).startsWith("Zweite Seite"), await editor.locator(".page-break + p").innerText().catch(() => ""));
  await shot("editor-ipad-quer");

  // 6. Gespeichert und nach Neuladen unverändert
  await sleep(2500);
  await page.reload();
  await page.locator(".tree-row", { hasText: "Vorlesung BGB AT" }).first().click();
  await editor.waitFor();
  h = await html();
  check(
    "Nach Neuladen: Formatierung erhalten",
    h.includes("Times New Roman") && h.includes("line-height: 1.5") && h.includes('data-indent="1"') && h.includes("text-align: justify"),
  );
  check("Nach Neuladen: Fußnote und Seitenumbruch erhalten", (await editor.locator(".footnote-ref").count()) === 1 && (await editor.locator(".page-break").count()) === 1);

  // 7. Suche findet Fußnotentext
  const hits = await page.evaluate(async () => (await window.__STUDIUM_API__.search("NJW", null)).length);
  check("Suche findet Text aus Fußnoten", hits >= 1);

  // 8. Word-Export
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    (async () => {
      await page.getByRole("button", { name: "Weitere Aktionen" }).click();
      await page.getByRole("menuitem", { name: /Word-Datei/ }).click();
    })(),
  ]);
  const file = path.join(OUT, "editor-export.docx");
  await dl.saveAs(file);
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const xml = await zip.file("word/document.xml").async("string");
  const notes = (await zip.file("word/footnotes.xml")?.async("string")) ?? "";
  check("Word: Schrift, Größe, Farbe", xml.includes('w:ascii="Times New Roman"') && xml.includes('<w:sz w:val="28"/>') && xml.includes('w:val="C00000"'));
  check("Word: Blocksatz, Zeilenabstand, Einzug", xml.includes('<w:jc w:val="both"/>') && /w:line="360"/.test(xml) && /w:left="720"/.test(xml));
  check("Word: echte Fußnote", xml.includes("<w:footnoteReference") && notes.includes("BGH NJW 2020, 123 (125)."));
  check("Word: Seitenumbruch", xml.includes('<w:br w:type="page"/>'));

  // 9. Hochformat: Werkzeugleiste bricht um, nichts ragt heraus
  await page.setViewportSize({ width: 820, height: 1180 });
  await sleep(300);
  const over = await page.evaluate(() => {
    const t = document.querySelector(".toolbar");
    return t.scrollWidth - t.clientWidth;
  });
  check("Hochformat: Werkzeugleiste passt in die Breite", over <= 1, String(over));
  // Geteilte Ansicht (Split View, schmal): eine wischbare Zeile, alle Knöpfe erreichbar
  await page.setViewportSize({ width: 560, height: 1000 });
  await sleep(300);
  const bar = await page.evaluate(() => {
    const t = document.querySelector(".toolbar");
    return { h: Math.round(t.getBoundingClientRect().height), overflow: getComputedStyle(t).overflowX };
  });
  check("Schmal: Werkzeugleiste einzeilig und wischbar", bar.h < 60 && bar.overflow === "auto", JSON.stringify(bar));
  const last = tb.getByRole("button", { name: /^Interne Verknüpfung/ });
  await last.scrollIntoViewIfNeeded();
  const box = await last.boundingBox();
  const tbox = await tb.boundingBox();
  check("Schmal: letzter Knopf erreichbar", !!box && box.x >= tbox.x && box.x + box.width <= tbox.x + tbox.width + 1);
  await page.setViewportSize({ width: 820, height: 1180 });
  await sleep(300);
  await page.evaluate(() => (document.querySelector(".toolbar").scrollLeft = 0));
  const noteW = await page.locator(".note").first().evaluate((el) => el.getBoundingClientRect().width);
  check("Hochformat: Kontextbereich verdeckt den Text nicht dauerhaft", (await page.locator(".shell-context").count()) === 0 && noteW > 380, String(noteW));
  await shot("editor-ipad-hoch");

  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Ablauf ohne Abbruch", false, String(e).slice(0, 500));
  await shot("editor-fehler").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
