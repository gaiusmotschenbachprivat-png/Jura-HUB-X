// End-to-End-Test: Stapel wiederholen, auch wenn die Karten noch nicht fällig sind –
// Übungsrunde ohne Änderung der Planung und Runde, deren Antworten zählen.
//
// Aufruf: node tests/e2e-web/stapel-wiederholen-e2e.mjs   (nach npm run build:web)
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
const PORT = 4208;

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
  const cardsNow = async () => (await call("cardsList", {})).filter((c) => c.deck === "Strafrecht");

  // Drei schon gelernte Karten, die erst in 20 Tagen wieder fällig sind
  const later = new Date(Date.now() + 20 * 864e5).toISOString();
  const defs = [["Vorsatz", "Wissen und Wollen der Tatbestandsverwirklichung"], ["Fahrlässigkeit", "Außerachtlassen der im Verkehr erforderlichen Sorgfalt"], ["Gewahrsam", "Tatsächliche Sachherrschaft, getragen von Herrschaftswillen"]];
  for (const [f, b] of defs) {
    const c = await call("cardCreate", { front: f, back: b, deck: "Strafrecht", template: "basis", fields: JSON.stringify({ front: f, back: b }) });
    await call("cardReview", c.id, { rating: 3, due: later, stability: 20, difficulty: 5, elapsed_days: 0, scheduled_days: 20, learning_steps: 0, reps: 1, lapses: 0, state: 2 });
  }
  const before = await cardsNow();
  const logBefore = (await call("cardReviewLog", null, "2000-01-01T00:00:00Z")).length;
  check("Drei Karten, keine fällig", before.length === 3 && before.every((c) => c.due === later));

  await page.getByRole("button", { name: /^Karteikarten/ }).first().click();
  const row = page.locator('.deck-row[aria-label="Strafrecht"]');
  await row.waitFor({ timeout: 8000 });
  await row.getByRole("button", { name: "Optionen für Strafrecht" }).click();
  check("Stapelmenü: „Stapel wiederholen“", (await page.getByRole("menuitem", { name: /Stapel wiederholen/ }).count()) === 1);
  await page.keyboard.press("Escape");
  await row.getByRole("button", { name: "Strafrecht", exact: true }).click();
  const again = page.getByRole("button", { name: "Stapel wiederholen" });
  await again.waitFor({ timeout: 5000 });
  check("Nichts fällig, aber „Stapel wiederholen“ möglich", (await page.getByRole("button", { name: "Für heute geschafft" }).isDisabled()) && (await again.isEnabled()));

  // 1. Übungsrunde (Standard): Planung bleibt
  await again.click();
  const dlg = page.getByRole("dialog", { name: "Stapel wiederholen" });
  await dlg.waitFor();
  await shot("sw-1-dialog");
  check("Dialog: Übungsrunde voreingestellt, 3 Karten", (await dlg.getByLabel(/Nur üben/).isChecked()) && (await dlg.getByRole("button", { name: "3 Karten wiederholen" }).count()) === 1);
  await dlg.getByLabel("Bald fällige zuerst").check();
  await dlg.getByRole("button", { name: "3 Karten wiederholen" }).click();
  await page.getByText("Stapel wiederholen · nur üben").waitFor({ timeout: 5000 });
  check("Hinweis: Übungsrunde ändert die Planung nicht", (await page.locator(".learn-practice").count()) === 1);
  const front = () => page.locator(".flashcard").evaluate((e) => e.textContent);
  const reveal = async () => {
    await page.getByRole("button", { name: /Antwort zeigen/ }).click();
    await page.locator(".fc-rate").first().waitFor();
  };
  const first = await front();
  await reveal();
  await shot("sw-2-ueben");
  check("Bewertungen zeigen Übungsablauf", (await page.locator(".fc-rate.r1 .fc-ivl").textContent()) === "gleich nochmal" && (await page.locator(".fc-rate.r3 .fc-ivl").textContent()) === "geschafft");
  await page.locator(".fc-rate.r1").click();
  await sleep(200);
  const counts = await page.locator(".learn-counts .cnt-review").textContent();
  check("„Nochmal“: Karte bleibt in der Runde", counts === "3" && (await front()) !== first, counts);
  let answers = 1;
  for (let i = 0; i < 10; i++) {
    if (await page.getByText("Stapel wiederholt").count()) break;
    await reveal();
    await page.locator(".fc-rate.r3").click();
    answers++;
    await sleep(150);
  }
  await page.getByText("Stapel wiederholt").waitFor({ timeout: 5000 });
  check("Runde fertig: alle drei Karten und die wiederholte", answers === 4, String(answers));
  const after = await cardsNow();
  const logAfter = (await call("cardReviewLog", null, "2000-01-01T00:00:00Z")).length;
  check("Planung und Protokoll unverändert", after.every((c) => c.due === later && c.reps === 1) && logAfter === logBefore, `${logBefore}→${logAfter}`);
  await shot("sw-3-fertig");

  // Rückgängig in der Übungsrunde und „Noch eine Runde“
  await page.getByRole("button", { name: "Noch eine Runde" }).click();
  await page.locator(".flashcard").waitFor({ timeout: 5000 });
  check("Noch eine Runde: wieder 3 Karten", (await page.locator(".learn-counts .cnt-review").textContent()) === "3");
  await reveal();
  await page.locator(".fc-rate.r3").click();
  await sleep(150);
  await page.getByRole("button", { name: "Rückgängig (Z)" }).click();
  await sleep(150);
  check("Rückgängig in der Übungsrunde", (await page.locator(".learn-counts .cnt-review").textContent()) === "3");
  await page.getByRole("button", { name: "Sitzung beenden" }).click();

  // 2. Antworten zählen: Planung wird neu berechnet
  await page.getByRole("button", { name: "Stapel wiederholen" }).click();
  await dlg.getByLabel(/Antworten zählen/).check();
  await dlg.getByLabel("Nur schon gelernte Karten").check();
  await dlg.getByRole("button", { name: "3 Karten wiederholen" }).click();
  await page.getByText("Stapel wiederholen · Antworten zählen").waitFor({ timeout: 5000 });
  check("Ohne Übungshinweis, mit echten Abständen", (await page.locator(".learn-practice").count()) === 0);
  for (let i = 0; i < 3; i++) {
    await reveal();
    await page.locator(".fc-rate.r3").click();
    await sleep(300);
  }
  await page.getByText("Stapel wiederholt").waitFor({ timeout: 5000 });
  const counted = await cardsNow();
  const logCounted = (await call("cardReviewLog", null, "2000-01-01T00:00:00Z")).length;
  check("Antworten gespeichert: neue Termine, Protokoll +3", counted.every((c) => c.reps === 2 && c.due !== later) && logCounted === logBefore + 3, JSON.stringify(counted.map((c) => [c.reps, c.due.slice(0, 10)])));
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.stack ?? e.message);
  await shot("sw-abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
