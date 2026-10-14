// Test der Browser-/iPad-Version im echten Safari (macOS, über safaridriver).
// Führt dieselben Prüfungen aus wie webkit-run.py (webkit-checks.js), vor und
// nach dem Neuladen. Läuft im GitHub-Workflow auf macOS.
//
// Voraussetzung: `vite preview` auf Port 4173, `sudo safaridriver --enable`.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(path.join(HERE, "../e2e/package.json"));
const { Builder } = require("selenium-webdriver");
const CHECKS = fs.readFileSync(path.join(HERE, "webkit-checks.js"), "utf8");
const URL_ = process.env.E2E_URL ?? "http://127.0.0.1:4173/?e2e";

const results = [];
// Im GitHub-Workflow erscheinen Fehler so direkt als Hinweis am Lauf.
const annotate = (kind, msg) => process.env.GITHUB_ACTIONS && console.log(`::${kind}::${String(msg).replace(/\n/g, " ").slice(0, 900)}`);
let d;
try {
  d = await new Builder().forBrowser("safari").build();
} catch (e) {
  annotate("error", `Safari-Treiber startet nicht: ${e}`);
  process.exit(1);
}
try {
  await d.manage().setTimeouts({ script: 180000 });
  await d.get(URL_);
  const ua = await d.executeScript("return navigator.userAgent");
  console.log(ua);
  annotate("notice", `Safari: ${ua}`);
  for (const phase of [1, 2]) {
    await new Promise((r) => setTimeout(r, 2500));
    // Der Prüfcode wird direkt als Skript übergeben (kein eval – die CSP der App verbietet das).
    const json = await d.executeAsyncScript(
      `const done = arguments[arguments.length - 1];
       const phase = ${phase};
       (async () => {\n${CHECKS}\n})().then((r) => done(JSON.stringify(r)), (e) => done(JSON.stringify([{ name: "Phase ${phase} ohne Abbruch", ok: false, extra: String(e) }])));`,
    );
    results.push(...JSON.parse(json));
    if (phase === 1) await d.navigate().refresh();
  }
} catch (e) {
  results.push({ name: "Testlauf ohne Abbruch", ok: false, extra: String(e).slice(0, 300) });
} finally {
  await d.quit();
}
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.extra ? "  – " + r.extra : ""}`);
  if (!r.ok) annotate("error", `${r.name}${r.extra ? " – " + r.extra : ""}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden (Safari)`);
annotate(failed ? "error" : "notice", `${results.length - failed}/${results.length} Prüfungen in Safari bestanden`);
process.exit(failed ? 1 : 0);
