/**
 * Import von Rechtsquellen in die Datenbank:
 * - Gesetz auf Knopfdruck von gesetze-im-internet.de (nur Desktop; die Rust-Seite lädt)
 * - Dateien: XML/ZIP von gesetze-im-internet.de, PDF, DOCX, TXT/MD
 */
import type { Backend } from "../../api/backend";
import type { LegalKind, LegalSource, NewLegalSource } from "../../api/types";
import { parseGiiArchive } from "./gii";
import { chunkText } from "./text";

/** Häufig gebrauchte Gesetze für die Schnellauswahl (Abkürzung bei gesetze-im-internet.de). */
export const COMMON_LAWS: { abbr: string; label: string }[] = [
  { abbr: "bgb", label: "BGB" },
  { abbr: "hgb", label: "HGB" },
  { abbr: "zpo", label: "ZPO" },
  { abbr: "stgb", label: "StGB" },
  { abbr: "stpo", label: "StPO" },
  { abbr: "gg", label: "GG" },
  { abbr: "vwvfg", label: "VwVfG" },
  { abbr: "vwgo", label: "VwGO" },
  { abbr: "kschg", label: "KSchG" },
  { abbr: "tzbfg", label: "TzBfG" },
  { abbr: "betrvg", label: "BetrVG" },
  { abbr: "agg", label: "AGG" },
];

export async function importLaw(backend: Pick<Backend, "lawFetch" | "legalSourceSave">, abbr: string): Promise<LegalSource> {
  const a = abbr.trim().toLowerCase();
  const bytes = await backend.lawFetch(a);
  const law = await parseGiiArchive(bytes, `https://www.gesetze-im-internet.de/${a}/`);
  return backend.legalSourceSave(law.source, law.chunks);
}

export interface FileMeta {
  kind: LegalKind;
  title: string;
  court?: string;
  file_number?: string;
  decision_date?: string;
  version?: string;
}

/** Text einer Datei lesen (PDF, DOCX, TXT/MD) – lokal, ohne Netzwerk. */
export async function readText(name: string, bytes: Uint8Array): Promise<string> {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") {
    const { loadPdf, extractPdfText, closePdf } = await import("../../lib/pdf");
    const pdf = await loadPdf(bytes);
    try {
      return (await extractPdfText(pdf)).join("\n\n");
    } finally {
      void closePdf(pdf);
    }
  }
  if (ext === "docx") {
    const { docxToText } = await import("../../lib/docxImport");
    return docxToText(bytes);
  }
  if (ext === "txt" || ext === "md" || ext === "markdown") return new TextDecoder().decode(bytes);
  throw new Error(`Dateityp „.${ext}“ wird für Rechtsquellen nicht unterstützt (PDF, DOCX, TXT, MD oder XML/ZIP von gesetze-im-internet.de).`);
}

export async function importFile(
  backend: Pick<Backend, "legalSourceSave">,
  name: string,
  bytes: Uint8Array,
  meta: FileMeta,
): Promise<LegalSource> {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "xml" || ext === "zip") {
    const law = await parseGiiArchive(bytes, name);
    return backend.legalSourceSave(law.source, law.chunks);
  }
  const text = await readText(name, bytes);
  const chunks = chunkText(text);
  if (!chunks.length) throw new Error("In der Datei wurde kein Text gefunden (gescannte PDFs ohne Texterkennung werden nicht unterstützt).");
  const source: NewLegalSource = { ...meta, title: meta.title.trim() || name.replace(/\.[^.]+$/, ""), origin: name };
  return backend.legalSourceSave(source, chunks);
}
