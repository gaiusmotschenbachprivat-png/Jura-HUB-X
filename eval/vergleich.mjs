// Vergleicht zwei Evaluationsläufe: node eval/vergleich.mjs [alt.json] [neu.json]
// Ohne Angaben: die beiden neuesten Dateien in eval/ergebnisse/.
import fs from "node:fs";
import path from "node:path";

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "ergebnisse");
let [a, b] = process.argv.slice(2);
if (!a || !b) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  if (files.length < 2) {
    console.error("Es werden mindestens zwei Läufe in eval/ergebnisse/ benötigt.");
    process.exit(1);
  }
  [a, b] = files.slice(-2).map((f) => path.join(dir, f));
}
const A = JSON.parse(fs.readFileSync(a, "utf8"));
const B = JSON.parse(fs.readFileSync(b, "utf8"));
const rows = [
  ["bestanden", "quote", true],
  ["Norm-Trefferquote", "norm_recall", true],
  ["Stichwort-Quote", "stichworte_quote", true],
  ["falsche Zitate", "falsche_zitate", false],
  ["Halluzinationen", "halluzinationen", false],
  ["überarbeitet", "ueberarbeitet", false],
  ["Kosten (USD)", "kosten_usd", false],
];
console.log(`Alt: ${path.basename(a)} (${A.label})\nNeu: ${path.basename(b)} (${B.label})\n`);
console.log("Kennzahl".padEnd(22) + "alt".padStart(10) + "neu".padStart(10) + "   Änderung");
for (const [name, key, higherIsBetter] of rows) {
  const x = A.zusammenfassung[key];
  const y = B.zusammenfassung[key];
  const d = Math.round((y - x) * 100) / 100;
  const mark = d === 0 ? "" : (d > 0) === higherIsBetter ? "  besser" : "  schlechter";
  console.log(name.padEnd(22) + String(x).padStart(10) + String(y).padStart(10) + `   ${d > 0 ? "+" : ""}${d}${mark}`);
}
const byA = new Map(A.fragen.map((f) => [f.id, f.score]));
console.log("\nGeänderte Fragen:");
let any = false;
for (const f of B.fragen) {
  const old = byA.get(f.id);
  if (!old || !f.score || old.bestanden === f.score.bestanden) continue;
  any = true;
  console.log(`  ${f.score.bestanden ? "✓ jetzt bestanden" : "✗ jetzt nicht bestanden"}  ${f.id}`);
}
if (!any) console.log("  keine");
