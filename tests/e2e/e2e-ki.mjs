// End-to-End-Test des KI-Assistenten in der echten Desktop-App (ohne API-Schlüssel):
// Zustimmung, Schlüsselhinweis, Rechtsquellen (Rust + SQLite) und die Schutzregeln
// der Weiterleitung an die Claude API und des Gesetzesabrufs.
import fs from "node:fs";
import path from "node:path";
import { Builder, By, until } from "selenium-webdriver";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const WORK = process.env.E2E_WORK;
const APP = process.env.E2E_APP ?? path.resolve(HERE, "../../target/debug/studium-os");
const shots = path.join(WORK, "shots-ki");
fs.mkdirSync(shots, { recursive: true });

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  – " + extra : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const d = await new Builder()
  .usingServer("http://127.0.0.1:4444/")
  .withCapabilities({ browserName: "wry", "tauri:options": { application: APP } })
  .build();
await d.manage().setTimeouts({ implicit: 4000 });
const shot = async (name) => fs.writeFileSync(path.join(shots, name + ".png"), await d.takeScreenshot(), "base64");
const invoke = (cmd, args = {}) =>
  d.executeAsyncScript(
    `const [cmd, args, done] = arguments;
     window.__TAURI_INTERNALS__.invoke(cmd, args).then(r => done({ ok: r ?? null }), e => done({ err: e }));`,
    cmd,
    args,
  );

try {
  await d.wait(until.elementLocated(By.xpath("//button[normalize-space()='Loslegen']")), 15000);
  await d.findElement(By.xpath("//button[normalize-space()='Loslegen']")).click();
  await d.wait(until.elementLocated(By.css(".area-tab")), 10000);

  // Schutzregeln der Weiterleitung
  const st = (await invoke("ai_status")).ok;
  check("Ohne Umgebungsvariable kein Schlüssel", st && st.available === false && st.key_source === "none" && st.can_fetch_laws === true, JSON.stringify(st));
  const foreign = await invoke("ai_http", { url: "https://example.org/v1/messages", method: "POST", headers: [], body: "{}" });
  check("Weiterleitung nur an api.anthropic.com", foreign.err?.code === "invalid", JSON.stringify(foreign.err));
  const otherPath = await invoke("ai_http", { url: "https://api.anthropic.com/v1/files", method: "POST", headers: [], body: "{}" });
  check("Nur der Messages-Endpunkt", otherPath.err?.code === "invalid");
  const get = await invoke("ai_http", { url: "https://api.anthropic.com/v1/messages", method: "GET", headers: [], body: "" });
  check("Nur POST", get.err?.code === "invalid");
  const nokey = await invoke("ai_http", { url: "https://api.anthropic.com/v1/messages", method: "POST", headers: [["content-type", "application/json"]], body: "{}" });
  check("Ohne Schlüssel klare Meldung", nokey.err?.code === "no_api_key" && /ANTHROPIC_API_KEY/.test(nokey.err?.message), nokey.err?.message);
  const badLaw = await invoke("law_fetch", { abbreviation: "../../etc" });
  check("Gesetzesabruf prüft die Abkürzung", badLaw.err?.code === "invalid", badLaw.err?.message);

  // Rechtsquellen über die Rust-Seite
  const saved = await invoke("legal_source_save", {
    source: { kind: "gesetz", title: "Mustergesetz", abbreviation: "MustG", version: "Testfassung" },
    chunks: [
      { norm: "§1", absatz: 1, heading: "Pflichten", text: "(1) Der Verkäufer einer Mustersache hat sie zu übergeben." },
      { norm: "§ 1", absatz: 2, heading: "Pflichten", text: "(2) Der Käufer hat den Musterpreis zu zahlen." },
    ],
  });
  check("Rechtsquelle gespeichert (Rust)", saved.ok?.chunk_count === 2, JSON.stringify(saved.err));
  const norm = (await invoke("legal_norm", { abbreviation: "mustg", norm: "§ 1", absatz: 2 })).ok;
  check("Normabruf mit Absatz", norm?.length === 1 && norm[0].text.includes("Musterpreis"));
  const hits = (await invoke("legal_search", { terms: ["musterpreis"], kinds: null, limit: 5 })).ok;
  check("Volltextsuche in Rechtsquellen", hits?.[0]?.absatz === 2);

  // Oberfläche
  await d.findElement(By.xpath("//button[contains(@class,'nav-item')][.//span[normalize-space()='KI-Assistent']]")).click();
  await d.wait(until.elementLocated(By.xpath("//*[contains(.,'KI-Assistent einschalten?')]")), 5000);
  const btn = await d.findElement(By.xpath("//button[normalize-space()='Einschalten']"));
  check("Ohne Zustimmung gesperrt", (await btn.getAttribute("disabled")) !== null);
  await d.findElement(By.xpath("//label[contains(.,'Ich habe das gelesen')]/input")).click();
  await btn.click();
  await d.wait(until.elementLocated(By.xpath("//*[contains(.,'Kein API-Schlüssel gefunden')]")), 5000);
  check("Hinweis zur Umgebungsvariable", true);
  const send = await d.findElement(By.xpath("//button[normalize-space()='Senden']"));
  check("Senden ohne Schlüssel deaktiviert", (await send.getAttribute("disabled")) !== null);
  await d.findElement(By.xpath("//button[@role='tab'][contains(.,'Rechtsquellen')]")).click();
  await sleep(600);
  const page = await d.executeScript("return document.querySelector('.page').textContent");
  check("Quellenliste zeigt importiertes Gesetz", page.includes("MustG") && page.includes("Testfassung"));
  check("Gesetze auf Knopfdruck angeboten (Desktop)", page.includes("BGB") && page.includes("KSchG"));
  await shot("ki-quellen");
  const consent = (await invoke("settings_all")).ok?.["ai.consent"];
  check("Zustimmung gespeichert", consent === true);
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.message);
} finally {
  await d.quit();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
