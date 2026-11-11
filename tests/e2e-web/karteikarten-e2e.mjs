// End-to-End-Test: Karteikarten wie in einer Lernkartei – Stapel, Kartentypen (Definition, Schema, Lückentext),
// Lernansicht (Lernschritte, Rückgängig, Geschwister, Flagge, Aussetzen), Optionen, Browser, Statistik.
//
// Aufruf: node tests/e2e-web/karteikarten-e2e.mjs   (nach npm run build:web)
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
const PORT = 4205;

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
  const cardsNow = () => call("cardsList", {});

  // 1. Stapel anlegen
  await page.getByRole("button", { name: /^Karteikarten/ }).first().click();
  await page.getByRole("button", { name: "Ersten Stapel erstellen" }).click();
  const pd = page.getByRole("dialog", { name: "Stapel erstellen" });
  await pd.getByLabel("Name").fill("Zivilrecht::BGB AT");
  await pd.getByRole("button", { name: "Erstellen" }).click();
  const deckRow = (p) => page.locator(`.deck-row[aria-label="${p}"]`);
  await deckRow("Zivilrecht::BGB AT").waitFor({ timeout: 5000 });
  check("Stapel mit Unterstapel angelegt", (await deckRow("Zivilrecht").count()) === 1);

  // 2. Karten hinzufügen (Dialog bleibt offen)
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  const add = page.getByRole("dialog", { name: "Karten hinzufügen" });
  await add.getByLabel("Stapel").fill("Zivilrecht::BGB AT");
  await add.getByLabel("Kartentyp").selectOption("definition");
  await add.getByLabel("Begriff").fill("Sache");
  await add.getByLabel("Definition", { exact: true }).fill("Körperlicher Gegenstand");
  await add.getByLabel("Norm / Fundstelle").fill("§ 90 BGB");
  await add.getByLabel("Beispiel").fill("Fahrrad, nicht aber Strom");
  await add.getByLabel("Schlagwörter").fill("Sachenrecht, Grundbegriffe");
  await add.getByRole("button", { name: "Hinzufügen" }).click();
  await waitFor(async () => (await cardsNow()).length === 1);
  check("Dialog bleibt für die nächste Karte offen (Typ und Stapel bleiben)", (await add.isVisible()) && (await add.getByLabel("Begriff").inputValue()) === "" && (await add.getByLabel("Stapel").inputValue()) === "Zivilrecht::BGB AT");
  // Lückentext mit zwei Lücken über den Knopf
  await add.getByLabel("Kartentyp").selectOption("luecke");
  const lt = add.getByLabel("Text mit Lücken");
  await lt.fill("Die Willenserklärung besteht aus Handlungswille und Erklärungsbewusstsein.");
  await lt.evaluate((el) => el.setSelectionRange(33, 47));
  await add.getByRole("button", { name: /^Lücke 1/ }).click();
  await lt.evaluate((el) => {
    const i = el.value.indexOf("Erklärungsbewusstsein");
    el.setSelectionRange(i, i + "Erklärungsbewusstsein".length);
  });
  await add.getByRole("button", { name: /^Lücke 2/ }).click();
  check("Lücken gesetzt", (await lt.inputValue()) === "Die Willenserklärung besteht aus {{c1::Handlungswille}} und {{c2::Erklärungsbewusstsein}}.", await lt.inputValue());
  await add.getByRole("button", { name: "Hinzufügen" }).click();
  await waitFor(async () => (await cardsNow()).length === 3);
  // Prüfungsschema
  await add.getByLabel("Kartentyp").selectOption("schema");
  await add.getByLabel("Schema / Anspruchsgrundlage").fill("Anspruch aus § 433 Abs. 2 BGB");
  await add.getByLabel("Prüfungspunkte").fill("I. Anspruch entstanden\n  1. Kaufvertrag\nII. Anspruch nicht erloschen\nIII. Anspruch durchsetzbar");
  await add.getByRole("button", { name: "Hinzufügen" }).click();
  await waitFor(async () => (await cardsNow()).length === 4);
  await add.getByRole("button", { name: "Fertig" }).click();
  const all = await cardsNow();
  const cloze = all.filter((c) => c.template === "luecke");
  check("Lückentext ergibt zwei zusammengehörige Karten", cloze.length === 2 && cloze[0].note_key && cloze[0].note_key === cloze[1].note_key && cloze.map((c) => c.ord).sort().join() === "1,2", JSON.stringify(cloze.map((c) => [c.ord, c.note_key])));
  const def = all.find((c) => c.template === "definition");
  check("Definition mit Feldern und Schlagwörtern", def?.deck === "Zivilrecht::BGB AT" && JSON.parse(def.fields).norm === "§ 90 BGB" && def.tags === "Sachenrecht, Grundbegriffe", JSON.stringify(def));
  await waitFor(async () => /4/.test(await deckRow("Zivilrecht::BGB AT").innerText()));
  check("Stapelübersicht: 4 neu", (await deckRow("Zivilrecht::BGB AT").locator(".cnt-new").innerText()) === "4" && (await deckRow("Zivilrecht").locator(".cnt-new").innerText()) === "4");
  await shot("kk-1-stapel");

  // 3. Stapel öffnen → Jetzt lernen
  await deckRow("Zivilrecht::BGB AT").getByRole("button", { name: "BGB AT", exact: true }).click();
  await page.getByRole("button", { name: "Jetzt lernen" }).click();
  await page.locator(".flashcard").waitFor({ timeout: 5000 });
  const counts = async () => (await page.locator(".learn-counts > span").allInnerTexts()).slice(0, 3).join("/");
  check("Zähler Neu/Lernen/Fällig", (await counts()) === "4/0/0", await counts());
  // erste Karte: Definition „Sache“
  check("Definition: Aufforderung und Begriff", (await page.locator(".fc-prompt").innerText()).includes("DEFINIERE") || (await page.locator(".fc-prompt").innerText()).includes("Definiere"), await page.locator(".flashcard").innerText());
  await page.keyboard.press("Space");
  await page.locator(".fc-extras").waitFor();
  check("Rückseite mit Norm und Beispiel", /§ 90 BGB/.test(await page.locator(".fc-extras").innerText()) && /Fahrrad/.test(await page.locator(".fc-extras").innerText()));
  check("Tasten zeigen Intervalle", /Min\./.test(await page.locator(".fc-rate.r1").innerText()) && /Tag|Tage/.test(await page.locator(".fc-rate.r4").innerText()), await page.locator(".fc-ratings").innerText());
  await shot("kk-2-definition");
  await page.locator(".fc-rate.r1").click(); // Nochmal → Lernschritt
  await waitFor(async () => (await counts()) === "3/1/0");
  check("„Nochmal“: Karte bleibt in Lernen", (await counts()) === "3/1/0", await counts());
  await page.keyboard.press("z");
  await waitFor(async () => (await counts()) === "4/0/0");
  check("Rückgängig stellt die Karte wieder her", (await counts()) === "4/0/0" && (await page.locator(".fc-front").first().innerText()).includes("Sache"), await counts());
  let log = await call("cardReviewLog", null, "2000-01-01T00:00:00Z");
  check("Rückgängig entfernt den Protokolleintrag", log.length === 0, String(log.length));
  await page.keyboard.press("Space");
  await page.keyboard.press("3");
  await waitFor(async () => (await counts()) !== "4/0/0");
  // nächste Karten bis zum Lückentext; nach einer Lücke wird die zweite zurückgestellt
  let sawCloze = false;
  let sawSchema = false;
  for (let i = 0; i < 10 && (await page.locator(".flashcard").count()); i++) {
    const isCloze = (await page.locator(".cloze-gap").count()) > 0;
    const isSchema = (await page.locator(".tpl-schema").count()) > 0;
    if (isSchema && !sawSchema) {
      sawSchema = true;
      await page.getByRole("button", { name: "Punkt für Punkt" }).click();
      check("Schema: Punkt für Punkt aufdecken", (await page.locator(".schema-points li").count()) === 1);
      await page.getByRole("button", { name: /Nächster Punkt/ }).click();
      check("Schema: nächster Punkt mit Einrückung", (await page.locator(".schema-points li").count()) === 2 && (await page.locator(".schema-points li").nth(1).getAttribute("style"))?.includes("20px"));
    } else await page.keyboard.press("Space");
    if (isCloze && !sawCloze) {
      sawCloze = true;
      check("Lückentext: Antwort hervorgehoben", (await page.locator(".cloze-answer").count()) === 1);
    }
    const before = `${await counts()}|${await page.locator(".fc-front").first().innerText()}`;
    await page.locator(".fc-rate.r3").click();
    await waitFor(async () => !(await page.locator(".flashcard").count()) || `${await counts()}|${await page.locator(".fc-front").first().innerText()}` !== before);
    if (i === 1 && (await page.locator(".flashcard").count())) {
      // Flagge während der Sitzung
      await page.getByRole("button", { name: "Flagge", exact: true }).click();
      await page.getByRole("menuitem", { name: /^Rot/ }).click();
      await waitFor(async () => (await cardsNow()).some((c) => c.flag === 1));
      check("Flagge gesetzt", (await cardsNow()).some((c) => c.flag === 1));
    }
  }
  check("Schema und Lückentext gelernt", sawSchema && sawCloze);
  check("Sitzung beendet mit Zusammenfassung", (await page.locator(".empty").innerText().catch(() => "")).includes("geschafft"), await page.locator(".page").innerText());
  const buried = (await cardsNow()).filter((c) => c.template === "luecke" && c.buried_until);
  check("Zweite Lücke bis morgen zurückgestellt", buried.length === 1, JSON.stringify((await cardsNow()).map((c) => [c.template, c.buried_until])));
  await shot("kk-3-lernen");

  // zurück zur Übersicht
  await page.getByRole("button", { name: "Zur Stapelübersicht" }).click();
  await page.locator(".deck-hero").waitFor({ timeout: 5000 });

  // 5. Optionen: neue Karten pro Tag
  await page.getByRole("button", { name: "Optionen" }).click();
  const od = page.getByRole("dialog", { name: /Optionen/ });
  await od.getByLabel("Neue Karten pro Tag").fill("3");
  await od.getByRole("button", { name: "Speichern" }).click();
  await od.waitFor({ state: "hidden" });
  const setting = (await call("settingsAll"))["learn.decks"];
  check("Optionen je Stapel gespeichert", setting?.options?.["Zivilrecht::BGB AT"]?.newPerDay === 3, JSON.stringify(setting));
  await waitFor(async () => (await page.locator(".deck-big .cnt-new strong").innerText()) === "0");
  check("Tageslimit wirkt (3 neue heute schon eingeführt → 0 übrig)", (await page.locator(".deck-big .cnt-new strong").innerText()) === "0", await page.locator(".deck-big").innerText());

  // 6. Kartenbrowser
  await page.getByRole("button", { name: "Karten durchsuchen" }).click();
  const search = page.getByLabel("Karten durchsuchen");
  await search.waitFor();
  check("Browser mit Stapelsuche", (await search.inputValue()) === 'deck:"Zivilrecht::BGB AT"' && (await page.locator(".browser-table tbody tr").count()) === 4);
  await search.fill("typ:luecke");
  await waitFor(async () => (await page.locator(".browser-table tbody tr").count()) === 2);
  await page.getByLabel("Alle auswählen").check();
  await page.getByRole("button", { name: /^Aktionen/ }).click();
  await page.getByRole("menuitem", { name: "Aussetzen" }).click();
  await waitFor(async () => (await cardsNow()).filter((c) => c.suspended).length === 2);
  check("Sammelaktion: zwei Karten ausgesetzt", (await cardsNow()).filter((c) => c.suspended).length === 2);
  await search.fill("is:suspended");
  await waitFor(async () => (await page.locator(".browser-table tbody tr.is-suspended").count()) === 2);
  check("Suche is:suspended", (await page.locator(".browser-table tbody tr").count()) === 2);
  await search.fill('"körperlicher"');
  await waitFor(async () => (await page.locator(".browser-table tbody tr").count()) === 1);
  check("Volltextsuche über die Rückseite", (await page.locator(".browser-table tbody tr").first().innerText()).includes("Sache"));
  await shot("kk-4-browser");

  // 7. Statistik
  await page.getByRole("tab", { name: /Statistik/ }).click();
  const heute = page.locator('section[aria-label="Heute"]');
  await heute.waitFor({ timeout: 5000 });
  log = await call("cardReviewLog", null, "2000-01-01T00:00:00Z");
  check("Statistik: Heute zählt die Wiederholungen", (await heute.locator(".stat-value").first().innerText()) === String(log.length), `${await heute.locator(".stat-value").first().innerText()} vs ${log.length}`);
  check("Statistik: Diagramme vorhanden", (await page.locator(".card-stats svg").count()) >= 7 && (await page.locator(".viz-segbar span").count()) >= 2);
  const seg = await page.locator('section[aria-label="Kartenzählung"]').innerText();
  check("Kartenzählung mit Ausgesetzt", /Ausgesetzt\s*2/.test(seg), seg);
  await shot("kk-5-statistik");
  await page.emulateMedia({ colorScheme: "dark" });
  await sleep(300);
  await shot("kk-6-statistik-dunkel");
  await page.emulateMedia({ colorScheme: "light" });
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.stack ?? e.message);
  await shot("kk-abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
