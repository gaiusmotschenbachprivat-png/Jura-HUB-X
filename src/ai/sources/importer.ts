/**
 * Import von Rechtsquellen in die Datenbank:
 * - Gesetz auf Knopfdruck von gesetze-im-internet.de (nur Desktop; die Rust-Seite lädt)
 * - Dateien: XML/ZIP von gesetze-im-internet.de, PDF, DOCX, TXT/MD
 */
import type { Backend } from "../../api/backend";
import type { LegalKind, LegalSource, NewLegalSource } from "../../api/types";
import { parseGiiArchive } from "./gii";
import { lawHeader, lawTextFromChunks, looksLikeLaw, parseLawText } from "./lawText";
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
  /** Abkürzung eines Gesetzes (z. B. „StGB“); leer = aus der Datei erkennen */
  abbreviation?: string;
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
  // Gesetze (auch als PDF/DOCX/TXT) in Normen und Absätze zerlegen – sonst findet der Normabruf sie nicht.
  // Ohne Auswahl „Gesetz“ nur, wenn die Datei eindeutig ein Gesetz ist (Kopf „Titel (Abk.)“ und viele §-Überschriften).
  const isLaw = meta.kind === "gesetz" || (looksLikeLaw(text) && !!lawHeader(text.split("\n").map((l) => l.trim()).filter(Boolean)).abbreviation);
  if (isLaw) {
    const law = parseLawText(text, { title: meta.title, abbreviation: meta.abbreviation, origin: name });
    if (!law.source.abbreviation)
      throw new Error("Die Abkürzung des Gesetzes wurde nicht erkannt. Bitte im Feld „Abkürzung“ eintragen (z. B. StGB) und erneut importieren.");
    return backend.legalSourceSave(law.source, law.chunks);
  }
  const chunks = chunkText(text);
  if (!chunks.length) throw new Error("In der Datei wurde kein Text gefunden (gescannte PDFs ohne Texterkennung werden nicht unterstützt).");
  const source: NewLegalSource = { ...meta, title: meta.title.trim() || name.replace(/\.[^.]+$/, ""), origin: name };
  return backend.legalSourceSave(source, chunks);
}

export const LAW_UPGRADE_SETTING = "ai.lawUpgrade";

/**
 * Vor 0.19 wurden Gesetze aus PDF/DOCX/TXT als einfacher Text gespeichert (ohne
 * Paragraphen) – der Normabruf fand sie nicht. Solche Quellen werden einmalig
 * aus den gespeicherten Abschnitten als Gesetz neu aufbereitet; die alte Quelle
 * wird danach entfernt. Gibt es das Gesetz schon (z. B. neu importiert), bleibt
 * alles unverändert. Jede Quelle wird nur einmal geprüft.
 */
export async function upgradeTextLaws(
  backend: Pick<Backend, "legalSourcesList" | "legalSourceTexts" | "legalSourceSave" | "legalSourceDelete" | "settingsAll" | "settingSet">,
): Promise<LegalSource[]> {
  const settings = await backend.settingsAll();
  const raw = settings[LAW_UPGRADE_SETTING];
  const checked = new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  const sources = await backend.legalSourcesList();
  const todo = sources.filter((s) => s.kind !== "gesetz" && s.chunk_count >= 3 && /\.(pdf|docx|txt|md)$/i.test(s.origin) && !checked.has(s.id));
  if (!todo.length) return [];
  const laws = new Set(sources.filter((s) => s.kind === "gesetz").map((s) => s.abbreviation.toLowerCase()));
  const done: LegalSource[] = [];
  for (const s of todo) {
    checked.add(s.id);
    try {
      const text = lawTextFromChunks((await backend.legalSourceTexts(s.id)).map((t) => ({ text: t })));
      if (!looksLikeLaw(text)) continue;
      const law = parseLawText(text, { origin: s.origin });
      const abbr = law.source.abbreviation;
      if (!abbr || laws.has(abbr.toLowerCase())) continue;
      const saved = await backend.legalSourceSave(law.source, law.chunks);
      await backend.legalSourceDelete(s.id);
      checked.delete(s.id);
      laws.add(abbr.toLowerCase());
      done.push(saved);
    } catch {
      // kein Gesetz (oder nicht lesbar): Quelle bleibt, wie sie ist
    }
  }
  const ids = new Set(sources.map((s) => s.id));
  await backend.settingSet(LAW_UPGRADE_SETTING, [...checked].filter((id) => ids.has(id)).slice(-300));
  return done;
}
