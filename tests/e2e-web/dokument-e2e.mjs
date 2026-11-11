// End-to-End-Test: Dokument (A4) – Seitenansicht wie in Word: Seiten, Seitenzahlen, Umbruch, Ränder, Schrift,
// Druck mit denselben Einstellungen (ohne eingefügten Titel), schmale Ansicht (Verkleinerung).
//
// Aufruf: node tests/e2e-web/dokument-e2e.mjs   (nach npm run build:web)
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
const PORT = 4207;

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

const T = (text) => ({ type: "text", text });
const P = (text) => ({ type: "paragraph", content: [T(text)] });
const H = (level, text) => ({ type: "heading", attrs: { level }, content: [T(text)] });
const LOREM = "Der Anspruch des K gegen V auf Übergabe und Übereignung der Kaufsache aus § 433 Abs. 1 S. 1 BGB setzt einen wirksamen Kaufvertrag voraus, der durch zwei übereinstimmende Willenserklärungen, Angebot und Annahme, zustande kommt.";

try {
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  const course = await page.evaluate(async () => {
    const api = window.__STUDIUM_API__;
    const area = (await api.areasList())[0];
    return (await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "BGB AT" })).id;
  });
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });

  // 1. Über den Anlege-Dialog: „Dokument (A4)“
  await page.locator(".tree-row", { hasText: "BGB AT" }).first().click();
  await page.getByRole("button", { name: "Neu …" }).click();
  await page.getByRole("radio", { name: /Dokument \(A4\)/ }).click();
  await page.getByRole("dialog").getByLabel("Titel").fill("Schriftsatz Übung");
  await page.getByRole("button", { name: "Anlegen" }).click();
  await page.locator(".ProseMirror.is-paged").waitFor({ timeout: 8000 });
  const nodes = await call("nodesList", null);
  const docNode = nodes.find((n) => n.title === "Schriftsatz Übung");
  check("Dokument (A4) angelegt", docNode?.meta?.noteType === "dokument", JSON.stringify(docNode?.meta));
  const sheet = page.locator(".ProseMirror.is-paged");
  const w = (await sheet.boundingBox()).width;
  const z = Number(await page.locator(".page-desk").evaluate((e) => e.style.zoom || 1));
  check("Blatt in A4-Breite (21 cm, ggf. verkleinert)", Math.abs(w / z - 793.7) < 3, `${w} / ${z}`);

  await shot("dok-0-leer");
  const ph = await page.evaluate(() => {
    const root = document.querySelector(".ProseMirror.is-paged");
    const p = root.querySelector("p");
    return { rootTop: root.getBoundingClientRect().top, pTop: p.getBoundingClientRect().top, children: [...root.children].map((c) => c.className || c.tagName) };
  });
  check("Leeres Dokument: Schreibmarke oben im Rand", Math.abs((ph.pTop - ph.rootTop) / Number(await page.locator(".page-desk").evaluate((e) => e.style.zoom || 1)) - 94.5) < 3, JSON.stringify(ph));
  // 2. Viel Text → mehrere Seiten (vorher die Mitschrift verlassen, damit ihr leerer Stand nichts überschreibt)
  await page.getByRole("button", { name: "Übersicht" }).first().click();
  await sleep(500);
  const content = [H(1, "Gutachten"), ...Array.from({ length: 26 }, (_, i) => P(`${i + 1}. ${LOREM}`)), { type: "pageBreak" }, H(2, "Anhang"), P("Neue Seite nach dem Umbruch.")];
  await page.evaluate(([id, doc]) => window.__STUDIUM_API__.noteSave(id, JSON.stringify(doc), "x"), [docNode.id, { type: "doc", content }]);
  await page.reload();
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.locator(".tree-row", { hasText: "BGB AT" }).click();
  await page.locator("main.primary").getByText("Schriftsatz Übung").click();
  await sheet.waitFor();
  await waitFor(async () => Number(await sheet.getAttribute("data-pages")) >= 3);
  const pages = Number(await sheet.getAttribute("data-pages"));
  const gaps = await page.locator(".page-gap").count();
  check("Mehrere Seiten mit Zwischenräumen", pages >= 3 && gaps === pages - 1, `${pages} Seiten, ${gaps} Zwischenräume`);
  // jeder Zwischenraum endet genau am oberen Rand der nächsten Seite: nächster Block beginnt bei Seitenanfang + Rand
  const geo = await page.evaluate(() => {
    const root = document.querySelector(".ProseMirror.is-paged");
    const zoom = Number(document.querySelector(".page-desk").style.zoom || 1);
    const r0 = root.getBoundingClientRect().top;
    const gapsEls = [...root.querySelectorAll(":scope > .page-gap")];
    return gapsEls.map((g) => {
      const next = g.nextElementSibling;
      return { nextTop: (next.getBoundingClientRect().top - r0) / zoom, text: next.textContent.slice(0, 20) };
    });
  });
  const pageH = 1122.5, gapPx = 28, top = 94.5;
  check("Blöcke beginnen oben auf der neuen Seite", geo.every((g, i) => Math.abs(g.nextTop - ((i + 1) * (pageH + gapPx) + top)) < 4), JSON.stringify(geo));
  check("Seitenumbruch: „Anhang“ beginnt eine neue Seite", geo.some((g) => g.text.startsWith("Anhang")), JSON.stringify(geo.map((g) => g.text)));
  const nums = await page.locator(".page-foot").allTextContents();
  check("Seitenzahlen", nums.join(",") === Array.from({ length: pages - 1 }, (_, i) => String(i + 1)).join(","), nums.join(","));
  await shot("dok-1-seiten");

  // 3. Weitertippen verschiebt die Umbrüche
  await sheet.locator("p").first().click();
  await page.keyboard.press("End");
  for (let i = 0; i < 6; i++) await page.keyboard.press("Enter");
  await sleep(400);
  const geo2 = await page.evaluate(() => [...document.querySelectorAll(".ProseMirror.is-paged > .page-gap")].map((g) => g.nextElementSibling.textContent.slice(0, 6)));
  check("Umbrüche passen sich an", geo2[0] !== geo[0].text.slice(0, 6), `${geo[0].text} → ${geo2[0]}`);
  for (let i = 0; i < 6; i++) await page.keyboard.press("Backspace");

  // 4. Seiteneinstellungen: Korrekturrand, Hausarbeit
  await page.getByLabel("Seitenränder").selectOption("korrektur");
  await page.getByLabel("Seitenschrift").selectOption("hausarbeit");
  await waitFor(async () => (await sheet.evaluate((e) => getComputedStyle(e).paddingRight)) === "264.567px");
  const st = await sheet.evaluate((e) => ({ pr: getComputedStyle(e).paddingRight, ff: getComputedStyle(e).fontFamily, ta: getComputedStyle(e).textAlign, fs: getComputedStyle(e).fontSize }));
  check("Korrekturrand 7 cm und Hausarbeitsschrift", st.pr.startsWith("264.5") && /Times/.test(st.ff) && st.ta === "justify" && st.fs === "16px", JSON.stringify(st));
  const meta = (await call("nodesList", null)).find((n) => n.id === docNode.id).meta;
  check("Seiteneinstellungen gespeichert", meta.page?.margins === "korrektur" && meta.page?.style === "hausarbeit" && meta.noteType === "dokument", JSON.stringify(meta));
  await shot("dok-2-korrektur");

  // 5. Druck mit denselben Einstellungen, ohne eingefügten Titel
  await page.getByRole("button", { name: "Drucken / als PDF" }).click();
  await page.locator(".pagedjs_page").first().waitFor({ timeout: 20000 });
  const pr = await page.evaluate(() => ({
    title: !!document.querySelector(".pagedjs_page .doc-title"),
    margins: document.querySelector('select[aria-label="Ränder"]')?.value ?? [...document.querySelectorAll("select")].map((s) => s.value).join("|"),
  }));
  check("Druck: ohne eingefügten Titel, Korrekturrand übernommen", !pr.title && /korrektur/.test(pr.margins), JSON.stringify(pr));
  // warten, bis der Seitenaufbau fertig ist (Seitenzahl stabil)
  let last = -1;
  for (let i = 0; i < 20; i++) {
    const n = await page.locator(".pagedjs_page").count();
    if (n === last) break;
    last = n;
    await sleep(500);
  }
  await shot("dok-3-druck");
  const flow = await page.evaluate(() => {
    const pages = [...document.querySelectorAll(".pagedjs_page")];
    const text = pages.map((p) => p.querySelector(".pagedjs_page_content").textContent).join("");
    const first = pages[0].querySelector(".pagedjs_page_content");
    const c = first.getBoundingClientRect();
    const last = [...first.querySelectorAll("p")].pop().getBoundingClientRect();
    return { n: pages.length, dup: (text.match(/(?<![0-9])1\. Der Anspruch/g) || []).length, fill: Math.round(((last.bottom - c.top) / c.height) * 100) };
  });
  check("Druck: Text einmal, erste Seite voll", flow.dup === 1 && flow.fill > 85, JSON.stringify(flow));
  await page.getByRole("button", { name: "Druckansicht schließen" }).click();
  await page.locator(".pagedjs_page").first().waitFor({ state: "detached", timeout: 5000 });

  // 6. Schmale Ansicht (iPad hochkant): Blatt wird verkleinert, nicht abgeschnitten
  await page.setViewportSize({ width: 700, height: 900 });
  await sleep(500);
  const narrow = await page.evaluate(() => {
    const s = document.querySelector(".note-scroll");
    return { overflow: s.scrollWidth - s.clientWidth, zoom: document.querySelector(".page-desk").style.zoom };
  });
  check("Schmal: verkleinert statt seitlich zu scrollen", narrow.overflow <= 2 && Number(narrow.zoom) < 1, JSON.stringify(narrow));
  await shot("dok-4-schmal");
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.stack ?? e.message);
  await shot("dok-abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
