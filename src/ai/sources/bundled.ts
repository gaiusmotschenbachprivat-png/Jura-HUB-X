/**
 * Mitgelieferte Gesetze (StGB, BGB): fertig in Normen und Absätze zerlegt
 * (erzeugt mit tools/gesetze.ts aus der PDF-Fassung von gesetze-im-internet.de)
 * und mit der App ausgeliefert. Geladen wird nur von derselben Adresse wie die
 * App – kein fremder Server. Der Stand steht in jeder Quelle; ob er aktuell ist,
 * prüft Studium OS nicht.
 */
import type { Backend } from "../../api/backend";
import type { LegalSource, NewLegalChunk, NewLegalSource } from "../../api/types";

export interface BundledLaw {
  abbreviation: string;
  title: string;
  version: string;
  norms: number;
  chunks: number;
  file: string;
}

export const BUNDLED_SETTING = "ai.bundledLaws";
export const BUNDLED_ORIGIN = "mitgeliefert (gesetze-im-internet.de)";

type LawBackend = Pick<Backend, "legalSourcesList" | "legalSourceSave" | "settingsAll" | "settingSet">;

const base = () => new URL("gesetze/", document.baseURI);
let indexPromise: Promise<BundledLaw[]> | null = null;

/** Verzeichnis der mitgelieferten Gesetze (leer, wenn nicht vorhanden, z. B. Desktop-App). */
export function bundledLaws(): Promise<BundledLaw[]> {
  indexPromise ??= fetch(new URL("index.json", base()))
    .then((r) => (r.ok ? r.json() : []))
    .then((l: unknown) => (Array.isArray(l) ? (l as BundledLaw[]).filter((x) => x && typeof x.abbreviation === "string" && /^[a-z0-9_-]+\.json$/.test(x.file)) : []))
    .catch(() => []);
  return indexPromise;
}

export async function bundledFor(abbreviation: string): Promise<BundledLaw | undefined> {
  return (await bundledLaws()).find((b) => b.abbreviation.toLowerCase() === abbreviation.toLowerCase());
}

/** Mitgeliefertes Gesetz in die Rechtsquellen übernehmen (ersetzt ein gleichnamiges Gesetz). */
export async function installBundled(backend: LawBackend, law: BundledLaw): Promise<LegalSource> {
  const r = await fetch(new URL(law.file, base()));
  if (!r.ok) throw new Error(`${law.abbreviation} konnte nicht geladen werden.`);
  const data = (await r.json()) as { source: NewLegalSource; chunks: NewLegalChunk[] };
  if (!data?.source || !Array.isArray(data.chunks)) throw new Error(`${law.abbreviation}: Datei beschädigt.`);
  const saved = await backend.legalSourceSave({ ...data.source, kind: "gesetz", origin: BUNDLED_ORIGIN }, data.chunks);
  const s = await backend.settingsAll();
  const done = Array.isArray(s[BUNDLED_SETTING]) ? (s[BUNDLED_SETTING] as string[]) : [];
  if (!done.includes(law.abbreviation)) await backend.settingSet(BUNDLED_SETTING, [...done, law.abbreviation].slice(-50));
  return saved;
}

/** Ist ein vorhandenes Gesetz unvollständig (z. B. mit einer älteren Version aus einer PDF eingelesen)? */
export const isIncomplete = (s: LegalSource, law: BundledLaw) => s.chunk_count < law.chunks * 0.95;

/**
 * Beim Start: fehlende mitgelieferte Gesetze einmalig einrichten und
 * unvollständige Fassungen ersetzen. Ein bewusst gelöschtes Gesetz kommt nicht
 * von selbst zurück. Gibt die übernommenen Gesetze und den Grund zurück.
 */
export async function ensureBundledLaws(backend: LawBackend): Promise<{ law: LegalSource; reason: "neu" | "vervollständigt" }[]> {
  const laws = await bundledLaws();
  if (!laws.length) return [];
  const [sources, settings] = await Promise.all([backend.legalSourcesList(), backend.settingsAll()]);
  const done = Array.isArray(settings[BUNDLED_SETTING]) ? (settings[BUNDLED_SETTING] as string[]) : [];
  const out: { law: LegalSource; reason: "neu" | "vervollständigt" }[] = [];
  for (const law of laws) {
    const have = sources.find((s) => s.kind === "gesetz" && s.abbreviation.toLowerCase() === law.abbreviation.toLowerCase());
    if (have && !isIncomplete(have, law)) continue;
    if (!have && done.includes(law.abbreviation)) continue;
    try {
      out.push({ law: await installBundled(backend, law), reason: have ? "vervollständigt" : "neu" });
    } catch {
      // ohne Netz beim ersten Mal: beim nächsten Start erneut
    }
  }
  return out;
}
