// End-to-End-Test: Gutachten nach Rechtsgebiet und farbiger Gutachtenstil (Obersatz, Definition, Subsumtion, Ergebnis).
//
// Aufruf: node tests/e2e-web/gutachten-e2e.mjs   (nach npm run build:web)
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
const PORT = 4195;

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
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  await page.evaluate(async () => {
    const api = window.__STUDIUM_API__;
    const area = (await api.areasList())[0];
    await api.nodeCreate({ area_id: area.id, parent_id: null, kind: "course", title: "Strafrecht AT" });
  });
  await page.reload();
  await page.locator(".tree-row", { hasText: "Strafrecht AT" }).first().click();
  await page.getByRole("button", { name: "Neu …" }).click();
  await page.getByRole("radio", { name: /Fall/ }).click();
  const arten = page.getByRole("radiogroup", { name: "Rechtsgebiet des Gutachtens" });
  check("Dialog: Gutachten nach Rechtsgebiet (5 Arten)", (await arten.getByRole("radio").count()) === 5);
  check("Rechtsgebiet aus der Veranstaltung vorgeschlagen: Strafrecht", (await arten.getByRole("radio", { name: "Strafrecht" }).getAttribute("aria-checked")) === "true");
  await page.getByRole("button", { name: "Anlegen" }).click();
  const editor = page.locator(".ProseMirror");
  await editor.waitFor();
  await waitFor(async () => (await editor.locator(".gs").count()) > 0);
  const txt = await editor.innerText();
  check("Strafrechtlicher Aufbau", ["Tatbestand", "Objektiver Tatbestand", "Rechtswidrigkeit", "Schuld", "Konkurrenzen"].every((t) => txt.includes(t)), txt.slice(0, 200));
  const kinds = await editor.locator(".gs").evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("data-gs")))].sort().join(","));
  check("Vorlage farbig: alle vier Schritte", kinds === "definition,ergebnis,obersatz,subsumtion", kinds);
  const look = await editor.locator('.gs[data-gs="obersatz"]').first().evaluate((e) => {
    const s = getComputedStyle(e);
    return { bg: s.backgroundColor, border: s.borderBottomWidth + " " + s.borderBottomStyle };
  });
  check("Markierung: hinterlegt und unterstrichen", look.bg !== "rgba(0, 0, 0, 0)" && look.border === "2px solid", JSON.stringify(look));

  await editor.locator("h4", { hasText: "Strafbarkeit des" }).first().evaluate((e) => e.scrollIntoView({ block: "start" }));
  await shot("gutachten-strafrecht");

  // Musterlösung als reinen Text einfügen → automatisch eingefärbt
  await editor.locator("p").last().click();
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector(".ProseMirror").lastElementChild);
    r.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await sleep(150);
  await page.keyboard.press("Enter");
  const before = await editor.locator(".gs").count();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData(
      "text/plain",
      "A könnte B körperlich misshandelt haben. Eine körperliche Misshandlung ist jede üble, unangemessene Behandlung, die das körperliche Wohlbefinden nicht nur unerheblich beeinträchtigt. Ein Faustschlag ins Gesicht ist eine üble, unangemessene Behandlung. Eine körperliche Misshandlung liegt vor.",
    );
    document.querySelector(".ProseMirror").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await waitFor(async () => (await editor.locator(".gs").count()) >= before + 4);
  const pasted = await editor.locator(".gs").evaluateAll((els) =>
    els.filter((e) => e.textContent.includes("körperlich") || e.textContent.includes("Faustschlag")).map((e) => e.getAttribute("data-gs") + ":" + e.textContent.slice(0, 30)).join(" | "),
  );
  check("Eingefügte Musterlösung automatisch eingefärbt", /obersatz:A könnte.*definition:Eine körperliche.*subsumtion:Ein Faustschlag.*ergebnis:Eine körperliche Misshandlung/.test(pasted), pasted);

  // Werkzeugleiste: Farben entfernen und automatisch neu einfärben
  const tool = page.getByRole("button", { name: /^Farben im Gutachtenstil/ });
  await editor.locator("h1").first().click();
  await tool.click();
  await page.getByRole("menuitem", { name: "Alle Gutachten-Farben entfernen" }).click();
  check("Farben entfernt", (await waitFor(async () => (await editor.locator(".gs").count()) === 0)) === true);
  await editor.locator("h1").first().click();
  await tool.click();
  await page.getByRole("menuitem", { name: "Ganze Notiz automatisch einfärben" }).click();
  check("Ganze Notiz automatisch eingefärbt", (await waitFor(async () => (await editor.locator(".gs").count()) > 10)) === true);
  // Auswahl von Hand markieren
  await page.evaluate(() => {
    const p = [...document.querySelectorAll(".ProseMirror p")].find((x) => x.textContent.startsWith("Rechtfertigungsgründe"));
    const r = document.createRange();
    r.selectNodeContents(p);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await sleep(200);
  await tool.click();
  await page.getByRole("menuitem", { name: "Definition" }).click();
  const manual = await editor.locator("p", { hasText: "Rechtfertigungsgründe" }).locator(".gs").first().getAttribute("data-gs");
  check("Auswahl von Hand als Definition markiert", manual === "definition", manual);
  await sleep(1500);
  const saved = await page.evaluate(async () => {
    const api = window.__STUDIUM_API__;
    const n = (await api.nodesList(null)).find((x) => x.title === "Fall / Gutachten");
    return (await api.noteGet(n.id)).content_json;
  });
  check("Farben werden gespeichert", saved.includes('"type":"gutachten"'));
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.message);
  await shot("gutachten-abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
