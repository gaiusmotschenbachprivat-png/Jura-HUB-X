// End-to-End-Test: Klausur (Bogen) – linierter Bogen mit Kopffeldern und Korrekturrand auf jeder
// Seite, Text sitzt auf den Linien (auch nach Seitenwechsel mitten im Absatz), PDF zum Hochladen.
//
// Aufruf: node tests/e2e-web/klausurbogen-e2e.mjs   (nach npm run build:web)
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
const PORT = 4212;

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
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true, permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
// E2E_SLOW=4: langsameren Rechner nachbilden (wie in der Cloud)
if (process.env.E2E_SLOW) await (await ctx.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.E2E_SLOW) });
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
  const area = (await call("areasList"))[0];
  const course = await call("nodeCreate", { area_id: area.id, parent_id: null, kind: "course", title: "Grundkurs Strafrecht I" });
  const para = (t, marks) => ({ type: "paragraph", content: [{ type: "text", text: t, ...(marks ? { marks } : {}) }] });
  const long = "A könnte sich gem. § 212 I StGB wegen Totschlags strafbar gemacht haben, indem er B mit einem Messer in den Arm stach. Dazu müsste er den objektiven und subjektiven Tatbestand verwirklicht haben sowie rechtswidrig und schuldhaft gehandelt haben. ";
  const content = [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Probeklausur Strafrecht AT" }] },
    para("I. Tatbestand", [{ type: "bold" }]),
    para("1. Objektiver Tatbestand"),
    ...Array.from({ length: 6 }, (_, i) => para(`${i + 1}. ${long}`)),
    para(long.repeat(5)), // langer Absatz, läuft über die Seitengrenze
    para("Wichtig: Kausalität ist unproblematisch.", [{ type: "highlight", attrs: { color: null } }]),
    para("Ergebnis: A hat sich strafbar gemacht → Prüfung beendet."),
  ];
  const n = await call("nodeCreate", { area_id: area.id, parent_id: course.id, kind: "note", title: "Probeklausur StR AT", meta: { noteType: "klausurbogen" }, content_json: JSON.stringify({ type: "doc", content }) });
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.locator(".tree-row", { hasText: "Grundkurs Strafrecht I" }).first().click();
  await page.locator("main.primary").getByText("Probeklausur StR AT").first().click();
  await page.locator(".page-klausur .ProseMirror").waitFor({ timeout: 10000 });
  await sleep(1500);

  const sheets = page.locator(".ks-sheet");
  const nSheets = await sheets.count();
  check("Mehrere Bögen", nSheets >= 2, String(nSheets));
  const headTxt = await sheets.first().innerText();
  const today = new Date();
  const dstr = `${String(today.getDate()).padStart(2, "0")}.${String(today.getMonth() + 1).padStart(2, "0")}.${today.getFullYear()}`;
  check("Kopffelder: Fach aus der Veranstaltung, heutiges Datum", headTxt.includes("Grundkurs Strafrecht I") && headTxt.includes(dstr) && headTxt.includes("Name/Kenn-Nr."), headTxt.replace(/\n/g, " | "));
  check("Bogen Nr. auf jeder Seite", (await sheets.nth(1).innerText()).includes("Bogen Nr.") && (await sheets.nth(1).locator(".ks-foot .ks-value").innerText()) === "2");

  // Jede Textzeile sitzt mittig in einer Rasterzeile innerhalb des Schreibbereichs
  const align = () =>
    page.evaluate(() => {
      const MM = 96 / 25.4;
      const root = document.querySelector(".page-klausur .ProseMirror");
      const rr = root.getBoundingClientRect();
      const scale = rr.width / (210 * MM);
      const pagePx = 297 * MM + 28;
      const pitch = 9 * MM;
      const top = 40 * MM;
      const out = { bad: [], lines: 0, worst: 0, outside: 0, right: 0, cuts: root.querySelectorAll(".page-gap.is-cut").length, pages: new Set() };
      const range = document.createRange();
      for (const blk of root.children) {
        if (blk.classList.contains("page-gap")) continue;
        range.selectNodeContents(blk);
        const rows = new Map();
        for (const r of range.getClientRects()) {
          if (r.width < 1 || r.height > pitch * 1.5 * scale) continue; // Zwischenraum, keine Zeile
          const y = (r.top + r.height / 2 - rr.top) / scale;
          const k = Math.round(y);
          if (!rows.has(k)) rows.set(k, r);
          out.right = Math.max(out.right, (r.right - rr.left) / scale / MM);
        }
        for (const [y] of rows) {
          const p = Math.floor(y / pagePx);
          const inPage = y - p * pagePx - top;
          const row = Math.floor(inPage / pitch);
          if (row < 0 || row >= 27) out.outside++;
          const off = Math.abs(inPage - (row + 0.5) * pitch);
          if ((off > 2 || row < 0 || row >= 27) && out.bad.length < 6) out.bad.push(`${blk.tagName}:${blk.textContent.slice(0, 25)} p${p} r${row} off${off.toFixed(1)}`);
          out.worst = Math.max(out.worst, off);
          out.lines++;
          out.pages.add(p);
        }
      }
      return { ...out, pages: out.pages.size, worst: Math.round(out.worst * 10) / 10 };
    });
  const a = await align();
  check("Alle Zeilen auf den Linien (mittig, ±2,5 px)", a.lines > 40 && a.worst <= 2.5 && a.outside === 0, JSON.stringify(a));
  check("Langer Absatz läuft zeilenweise auf den nächsten Bogen", a.cuts >= 1 && a.pages >= 2, JSON.stringify(a));
  check("Text bleibt links vom Korrekturrand", a.right <= 123, String(a.right));
  const rand = await page.evaluate(() => {
    const MM = 96 / 25.4, sh = document.querySelector(".ks-sheet").getBoundingClientRect(), box = document.querySelector(".ks-box").getBoundingClientRect(), d = document.querySelector(".ks-divider").getBoundingClientRect();
    const sc = sh.width / (210 * MM);
    return Math.round(((box.right - d.left) / sc / MM) * 10) / 10;
  });
  check("Korrekturrand: ein Drittel der Seite (70 mm)", Math.abs(rand - 70) < 0.6, `${rand} mm`);
  await page.locator(".note-scroll").evaluate((e) => (e.scrollTop = 0));
  await shot("klausur-1-bogen");

  // Name eintragen → auf allen Bögen
  await page.getByLabel("Name/Kenn-Nr.").fill("Max Muster, 1234567");
  await page.getByLabel("Name/Kenn-Nr.").blur();
  await waitFor(async () => (await sheets.nth(1).innerText()).includes("Max Muster"));
  check("Name auf allen Bögen", (await sheets.first().innerText()).includes("Max Muster") && (await sheets.nth(1).innerText()).includes("Max Muster"));
  await waitFor(async () => (await call("nodesList", null)).find((x) => x.id === n.id)?.meta?.klausur?.name === "Max Muster, 1234567");
  check("Kopffelder gespeichert", (await call("nodesList", null)).find((x) => x.id === n.id)?.meta?.klausur?.name === "Max Muster, 1234567");

  // Weiterschreiben am Ende bleibt im Raster
  await page.locator(".page-klausur .ProseMirror p").last().click();
  await sleep(300);
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Neue Zeile direkt beim Schreiben. " + "Weiter im Gutachtenstil geschrieben. ".repeat(6));
  await sleep(800);
  const b2 = await align();
  check("Nach dem Tippen weiterhin auf den Linien", b2.worst <= 2.5 && b2.outside === 0, JSON.stringify(b2));

  // Text oben einfügen: Umbruch weiter unten (außerhalb des Bildschirms) wandert mit
  await page.locator(".note-scroll").evaluate((e) => (e.scrollTop = 0));
  await page.locator(".page-klausur .ProseMirror p").nth(1).click();
  await sleep(300);
  await page.keyboard.press("End");
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Enter");
    await page.keyboard.type("Zusätzliche Zeile oben.");
  }
  await sleep(1000);
  const b3 = await align();
  check("Einfügen oben: Umbrüche weiter unten passen sich an", b3.worst <= 2.5 && b3.outside === 0 && b3.cuts >= 1, JSON.stringify(b3));
  // keine leeren Zeilen zwischen Absätzen (Blöcke schließen lückenlos an)
  const holes = await page.evaluate(() => {
    const MM = 96 / 25.4, root = document.querySelector(".page-klausur .ProseMirror"), rr = root.getBoundingClientRect(), sc = rr.width / (210 * MM);
    const P = 297 * MM + 28, g = 9 * MM, top = 40 * MM;
    const rowAbs = (y) => { const p = Math.floor(y / P); return p * 27 + (y - p * P - top) / g; };
    const blocks = [...root.children].filter((c) => !c.classList.contains("page-gap"));
    let bad = 0;
    for (let i = 1; i < blocks.length; i++) {
      const prevBottom = blocks[i - 1].getBoundingClientRect().bottom, cur = blocks[i].getBoundingClientRect().top;
      const a = rowAbs((prevBottom - rr.top) / sc - 0.5), b = rowAbs((cur - rr.top) / sc + 0.5);
      if (Math.floor(b) - Math.ceil(a) > 0) bad++;
    }
    return bad;
  });
  check("Keine leeren Zeilen zwischen Absätzen", holes === 0, String(holes));

  // Dunkelmodus: Papier bleibt hell, Text dunkel
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  const colors = await page.evaluate(() => [getComputedStyle(document.querySelector(".page-klausur .ProseMirror")).color, getComputedStyle(document.querySelector(".ks-sheet")).backgroundColor]);
  check("Dunkelmodus: dunkle Schrift auf weißem Bogen", colors[0] === "rgb(26, 26, 26)" && colors[1] === "rgb(255, 255, 255)", colors.join(" "));
  await shot("klausur-2-dunkel");
  await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));

  // Seiten anderer Dateien vor den Bogen: PDF aus den Unterlagen + Bild vom Gerät
  const fixture = fs.readFileSync(path.join(ROOT, "tests/e2e/fixtures/folien.pdf")).toString("base64");
  const imported = await page.evaluate(async ([courseId, b64]) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const res = await window.__STUDIUM_API__.__importBlob(new File([bytes], "Sachverhalt Fall 3.pdf", { type: "application/pdf" }), courseId);
    return res.map((r) => r.error ?? "ok").join(",");
  }, [course.id, fixture]);
  check("Sachverhalt (PDF) importiert", imported === "ok", imported);
  await waitFor(async () => (await call("documentsList", { kind: "subtree", id: course.id })).some((d) => d.title.includes("Sachverhalt Fall 3")), 15000);
  // Menü öffnen (auf langsamen Rechnern ggf. ein zweites Mal)
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Datei davor …" }).click();
    if (await page.getByRole("menuitem", { name: /Sachverhalt Fall 3/ }).waitFor({ timeout: 5000 }).then(() => true, () => false)) break;
    await page.keyboard.press("Escape");
    await sleep(500);
  }
  await page.getByRole("menuitem", { name: /Sachverhalt Fall 3/ }).click();
  await page.locator(".vorab-sheet img").first().waitFor({ timeout: 15000 });
  await waitFor(async () => (await page.locator(".vorab-sheet img").count()) === 2, 15000);
  check("PDF-Seiten erscheinen vor Bogen 1", (await page.locator(".vorab-sheet img").count()) === 2 && (await page.locator(".vorab-chip").first().innerText()).includes("Sachverhalt Fall 3"));
  const order = await page.evaluate(() => document.querySelector(".vorab-pages").getBoundingClientRect().bottom <= document.querySelector(".ks-sheet").getBoundingClientRect().top + 1);
  check("… oberhalb des ersten Bogens", order);
  // Bild vom Gerät (1×1-PNG genügt)
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
  await page.getByRole("button", { name: "Datei davor …" }).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("menuitem", { name: /Vom Gerät wählen/ }).click()]);
  await chooser.setFiles({ name: "Deckblatt.png", mimeType: "image/png", buffer: png });
  await waitFor(async () => (await page.locator(".vorab-chip").count()) === 2, 15000);
  await waitFor(async () => (await page.locator(".vorab-sheet img").count()) === 3, 15000);
  check("Bild vom Gerät ebenfalls davor", (await page.locator(".vorab-chip").nth(1).innerText()).includes("Deckblatt"));
  // Reihenfolge ändern: Deckblatt nach vorne
  await page.getByRole("button", { name: "Weiter nach vorne" }).click();
  await waitFor(async () => (await page.locator(".vorab-chip").first().innerText()).includes("Deckblatt"));
  const saved = (await call("nodesList", null)).find((x) => x.id === n.id)?.meta?.klausur;
  check("Auswahl gespeichert (Deckblatt zuerst)", Array.isArray(saved?.vorab) && saved.vorab.length === 2 && saved.name === "Max Muster, 1234567", JSON.stringify(saved));
  await shot("klausur-3-vorab");

  // PDF speichern
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByRole("button", { name: "Als PDF speichern" }).first().click()]);
  const file = path.join(OUT, "klausur.pdf");
  await dl.saveAs(file);
  check("PDF-Datei mit Titel als Name", dl.suggestedFilename() === "Probeklausur StR AT.pdf", dl.suggestedFilename());
  const pdfjs = await import(path.join(ROOT, "node_modules/pdfjs-dist/legacy/build/pdf.mjs"));
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)) }).promise;
  const screenPages = await sheets.count();
  check("PDF: vorangestellte Seiten + Bögen", pdf.numPages === screenPages + 3, `${pdf.numPages} / ${screenPages} + 3`);
  const firstText = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => i.str).join(" ");
  const p2Text = (await (await pdf.getPage(2)).getTextContent()).items.map((i) => i.str).join(" ");
  const p4Text = (await (await pdf.getPage(4)).getTextContent()).items.map((i) => i.str).join(" ");
  check("PDF: zuerst Deckblatt (Bild), dann Sachverhalt, dann Bogen 1", !firstText.includes("Bogen Nr.") && p2Text.length > 0 && !p2Text.includes("Bogen Nr.") && p4Text.includes("Bogen Nr."), `${firstText.slice(0, 40)} | ${p2Text.slice(0, 60)} | ${p4Text.slice(0, 60)}`);
  const p1 = await pdf.getPage(4);
  const vp = p1.getViewport({ scale: 1 });
  check("PDF: A4-Format", Math.abs(vp.width - 595.3) < 1 && Math.abs(vp.height - 841.9) < 1, `${vp.width}x${vp.height}`);
  let all = "";
  let worst = 0;
  let items = 0;
  for (let i = 4; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i);
    const tc = await pg.getTextContent();
    for (const it of tc.items) {
      all += it.str + " ";
      const yTop = (841.89 - it.transform[5]) / (72 / 25.4); // Grundlinie in mm von oben
      const size = Math.hypot(it.transform[2], it.transform[3]);
      if (yTop < 40 || yTop > 283 || size < 10) continue; // Kopf, Fuß
      const fs = size / (72 / 25.4);
      const rowTop = yTop - 4.5 - (0.891 - 0.5535) * fs; // Umkehrung von baselineMm
      const off = Math.abs((rowTop - 40) / 9 - Math.round((rowTop - 40) / 9)) * 9;
      worst = Math.max(worst, off);
      items++;
    }
  }
  check("PDF: Text vollständig und durchsuchbar", all.includes("Probeklausur Strafrecht AT") && all.includes("Totschlags") && all.includes("Max Muster, 1234567") && all.includes("Grundkurs Strafrecht I") && all.includes("Neue Zeile direkt beim Schreiben."), all.slice(0, 200));
  check("PDF: Wörter sitzen auf den Rasterzeilen", items > 30 && worst < 0.3, `${items} Wörter, Abweichung ${worst.toFixed(2)} mm`);
  check("PDF: Bogen Nr. und Pfeil ersetzt", all.includes("Bogen Nr.") && all.includes("-> Prüfung"), "");
  // Seite 1 als Bild für die Sichtprüfung
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.stack ?? e.message);
  await shot("klausur-abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
