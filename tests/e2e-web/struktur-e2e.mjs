// End-to-End-Test: Vorlesungen und andere Schreibarten anlegen, sortieren,
// Layout ohne Überlappungen (iPad-Größe, Touch, Playwright/Chromium).
//
// Aufruf: node tests/e2e-web/struktur-e2e.mjs   (nach npm run build:web)
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
const PORT = 4176;

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  – " + extra : ""}`);
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
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const nodes = () => page.evaluate(async () => window.__STUDIUM_API__.nodesList(null));

/** Überlappen sich sichtbare Elemente einer Liste? (verschobene Elemente) */
const overlaps = (selector) =>
  page.evaluate((sel) => {
    const els = [...document.querySelectorAll(sel)].filter((e) => e.offsetParent);
    const r = els.map((e) => e.getBoundingClientRect());
    const out = [];
    for (let i = 0; i < r.length; i++)
      for (let j = i + 1; j < r.length; j++) {
        const a = r[i], b = r[j];
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ix > 2 && iy > 2 && !els[i].contains(els[j]) && !els[j].contains(els[i])) out.push(`${els[i].textContent.trim().slice(0, 20)} × ${els[j].textContent.trim().slice(0, 20)}`);
      }
    return out;
  }, selector);

try {
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });

  // Statusleiste: App unter der Statusleiste, Abstände über --safe-top
  const vp = await page.locator('meta[name="viewport"]').getAttribute("content");
  check("iPad-Statusleiste: App beginnt unter der Statusleiste (kein viewport-fit=cover)", !vp.includes("viewport-fit=cover"), vp);
  check("iPad-Statusleiste: deckende Farbe (theme-color)", (await page.locator('meta[name="theme-color"]').count()) === 2);
  const pad = await page.evaluate(() => {
    const css = [...document.styleSheets].flatMap((s) => [...s.cssRules].map((r) => r.cssText)).join("\n");
    return /\.shell-side[^{]*\{[^}]*padding-top: var\(--safe-top\)/.test(css) && /--safe-top:\s*var\(--safe-top-manual,\s*env\(safe-area-inset-top/.test(css);
  });
  check("iPad-Statusleiste: Abstand oben (safe-area) in den Bereichen", pad);

  // 1. Veranstaltung über den Dialog „Neu …“ im Semester
  await page.locator(".tree-row", { hasText: "Wintersemester" }).first().click();
  await page.getByRole("button", { name: "Neu …" }).click();
  check("Dialog zeigt Schreibarten", (await page.getByRole("radiogroup", { name: "Schreiben" }).getByRole("radio").count()) === 7);
  await page.getByRole("radio", { name: /Veranstaltung/ }).click();
  await page.locator("#new-title").fill("BGB AT");
  await page.getByRole("button", { name: "Anlegen" }).click();
  const made = await page
    .waitForFunction(() => document.querySelector(".page-title")?.value === "BGB AT", null, { timeout: 8000 })
    .then(() => true, () => false);
  check("Veranstaltung im Semester angelegt", made);

  // 2. Zwei Vorlesungen: Nummer automatisch, Datum, Thema, Dozent/in aus der Veranstaltung
  await page.getByLabel("Dozent/in").fill("Prof. Dr. Muster");
  await page.getByLabel("Dozent/in").blur();
  await sleep(400);
  await page.getByRole("button", { name: "Vorlesung", exact: true }).click();
  check("Vorlesung ist vorausgewählt", (await page.getByRole("radio", { name: /^Vorlesung Mitschrift/ }).getAttribute("aria-checked")) === "true");
  check("Erste Vorlesung hat Nr. 1", (await page.getByLabel("Nummer der Vorlesung").inputValue()) === "1");
  await page.getByLabel("Datum der Vorlesung").fill("2026-10-22");
  await page.getByLabel("Thema").fill("Anfechtung");
  check("Dozent/in aus der Veranstaltung übernommen", (await page.getByPlaceholder("z. B. Prof. Dr. Muster").inputValue()) === "Prof. Dr. Muster");
  await shot("struktur-dialog");
  await page.getByRole("button", { name: "Anlegen" }).click();
  await page.locator(".ProseMirror").waitFor();
  check("Titel „1. Vorlesung: Anfechtung“", (await page.locator(".note-title").inputValue()) === "1. Vorlesung: Anfechtung");
  check("Mitschrift enthält Datum und Dozent/in", /Datum: 22\.10\.2026[\s\S]*Prof\. Dr\. Muster/.test(await page.locator(".ProseMirror").innerText()));
  check("Art und Angaben unter dem Titel", (await page.getByLabel("Art der Notiz").inputValue()) === "vorlesung" && (await page.getByLabel("Datum der Vorlesung").inputValue()) === "2026-10-22");
  await shot("struktur-vorlesung");

  await page.locator(".tree-row", { hasText: "BGB AT" }).first().click();
  await page.getByRole("button", { name: "Vorlesung", exact: true }).click();
  check("Zweite Vorlesung bekommt Nr. 2", (await page.getByLabel("Nummer der Vorlesung").inputValue()) === "2");
  await page.getByLabel("Datum der Vorlesung").fill("2026-10-15");
  await page.getByLabel("Thema").fill("Willenserklärung");
  await page.getByRole("button", { name: "Anlegen" }).click();
  await page.locator(".ProseMirror").waitFor();

  // 3. Fall und freie Notiz
  await page.locator(".tree-row", { hasText: "BGB AT" }).first().click();
  await page.getByRole("button", { name: "Neu …" }).click();
  await page.getByRole("radio", { name: /Fall/ }).click();
  await page.getByRole("button", { name: "Anlegen" }).click();
  await page.locator(".ProseMirror").waitFor();
  await page.locator(".tree-row", { hasText: "BGB AT" }).first().click();
  await page.getByRole("button", { name: "Notiz", exact: true }).click();
  await page.locator(".ProseMirror").waitFor();

  const all = await nodes();
  const course = all.find((n) => n.title === "BGB AT");
  const kids = all.filter((n) => n.parent_id === course.id);
  check(
    "Alles liegt in der Veranstaltung, mit Art",
    kids.length === 4 && ["vorlesung", "vorlesung", "fall", "notiz"].every((t) => kids.some((k) => k.meta.noteType === t)),
    JSON.stringify(kids.map((k) => [k.title, k.meta.noteType])),
  );

  // 4. Sortierung: Vorlesungen nach Datum (2. Vorlesung vom 15.10. vor der 1. vom 22.10.)
  await page.locator(".tree-row", { hasText: "BGB AT" }).first().click();
  await page.locator(".list-row").first().waitFor();
  const rows = await page.locator(".page-main .list-row .grow").allInnerTexts();
  check("Veranstaltungsseite: Vorlesungen chronologisch, dann Fälle, dann Notizen", rows.join("|") === "2. Vorlesung: Willenserklärung|1. Vorlesung: Anfechtung|Fall / Gutachten|Neue Notiz", rows.join("|"));
  const heads = await page.locator(".page-main h3.label").allInnerTexts();
  check("Gruppen nach Art", heads.some((h) => /Vorlesungen/i.test(h)) && heads.some((h) => /Fälle/i.test(h)), heads.join(" | "));
  const tree = await page.locator(".tree-row .tree-title").allInnerTexts();
  const iV2 = tree.indexOf("2. Vorlesung: Willenserklärung");
  const iV1 = tree.indexOf("1. Vorlesung: Anfechtung");
  check("Seitenleiste: automatisch nach Datum", iV2 >= 0 && iV2 < iV1, tree.join(" | "));
  check("Seitenleiste zeigt Datum der Vorlesung", (await page.locator(".tree-date").allInnerTexts()).includes("15.10."));
  await page.getByRole("button", { name: "Sortierung" }).click();
  await page.getByRole("menuitem", { name: /Name/ }).click();
  await sleep(300);
  const byName = await page.locator(".tree-row .tree-title").allInnerTexts();
  check("Sortierung nach Name umschaltbar", byName.indexOf("1. Vorlesung: Anfechtung") < byName.indexOf("2. Vorlesung: Willenserklärung"));
  await page.getByRole("button", { name: "Sortierung" }).click();
  await page.getByRole("menuitem", { name: /Automatisch/ }).click();

  // 5. Layout: nichts überlappt (Veranstaltungsseite, quer und hoch)
  for (const [w, h, label] of [
    [1180, 820, "quer"],
    [820, 1180, "hoch"],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(300);
    const bad = await overlaps(".page-main > .section > *, .page-main > .hint-card, .page-head > *, .page-side > .section");
    check(`Veranstaltungsseite ${label}: keine überlappenden Elemente`, bad.length === 0, bad.join("; "));
    await shot(`struktur-veranstaltung-${label}`);
  }
  // leere Semesterseite (früher überlappten Hinweis, „Unterlagen“ und Häkchen)
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.locator(".tree-row", { hasText: "Wintersemester" }).nth(1).click();
  await sleep(400);
  const bad2 = await overlaps(".page-main > *, .page-main .section-head > *");
  check("Leere Semesterseite: keine überlappenden Elemente", bad2.length === 0, bad2.join("; "));
  await shot("struktur-semester-leer");

  // 6. Art einer Notiz ändern
  await page.locator(".tree-row", { hasText: "Neue Notiz" }).first().click();
  await page.getByLabel("Art der Notiz").selectOption("zusammenfassung");
  await sleep(500);
  const changed = (await nodes()).find((n) => n.title === "Neue Notiz");
  check("Art der Notiz nachträglich änderbar", changed.meta.noteType === "zusammenfassung");

  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Ablauf ohne Abbruch", false, String(e).slice(0, 500));
  await shot("struktur-fehler").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
