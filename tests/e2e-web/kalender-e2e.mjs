// End-to-End-Test: Uni-Kalender – Kalenderdatei importieren, Abo verbinden (verschlüsselt gespeichert),
// ausfallende und verschobene Termine, Aktualisieren, Fehlermeldung bei gesperrtem Abruf. Nur erfundene Termine.
//
// Aufruf: node tests/e2e-web/kalender-e2e.mjs   (nach npm run build:web)
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
const PORT = 4201;

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

// Erfundener Stundenplan relativ zu heute: Serien beginnen vor drei Wochen und laufen zehn Wochen.
const day = (add) => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + add);
};
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
const SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const tomorrow = day(1);
const start = day(-20); // gleicher Wochentag wie morgen
const until = ymd(day(50));
function ics({ extra = "" } = {}) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//Erfunden//DE",
    // Vorlesung morgen fällt aus
    "BEGIN:VEVENT",
    "UID:test-sachen@example.invalid",
    "SUMMARY:12345 VL Sachenrecht Testkurs",
    "LOCATION:H 1",
    `DTSTART:${ymd(start)}T101500`,
    `DTEND:${ymd(start)}T114500`,
    `RRULE:FREQ=WEEKLY;UNTIL=${until}T235900`,
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:test-sachen@example.invalid",
    `RECURRENCE-ID:${ymd(tomorrow)}T101500`,
    "SUMMARY:12345 VL Sachenrecht Testkurs",
    "STATUS:CANCELLED",
    `DTSTART:${ymd(tomorrow)}T101500`,
    `DTEND:${ymd(tomorrow)}T114500`,
    "END:VEVENT",
    // Übung morgen verschoben auf 12:15 in H 15
    "BEGIN:VEVENT",
    "UID:test-uebung@example.invalid",
    "SUMMARY:Erbrecht Testkurs (Übung)",
    "LOCATION:S 3",
    `DTSTART:${ymd(start)}T140000`,
    `DTEND:${ymd(start)}T153000`,
    `RRULE:FREQ=WEEKLY;UNTIL=${until}T235900`,
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:test-uebung@example.invalid",
    `RECURRENCE-ID:${ymd(tomorrow)}T140000`,
    "SUMMARY:Erbrecht Testkurs (Übung)",
    "LOCATION:H 15",
    `DTSTART:${ymd(tomorrow)}T121500`,
    `DTEND:${ymd(tomorrow)}T134500`,
    "END:VEVENT",
    extra,
    "END:VCALENDAR",
    "",
  ]
    .filter(Boolean)
    .join("\r\n");
}
const NEW_COURSE = ["BEGIN:VEVENT", "UID:test-neu@example.invalid", "SUMMARY:Familienrecht Testkurs", "LOCATION:H 2", `DTSTART:${ymd(start)}T081500`, `DTEND:${ymd(start)}T094500`, `RRULE:FREQ=WEEKLY;UNTIL=${until}T235900`, "END:VEVENT"].join("\r\n");
const ABO = "https://my.uni-bayreuth.de/v3/test/ical?id=erfunden&token=geheim-123";

try {
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.getByRole("button", { name: "Loslegen" }).click({ timeout: 20000 });
  await page.locator(".area-tab").first().waitFor({ timeout: 20000 });
  const card = (name) => page.locator(`section[aria-label="${name}"]`);
  const coursesOf = () => call("nodesList", null).then((ns) => ns.filter((n) => n.kind === "course" && !n.deleted_at));

  // 1. Kalenderdatei importieren
  await page.getByRole("button", { name: "Stundenplan" }).first().click();
  const cal = card("Uni-Kalender");
  await cal.waitFor({ timeout: 8000 });
  const file = path.join(OUT, "stundenplan-test.ics");
  fs.writeFileSync(file, ics());
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), cal.getByRole("button", { name: "Kalenderdatei (.ics) importieren" }).click()]);
  await chooser.setFiles(file);
  const dlg = page.getByRole("dialog", { name: "Stundenplan übernehmen" });
  await dlg.waitFor({ timeout: 8000 });
  const rows = dlg.getByRole("listitem");
  await waitFor(async () => (await rows.count()) === 2 && /neu/.test(await rows.first().innerText()));
  const txt = await dlg.innerText();
  check("Vorschau: zwei Veranstaltungen, Titel bereinigt", /Sachenrecht Testkurs/.test(txt) && /Erbrecht Testkurs – Übung/.test(txt) && !/12345/.test(txt), txt);
  check("Vorschau: Wochentag, Zeit, Raum", txt.includes(`${SHORT[tomorrow.getDay()]} 10:15–11:45 · H 1`) && txt.includes("14:00–15:30 · S 3"), txt);
  await shot("kalender-1-vorschau");
  await dlg.getByRole("button", { name: "Übernehmen" }).click();
  await dlg.waitFor({ state: "hidden", timeout: 8000 });
  let courses = await waitFor(async () => ((await coursesOf()).length === 2 ? coursesOf() : null));
  const sachen = courses?.find((c) => c.title === "Sachenrecht Testkurs");
  check("Veranstaltungen angelegt (mit Semester)", !!sachen && sachen.meta.weekday === SHORT[tomorrow.getDay()] && sachen.meta.time === "10:15–11:45" && sachen.meta.room === "H 1" && !!sachen.parent_id, JSON.stringify(courses?.map((c) => c.meta.weekday + " " + c.meta.time)));
  check("Einzeltermine gespeichert (Ausfall markiert)", sachen?.meta.termine?.some((t) => t.cancelled), String(sachen?.meta.termine?.length));
  const slots = page.locator(".tt-slot");
  await waitFor(async () => (await slots.count()) === 2);
  check("Stundenplan zeigt beide", (await slots.count()) === 2 && /Sachenrecht Testkurs/.test(await page.locator(".timetable").innerText()));
  await shot("kalender-2-stundenplan");

  // 2. Übersicht: Ausfall und Verschiebung von morgen berücksichtigt
  await page.getByRole("button", { name: "Übersicht" }).first().click();
  const tiles = card("Veranstaltungen");
  await tiles.waitFor({ timeout: 8000 });
  const tile = (t) => tiles.locator(".course-tile", { hasText: t });
  await waitFor(async () => (await tiles.locator(".course-tile").count()) === 2);
  const s = await tile("Sachenrecht").innerText();
  const u = await tile("Erbrecht").innerText();
  check("Ausfallender Termin übersprungen", !/morgen/.test(s) && new RegExp(`${SHORT[tomorrow.getDay()]} 10:15`).test(s), s);
  check("Verschobener Termin (morgen 12:15)", /morgen 12:15/.test(u), u);

  // 3. Abo verbinden (Uni-Server simuliert, mit CORS-Freigabe)
  let body = ics({ extra: NEW_COURSE });
  let fail = false;
  await page.route("https://my.uni-bayreuth.de/**", (route) =>
    fail ? route.abort("failed") : route.fulfill({ status: 200, headers: { "content-type": "text/calendar", "access-control-allow-origin": "*" }, body }),
  );
  await page.getByRole("button", { name: "Stundenplan" }).first().click();
  await cal.waitFor({ timeout: 8000 });
  await cal.getByLabel("Abo-Link des Uni-Kalenders").fill(ABO.replace("https://", "webcal://"));
  await cal.getByRole("button", { name: "Verbinden" }).click();
  await dlg.waitFor({ timeout: 8000 });
  await waitFor(async () => (await rows.count()) === 3 && /unverändert/.test(await dlg.innerText()));
  const t2 = await dlg.innerText();
  check("Abo-Vorschau: neu und unverändert", /Familienrecht Testkurs[\s\S]*neu/.test(t2) && (t2.match(/unverändert/g) ?? []).length === 2, t2);
  // Sprechstunde o. Ä. abwählen geht auch: hier Familienrecht übernehmen
  await dlg.getByRole("button", { name: "Übernehmen" }).click();
  await dlg.waitFor({ state: "hidden", timeout: 8000 });
  await waitFor(async () => (await coursesOf()).length === 3);
  check("Neue Veranstaltung aus dem Abo", (await coursesOf()).some((c) => c.title === "Familienrecht Testkurs"));
  await waitFor(async () => /Verbunden mit/.test(await cal.innerText()));
  check("Verbunden-Anzeige ohne Schlüssel", /Verbunden mit my\.uni-bayreuth\.de/.test(await cal.innerText()) && !/geheim-123/.test(await cal.innerText()), await cal.innerText());
  const settingRaw = JSON.stringify((await call("settingsAll"))["ui.calendar"]);
  check("Link nur verschlüsselt gespeichert", !!settingRaw && /"link":\{"iv"/.test(settingRaw) && !settingRaw.includes("geheim-123") && !settingRaw.includes("/v3/test"), settingRaw);
  await shot("kalender-3-verbunden");

  // 4. Jetzt aktualisieren: Raumänderung kommt an
  body = ics({ extra: NEW_COURSE.replace("LOCATION:H 2", "LOCATION:Audimax") });
  await cal.getByRole("button", { name: "Jetzt aktualisieren" }).click();
  const fam = await waitFor(async () => (await coursesOf()).find((c) => c.title === "Familienrecht Testkurs" && c.meta.room === "Audimax"));
  check("Aktualisieren übernimmt Raumänderung", !!fam);
  check("Rückmeldung nach dem Aktualisieren", !!(await waitFor(() => page.getByText("Stundenplan aktualisiert: 0 neu, 1 geändert.").isVisible())));

  // 5. Abruf gesperrt (CORS/keine Verbindung) → verständlicher Hinweis
  fail = true;
  await cal.getByRole("button", { name: "Jetzt aktualisieren" }).click();
  const warn = cal.locator(".notice-warn");
  await waitFor(() => warn.isVisible());
  check("Hinweis bei gesperrtem Abruf", /ließ sich nicht direkt laden[\s\S]*Kalenderdatei \(\.ics\)/.test(await warn.innerText().catch(() => "")), await warn.innerText().catch(() => ""));
  await shot("kalender-4-fehler");

  // 6. Trennen löscht den Link
  await cal.getByRole("button", { name: "Trennen" }).click();
  await waitFor(async () => (await cal.getByRole("button", { name: "Verbinden" }).count()) === 1);
  const after = (await call("settingsAll"))["ui.calendar"];
  check("Trennen entfernt den gespeicherten Link", !after?.link && (await coursesOf()).length === 3, JSON.stringify(after));
  check("Keine Skriptfehler", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.message);
  await shot("kalender-abbruch").catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
