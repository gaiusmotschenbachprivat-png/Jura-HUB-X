/**
 * Mitgelieferte Gesetze erzeugen: PDF-Fassung von gesetze-im-internet.de →
 * public/gesetze/<abk>.json (Normen und Absätze wie beim Import in der App).
 * Gesetzestexte sind amtliche Werke (§ 5 UrhG) und frei verwendbar.
 *
 * Aufruf: npx tsx tools/gesetze.ts StGB.pdf BGB.pdf
 */
import fs from "node:fs";
import path from "node:path";

import { parseLawText } from "../src/ai/sources/lawText";

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const index: { abbreviation: string; title: string; version: string; norms: number; chunks: number; file: string }[] = [];
for (const file of process.argv.slice(2)) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)) }).promise;
  const pages: string[] = [];
  // gleiche Textgewinnung wie src/lib/pdf.ts (extractPdfText)
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    let text = "";
    for (const item of content.items) if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
    pages.push(text.replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").trim());
  }
  const law = parseLawText(pages.join("\n\n"), { origin: path.basename(file) });
  const name = `${law.source.abbreviation.toLowerCase()}.json`;
  fs.writeFileSync(path.join("public/gesetze", name), JSON.stringify(law));
  const norms = new Set(law.chunks.map((c) => c.norm)).size;
  index.push({ abbreviation: law.source.abbreviation, title: law.source.title, version: law.source.version ?? "", norms, chunks: law.chunks.length, file: name });
  console.log(`${law.source.abbreviation}: ${norms} Normen, ${law.chunks.length} Abschnitte → ${name}`);
}
fs.writeFileSync("public/gesetze/index.json", JSON.stringify(index, null, 1));
