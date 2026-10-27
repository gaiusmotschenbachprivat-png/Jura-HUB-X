// End-to-End-Test: Bilder als Folien, Gesetz ergänzen, Wortlaut kopieren/einfügen.
// iPad quer.
//
// Aufruf: node tests/e2e-web/bildfolien-e2e.mjs   (nach npm run build:web)
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
const PORT = 4189;

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
  // Drei Bilder als Folien (z. B. Fotos/Screenshots der Vorlesungsfolien)
  const imgs = [];
  for (const [i, color] of [[1, "#cfe3ff"], [2, "#ffe3c4"], [10, "#d8f5d0"]]) {
    const p = await browser.newPage({ viewport: { width: 400, height: 240 } });
    await p.setContent(`<div style="width:400px;height:240px;background:${color};font:bold 40px sans-serif;display:grid;place-items:center">Folie ${i}</div>`);
    const f = path.join(OUT, `Folie ${i}.png`);
    await p.screenshot({ path: f });
    await p.close();
    imgs.push(f);
  }

  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.evaluate(async () => {
    const api = window.__STUDIUM_API__;
    const area = (await api.areasList())[0];
    const c = await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "BGB AT" });
    const text = "Geschäftsunfähig ist nach § 104 Nr. 1, wer nicht das siebente Lebensjahr vollendet hat.";
    await api.nodeCreate({ area_id: area.id, parent_id: c.id, kind: "note", title: "1. Vorlesung", meta: { noteType: "vorlesung", number: 1 }, content_json: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }), plain_text: text });
    // erfundener Wortlaut (Testdaten, kein echter Gesetzestext)
    await api.legalSourceSave({ kind: "gesetz", title: "Bürgerliches Gesetzbuch", abbreviation: "BGB", version: "Testfassung" }, [
      { norm: "§ 104", absatz: null, heading: "Geschäftsunfähigkeit – Titel 1 Geschäftsfähigkeit", text: "Geschäftsunfähig ist: 1. wer nicht das siebente Lebensjahr vollendet hat," },
    ]);
  });
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });

  // Bilder in die Veranstaltung importieren
  await page.locator(".tree-row", { hasText: "BGB AT" }).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Dokumente importieren" }).first().click()]);
  await chooser.setFiles(imgs);
  await page.getByRole("dialog").getByRole("button", { name: "Importieren" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const docs = await waitFor(async () => {
    const l = await call("documentsList", { kind: "all" });
    return l.length === 3 ? l : null;
  });
  check("Drei Bilder importiert", docs?.length === 3);

  // 1. Folienauswahl listet Bilder (nach Namen: 1, 2, 10)
  await page.locator("main.primary").getByText("1. Vorlesung").click();
  await page.locator(".ProseMirror").waitFor();
  await page.getByRole("button", { name: "Folien", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Folien auswählen" });
  await picker.getByText("Unterlagen · BGB AT").waitFor();
  const rows = await picker.locator("button.slide-pick").allInnerTexts();
  check("Folienauswahl zeigt die Bilder als Folien", rows.length === 3 && rows.every((r) => r.includes("Bild")), rows.join(" | "));
  check("Reihenfolge nach Namen (Folie 2 vor Folie 10)", rows[0].startsWith("Folie 1") && rows[1].startsWith("Folie 2") && rows[2].startsWith("Folie 10"), rows.join(" | "));
  await picker.locator("button.slide-pick").first().click();
  const side = page.locator("section.secondary");
  await side.locator(".img-view img").waitFor({ timeout: 10000 });
  check("Bild als Folie neben der Mitschrift", (await side.locator(".image-slide-bar").innerText()).includes("1 / 3"));
  await shot("bildfolien-1");

  // 2. Blättern
  await side.getByRole("button", { name: "Nächste Folie" }).click();
  await side.getByText("2 / 3").waitFor({ timeout: 10000 });
  check("Nächste Folie: Folie 2", (await side.locator(".doc-title").innerText()).startsWith("Folie 2"));
  const remembered = await waitFor(async () => {
    const n = (await call("nodesList", null)).find((x) => x.title === "1. Vorlesung");
    return n?.meta?.slides?.document_id === docs.find((d) => d.title.startsWith("Folie 2"))?.id ? n : null;
  });
  check("Notiz merkt sich die Bild-Folie", !!remembered);

  // 3. Folie übernehmen
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("Control+End");
  await side.getByRole("button", { name: "Folie übernehmen" }).click();
  await page.locator(".ProseMirror img").first().waitFor({ timeout: 10000 });
  const pm = await page.locator(".ProseMirror").innerText();
  check("Bild in die Mitschrift übernommen (mit Bildunterschrift)", (await page.locator(".ProseMirror img").count()) === 1 && pm.includes("Folie 2"), pm.slice(-80));
  await side.getByRole("button", { name: "Geteilte Ansicht schließen" }).click();

  // 4. Norm ohne Gesetz → BGB (Titel „BGB AT“), Wortlaut kopieren und einfügen
  const ref = page.locator(".ProseMirror .norm-ref").first();
  await ref.waitFor({ timeout: 10000 });
  check("„§ 104 Nr. 1“ ohne Gesetz erkannt (BGB aus dem Titel)", (await ref.getAttribute("data-law")) === "BGB" && (await ref.getAttribute("class")).includes("is-inferred"));
  await ref.click();
  const pop = page.locator(".norm-pop");
  await pop.locator(".norm-pop-text").waitFor({ timeout: 5000 });
  check("Fenster nennt das angenommene Gesetz", (await pop.innerText()).includes("angenommen: BGB"));
  await pop.getByRole("button", { name: "Kopieren" }).click();
  const clip = await waitFor(async () => {
    const t = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
    return t.includes("§ 104 BGB") ? t : null;
  });
  check("Wortlaut kopiert (mit Überschrift und Quelle)", !!clip && clip.includes("Geschäftsunfähig ist") && clip.includes("Testfassung"), String(clip));
  await pop.getByRole("button", { name: "In Mitschrift einfügen" }).click();
  const box = page.locator(".ProseMirror .callout-gesetz");
  await box.waitFor({ timeout: 5000 });
  const boxText = await box.innerText();
  check("Wortlaut als Gesetzestext-Kasten eingefügt", boxText.toLowerCase().includes("§ 104 bgb – geschäftsunfähigkeit") && boxText.includes("siebente Lebensjahr"), boxText);
  await shot("bildfolien-2-norm");
  // 5. Suche nach „§104“ findet den Wortlaut im importierten BGB
  await page.locator(".side-search").click();
  await page.locator(".palette-input input").fill("§104");
  const lawItem = page.locator(".palette-item", { hasText: "§ 104 BGB" });
  await lawItem.waitFor({ timeout: 5000 });
  check("Suche „§104“ zeigt den Paragraphen (Gruppe Gesetze)", /gesetze/i.test(await page.locator(".palette").innerText()) && (await lawItem.innerText()).includes("Geschäftsunfähigkeit"));
  await lawItem.click();
  await page.locator(".norm-pop .norm-pop-text").waitFor({ timeout: 5000 });
  check("Antippen zeigt den Wortlaut mit „Kopieren“", (await page.locator(".norm-pop").getByRole("button", { name: "Kopieren" }).count()) === 1);
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.message);
  await shot("bildfolien-abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
