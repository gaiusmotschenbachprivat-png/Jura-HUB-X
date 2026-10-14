/**
 * Import von Gesetzen im XML-Format von gesetze-im-internet.de (DTD „gii-norm“).
 * Ein Archiv `xml.zip` enthält eine XML-Datei mit allen Normen eines Gesetzes.
 *
 * Aufteilung: je Absatz einer Norm ein Abschnitt („§ 433“, Absatz 1, 2 …);
 * Normen ohne nummerierte Absätze bleiben ein Abschnitt.
 */
import type { NewLegalChunk, NewLegalSource } from "../../api/types";
import { entryData, readZipDirectory } from "../../core/zip";

export interface ParsedLaw {
  source: NewLegalSource;
  chunks: NewLegalChunk[];
}

const BLOCK = new Set(["P", "DL", "DT", "DD", "LA", "BR", "TABLE", "ROW", "TR", "ENTRY", "TD", "Content", "pre"]);

/** Text eines Elements mit Zeilenumbrüchen an Blockgrenzen (Listen, Zeilenumbrüche). */
function textOf(el: Element): string {
  let out = "";
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      out += n.nodeValue ?? "";
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    const name = e.localName;
    if (name === "BR") {
      out += "\n";
      return;
    }
    if (name === "DT") {
      out += "\n";
      e.childNodes.forEach(walk);
      out += " ";
      return;
    }
    e.childNodes.forEach(walk);
    if (BLOCK.has(name) && name !== "DT") out += "\n";
  };
  walk(el);
  return out
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

const first = (el: Element, name: string) => el.getElementsByTagName(name)[0] ?? null;
const text = (el: Element | null) => (el ? (el.textContent ?? "").replace(/\s+/g, " ").trim() : "");

/** Liest die XML-Datei eines Gesetzes. */
export function parseGiiXml(xml: string, origin = ""): ParsedLaw {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Die Datei ist kein gültiges XML.");
  const norms = [...doc.getElementsByTagName("norm")];
  if (!norms.length) throw new Error("Die Datei enthält keine Normen im Format von gesetze-im-internet.de.");
  const head = first(norms[0]!, "metadaten");
  const abbreviation = text(first(norms[0]!, "amtabk")) || text(first(norms[0]!, "jurabk"));
  const title = text(head && first(head, "langue")) || text(head && first(head, "kurzue")) || abbreviation;
  const stand = [...(head?.getElementsByTagName("standangabe") ?? [])]
    .map((s) => `${text(first(s, "standtyp"))}: ${text(first(s, "standkommentar"))}`.trim())
    .filter((s) => s.length > 2)
    .join(" · ");
  const chunks: NewLegalChunk[] = [];
  let gliederung = "";
  for (const n of norms) {
    const meta = first(n, "metadaten");
    if (!meta) continue;
    const g = first(meta, "gliederungseinheit");
    if (g) {
      gliederung = [text(first(g, "gliederungsbez")), text(first(g, "gliederungstitel"))].filter(Boolean).join(" ");
    }
    const enbez = text(first(meta, "enbez"));
    if (!enbez || /^§§|Inhaltsübersicht|Inhaltsverzeichnis|Eingangsformel|Schlussformel/i.test(enbez)) continue;
    const titel = text(first(meta, "titel"));
    const content = first(n, "Content") ?? first(n, "text");
    if (!content) continue;
    const norm = enbez.replace(/^Art\s+/, "Art. ");
    const heading = [titel, gliederung].filter(Boolean).join(" – ");
    const ps = [...content.getElementsByTagName("P")].filter((p) => !p.parentElement?.closest("P"));
    const parts = ps.length ? ps.map(textOf) : [textOf(content)];
    for (const part of parts) {
      if (!part) continue;
      const m = /^\((\d+)\)\s*/.exec(part);
      chunks.push({ norm, absatz: m ? Number(m[1]) : null, heading, text: part });
    }
  }
  if (!chunks.length) throw new Error("In der Datei wurden keine Normtexte gefunden.");
  return {
    source: { kind: "gesetz", title, abbreviation, version: stand, origin },
    chunks,
  };
}

function decode(bytes: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 200));
  const enc = /encoding=["']([\w-]+)["']/i.exec(head)?.[1]?.toLowerCase() ?? "utf-8";
  return new TextDecoder(enc === "iso-8859-1" || enc === "latin1" ? "latin1" : "utf-8").decode(bytes);
}

/** Liest ein Archiv `xml.zip` (oder eine einzelne XML-Datei) von gesetze-im-internet.de. */
export async function parseGiiArchive(data: Blob | Uint8Array, origin = ""): Promise<ParsedLaw> {
  const blob = data instanceof Blob ? data : new Blob([data as Uint8Array<ArrayBuffer>]);
  const headBytes = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (headBytes[0] === 0x50 && headBytes[1] === 0x4b) {
    const entries = await readZipDirectory(blob);
    const xml = entries.find((e) => /\.xml$/i.test(e.name) && !e.name.includes("/"));
    if (!xml) throw new Error("Im Archiv wurde keine XML-Datei gefunden.");
    const bytes = new Uint8Array(await (await entryData(blob, xml, 200 * 1024 * 1024)).arrayBuffer());
    return parseGiiXml(decode(bytes), origin);
  }
  return parseGiiXml(decode(new Uint8Array(await blob.arrayBuffer())), origin);
}
