// End-to-End-Test der echten Studium-OS-App über tauri-driver (WebDriver).
// Prüft den kompletten Weg Oberfläche → Rust → SQLite → Dateisystem.
// Hinweis: Der WebKit-WebDriver tippt Großbuchstaben teils klein; Vergleiche
// sind daher bewusst unabhängig von Groß-/Kleinschreibung.
import fs from "node:fs";
import path from "node:path";
import { Builder, By, Key, until } from "selenium-webdriver";

// Aufruf über run.sh: legt einen frischen, temporären Datenordner an (XDG_DATA_HOME).
const HERE = path.dirname(new URL(import.meta.url).pathname);
const WORK = process.env.E2E_WORK;
const APP = process.env.E2E_APP ?? path.resolve(HERE, "../../target/debug/studium-os");
const DATA = path.join(process.env.XDG_DATA_HOME, "de.studium-os.app");
const PDF = path.join(HERE, "fixtures", "folien.pdf");
const BACKUPS = path.join(WORK, "backups");
const shots = path.join(WORK, "shots");
fs.mkdirSync(shots, { recursive: true });

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  – " + extra : ""}`);
};

async function session() {
  const d = await new Builder()
    .usingServer("http://127.0.0.1:4444/")
    .withCapabilities({ browserName: "wry", "tauri:options": { application: APP } })
    .build();
  await d.manage().setTimeouts({ implicit: 4000 });
  return d;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (d, name) => fs.writeFileSync(path.join(shots, name + ".png"), await d.takeScreenshot(), "base64");
const invoke = (d, cmd, args = {}) =>
  d.executeAsyncScript(
    `const [cmd, args, done] = arguments;
     window.__TAURI_INTERNALS__.invoke(cmd, args).then(r => done({ ok: r ?? null }), e => done({ err: e }));`,
    cmd,
    args,
  );
const text = async (d, css) => (await d.findElement(By.css(css))).getText();

let d = await session();
try {
  // 1. Ersteinrichtung
  await d.wait(until.elementLocated(By.xpath("//button[normalize-space()='Loslegen']")), 15000);
  await shot(d, "01-onboarding");
  await d.findElement(By.xpath("//button[normalize-space()='Loslegen']")).click();
  await d.wait(until.elementLocated(By.css(".area-tab")), 10000);
  const tabs = await d.findElements(By.css(".area-tab"));
  check("Ersteinrichtung legt 3 Studienbereiche + Gesamtansicht an", tabs.length === 4, `${tabs.length} Reiter`);
  check("Datenbankdatei existiert im Datenordner", fs.existsSync(path.join(DATA, "studium.sqlite")), DATA);

  // 2. Bereichswechsel
  await tabs[0].click();
  await sleep(400);
  const sections = await d.findElements(By.css(".side-section"));
  check("Wechsel zu einem Bereich zeigt nur dessen Struktur", sections.length === 1, `${sections.length} Abschnitte`);
  const semesterRows = await d.findElements(By.css(".tree-row"));
  check("Semester aus der Einrichtung ist im Baum", semesterRows.length === 1, (await semesterRows[0]?.getText()) ?? "");

  // 3. Veranstaltung anlegen (Kontextmenü am Semester) und umbenennen
  await d.actions().contextClick(semesterRows[0]).perform();
  await d.findElement(By.xpath("//button[contains(.,'Veranstaltung hinzufügen')]")).click();
  const rename = await d.wait(until.elementLocated(By.css(".tree-rename")), 5000);
  await rename.sendKeys(Key.chord(Key.CONTROL, "a"));
  await rename.sendKeys("BGB AT");
  await rename.sendKeys(Key.ENTER);
  await sleep(600);
  const title = await d.findElement(By.css(".page-title")).getAttribute("value");
  check("Veranstaltung anlegen und umbenennen", title.toLowerCase() === "bgb at", title);
  await d.findElement(By.xpath("//label[span[text()='Dozent/in']]/input")).sendKeys("Prof. Dr. Beispiel", Key.TAB);
  await sleep(400);

  // 4. Notiz mit Vorlage-freiem Text, Autosave
  await d.findElement(By.xpath("//button[normalize-space()='Notiz']")).click();
  const editor = await d.wait(until.elementLocated(By.css(".ProseMirror")), 5000);
  const tplCheck = await d.executeScript("return document.querySelector('.ProseMirror').innerText");
  await editor.click();
  await editor.sendKeys("## Anfechtung", Key.ENTER, "Die Anfechtung nach Paragraph 119 BGB wirkt rückwirkend. Stichwort Gestaltungsrecht.");
  await d.wait(until.elementLocated(By.xpath("//*[contains(@class,'save-status') and contains(., 'Gespeichert')]")), 6000);
  check("Autosave meldet „Gespeichert“", true);
  const noteTitle = await d.findElement(By.id("note-title"));
  await noteTitle.sendKeys(Key.chord(Key.CONTROL, "a"));
  await noteTitle.sendKeys("Mitschrift Anfechtung");
  await noteTitle.sendKeys(Key.ENTER);
  await sleep(700);
  await shot(d, "02-note");

  // 5. PDF importieren (Dateiauswahl ist ein nativer Dialog, daher direkt über den Befehl wie der Dialog es tut)
  const nodes = (await invoke(d, "nodes_list", { areaId: null })).ok;
  const course = nodes.find((n) => n.title.toLowerCase() === "bgb at");
  const note = nodes.find((n) => n.title.toLowerCase() === "mitschrift anfechtung");
  check("Notiz ist unter der Veranstaltung gespeichert", !!note && !!course && note.parent_id === course.id);
  const imp = await invoke(d, "documents_import", { paths: [PDF], nodeId: course.id, docType: "folien" });
  const doc = imp.ok?.[0]?.document;
  check("PDF-Import in den Dokumentenspeicher", !!doc && doc.text_status === "pending", JSON.stringify(imp.err ?? doc?.text_status));
  const blobs = fs.readdirSync(path.join(DATA, "files"));
  check("Datei liegt inhaltsadressiert im Speicher", blobs.length === 1);
  const dup = await invoke(d, "documents_import", { paths: [PDF], nodeId: null, docType: "folien" });
  check("Gleiche Datei wird nicht doppelt gespeichert", fs.readdirSync(path.join(DATA, "files")).length === 1 && !!dup.ok?.[0]?.document);

  // Neu laden: offene Texterkennung wird beim Start fortgesetzt
  await d.navigate().refresh();
  await d.wait(until.elementLocated(By.css(".area-tab")), 10000);
  let status = "";
  for (let i = 0; i < 30; i++) {
    status = (await invoke(d, "document_get", { id: doc.id })).ok.document.text_status;
    if (status !== "pending") break;
    await sleep(500);
  }
  check("PDF-Text wird lokal ausgelesen (pdf.js)", status === "ok", status);

  // 6. Globale Suche über die Oberfläche findet Text auf Seite 2
  await d.findElement(By.css("body")).sendKeys(Key.chord(Key.CONTROL, "k"));
  const input = await d.wait(until.elementLocated(By.css(".palette-input input")), 4000);
  await input.sendKeys("Weinversteigerung");
  await sleep(800);
  const hit = await d.findElements(By.xpath("//button[contains(@class,'palette-item')][.//span[contains(@class,'pill') and contains(.,'S. 2')]]"));
  check("Suche findet PDF-Text mit Seitenangabe (S. 2)", hit.length >= 1);
  await shot(d, "03-search");
  await input.sendKeys(Key.chord(Key.CONTROL, "a"));
  await input.sendKeys("Gestaltungsrecht");
  await sleep(800);
  const both = await d.findElements(By.css(".palette-item"));
  check("Suche findet Notiz und PDF zugleich", both.length >= 2, `${both.length} Treffer`);
  await input.sendKeys(Key.chord(Key.CONTROL, "a"));
  await input.sendKeys("Beispiel");
  await sleep(600);
  check("Suche findet Dozent in Veranstaltungsangaben", (await d.findElements(By.css(".palette-item"))).length >= 1);
  await input.sendKeys(Key.ESCAPE);

  // 7. PDF öffnen, Seite 2, mit Notiz verknüpfen (über die Oberfläche)
  await d.executeScript("arguments[0]", null);
  await invoke(d, "setting_set", { key: "ui.contextOpen", value: true });
  // Dokument über Suche öffnen
  await d.findElement(By.css("body")).sendKeys(Key.chord(Key.CONTROL, "k"));
  const inp2 = await d.wait(until.elementLocated(By.css(".palette-input input")), 4000);
  await inp2.sendKeys("Weinversteigerung", Key.ENTER);
  await d.wait(until.elementLocated(By.css(".pdf-page canvas")), 10000);
  await sleep(1500);
  const pageVal = await d.findElement(By.css(".pdf-page-input")).getAttribute("value");
  check("PDF öffnet direkt auf der gefundenen Seite", pageVal === "2", pageVal);
  await shot(d, "04-pdf");
  await d.findElement(By.xpath("//button[contains(.,'Seite mit Notiz verknüpfen')]")).click();
  const pick = await d.wait(until.elementLocated(By.css(".picker-input")), 4000);
  await pick.sendKeys("mitschrift anfechtung");
  await sleep(700);
  await pick.sendKeys(Key.ENTER);
  await sleep(800);
  // Die Suche kann auch die zweite (nicht zugeordnete) Kopie öffnen: beide prüfen.
  const dupId = dup.ok?.[0]?.document?.id;
  const links = [
    ...(await invoke(d, "links_for", { entityType: "document", id: doc.id })).ok,
    ...(dupId ? (await invoke(d, "links_for", { entityType: "document", id: dupId })).ok : []),
  ];
  check("Notiz mit konkreter PDF-Seite verknüpft", links.length === 1 && links[0].anchor.page === 2, JSON.stringify(links.map((l) => l.anchor)));
  const chips = await d.findElements(By.xpath("//div[contains(@class,'page-links')]//button[contains(translate(.,'MA','ma'),'mitschrift anfechtung')]"));
  check("PDF zeigt Notizen zur aktuellen Seite", chips.length === 1);

  // 8. Von der Notiz zurück zur Folie (geteilte Ansicht)
  await chips[0].click();
  await d.wait(until.elementLocated(By.css(".ProseMirror")), 5000);
  await sleep(800);
  const ctxRow = await d.findElements(By.xpath("//aside[contains(@class,'context')]//button[contains(.,'S. 2')]"));
  check("Kontextbereich der Notiz zeigt verknüpfte Folie mit Seite", ctxRow.length === 1);
  if (ctxRow[0]) {
    await ctxRow[0].click();
    await d.wait(until.elementLocated(By.css(".secondary .pdf-page canvas")), 10000);
    await sleep(1500);
    await shot(d, "05-split");
    check("Folie öffnet neben der Mitschrift (geteilte Ansicht)", true);
  }

  // 9. DOCX-Export-Befehl schreibt Datei (Speicherdialog ist nativ)
  const exportPath = path.join(WORK, "export-test.docx");
  const exp = await d.executeAsyncScript(
    `const [p, done] = arguments;
     const hex = Array.from(new TextEncoder().encode(p), b => b.toString(16).padStart(2,'0')).join('');
     window.__TAURI_INTERNALS__.invoke('export_write', new Uint8Array([80,75,3,4,1,2,3]), { headers: { 'x-path-hex': hex } })
       .then(() => done('ok'), e => done(JSON.stringify(e)));`,
    exportPath,
  );
  check("Export schreibt an gewählten Pfad", exp === "ok" && fs.existsSync(exportPath), exp);
  const bad = await d.executeAsyncScript(
    `const done = arguments[0];
     const hex = Array.from(new TextEncoder().encode('/tmp/boese.sh'), b => b.toString(16).padStart(2,'0')).join('');
     window.__TAURI_INTERNALS__.invoke('export_write', new Uint8Array([1]), { headers: { 'x-path-hex': hex } })
       .then(() => done('ok'), e => done(e.code));`,
  );
  check("Export lehnt fremde Dateitypen ab (.sh)", bad === "invalid", bad);

  // 10. Sicherheitsgrenzen der Oberfläche
  const fsTry = await invoke(d, "plugin:fs|read_text_file", { path: "/etc/passwd" });
  check("Kein freier Dateizugriff aus der Oberfläche", !!fsTry.err);
  const net = await d.executeAsyncScript(`const done = arguments[0]; fetch('https://example.org').then(() => done('erreicht'), () => done('blockiert'));`);
  check("Netzwerkzugriff aus der Oberfläche ist blockiert (CSP)", net === "blockiert", net);
  const badPath = await invoke(d, "read_external_file", { path: "/etc/passwd" });
  check("Import liest nur erlaubte Dateitypen", badPath.err?.code === "invalid");

  // 11. Backup über die Oberfläche
  fs.mkdirSync(BACKUPS, { recursive: true });
  await invoke(d, "setting_set", { key: "backup.dir", value: BACKUPS });
  await d.findElement(By.xpath("//button[contains(.,'Einstellungen & Backup')]")).click();
  await d.findElement(By.xpath("//button[@role='tab' and normalize-space()='Backup']")).click();
  await d.findElement(By.xpath("//button[contains(.,'Jetzt Backup erstellen')]")).click();
  await d.wait(until.elementLocated(By.xpath("//*[contains(@class,'toast') and contains(.,'Backup erstellt')]")), 20000);
  const files = fs.readdirSync(BACKUPS).filter((f) => f.endsWith(".studiumbackup"));
  check("Backup-Datei im gewählten Ordner erstellt und geprüft", files.length === 1, files[0]);
  await shot(d, "06-backup");
  const backupPath = path.join(BACKUPS, files[0]);
  const ver = (await invoke(d, "backup_verify", { path: backupPath })).ok;
  check("Backup-Prüfung: ok, 1 Dokument", ver.ok && ver.file_count === 1, JSON.stringify(ver.problems));

  // Inhalt nach dem Backup ändern
  await invoke(d, "note_save", {
    id: note.id,
    contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Versehentlich überschrieben" }] }] }),
    plainText: "Versehentlich überschrieben",
  });

  // 12. Neustart: Sitzung beenden, App neu starten
  await d.quit();
  d = await session();
  await d.wait(until.elementLocated(By.css(".area-tab")), 15000);
  const after = (await invoke(d, "note_get", { id: note.id })).ok;
  check("Nach Neustart: Daten vorhanden (kein Datenverlust)", after.content_json.includes("Versehentlich"));

  // 13. Wiederherstellen (Datei-Auswahl nativ → Befehl direkt) und Ergebnis in der Oberfläche
  const rest = await invoke(d, "backup_restore", { path: backupPath });
  check("Wiederherstellung erfolgreich", !!rest.ok, JSON.stringify(rest.err));
  check("Vorheriger Stand wurde als pre-restore beiseitegelegt", !!rest.ok && fs.existsSync(path.join(rest.ok.previous_state_dir, "studium.sqlite")));
  await d.navigate().refresh();
  await d.wait(until.elementLocated(By.css(".area-tab")), 10000);
  const restored = (await invoke(d, "note_get", { id: note.id })).ok;
  check("Notizinhalt aus dem Backup ist zurück", restored.content_json.toLowerCase().includes("paragraph 119") && !restored.content_json.includes("Versehentlich"));
  const docAfter = (await invoke(d, "document_get", { id: doc.id })).ok.document;
  check("Dokument und Datei sind nach Wiederherstellung vorhanden", docAfter.file_present === true);

  // 14. Beschädigtes Backup wird abgelehnt
  const broken = path.join(BACKUPS, "kaputt.studiumbackup");
  const raw = fs.readFileSync(backupPath);
  fs.writeFileSync(broken, raw.subarray(0, Math.floor(raw.length * 0.6)));
  const v2 = (await invoke(d, "backup_verify", { path: broken })).ok;
  const r2 = await invoke(d, "backup_restore", { path: broken });
  check("Beschädigtes Backup wird erkannt und nicht eingespielt", v2.ok === false && !!r2.err, v2.problems?.[0]);
  const stillThere = (await invoke(d, "note_get", { id: note.id })).ok;
  check("Daten nach abgelehnter Wiederherstellung unverändert", stillThere.content_json.toLowerCase().includes("paragraph 119"));

  // 15. Papierkorb
  await invoke(d, "node_trash", { id: course.id });
  const searchGone = (await invoke(d, "search", { query: "Gestaltungsrecht", areaId: null })).ok.filter((h) => h.entity_type === "note");
  check("Gelöschte Inhalte verschwinden aus der Suche", searchGone.length === 0);
  await invoke(d, "trash_restore", { itemType: "node", id: course.id });
  const back = (await invoke(d, "search", { query: "Gestaltungsrecht", areaId: null })).ok.filter((h) => h.entity_type === "note");
  check("Wiederhergestellte Inhalte sind wieder auffindbar", back.length === 1);

  // Dunkelmodus-Bild der Notiz
  await invoke(d, "setting_set", { key: "ui.theme", value: "dark" });
  await d.navigate().refresh();
  await d.wait(until.elementLocated(By.css(".area-tab")), 10000);
  await d.executeScript(`document.querySelector('.list-row')?.click()`);
  await sleep(1200);
  await shot(d, "07-dark");
} catch (e) {
  console.log("ABBRUCH:", e.message);
  try {
    await shot(d, "zz-error");
  } catch {}
  results.push({ name: "Ablauf ohne Abbruch", ok: false });
} finally {
  await d.quit().catch(() => {});
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
process.exit(failed.length ? 1 : 0);
