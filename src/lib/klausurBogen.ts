/**
 * Klausurbogen (A4 hoch): Kopffelder rechts oben (Fach/Kurs, Name/Kenn-Nr.,
 * Datum), linierter Schreibbereich (27 Zeilen à 9 mm), rechts Korrekturrand,
 * unten „Bogen Nr.“. Alle Maße in Millimetern; Bildschirm (Seitenansicht) und
 * PDF nutzen dieselben Werte.
 */
import type { PageLayout } from "./pageLayout";

export const MM = 96 / 25.4; // CSS-Pixel je Millimeter
export const PT_PER_MM = 72 / 25.4;

export const BOGEN = {
  width: 210,
  height: 297,
  /** Rahmen des Schreibbereichs (inkl. Korrekturrand) */
  box: { left: 12, top: 40, right: 193, bottom: 283 },
  /** Trennlinie Text | Korrekturrand – Korrekturrand ein Drittel der Seitenbreite (70 mm) */
  divider: 123,
  pitch: 9,
  rows: 27,
  /** Abstand des Textes zu Rahmen und Trennlinie */
  inset: 2,
  /** Kopffelder: Linie bei y, Beschriftung links, Feld bis rechts */
  head: { left: 112, right: 193, topRule: 10, lines: [18, 27, 36] as const },
  /** „Bogen Nr.“ unten rechts */
  foot: { y: 289, left: 157, right: 193 },
  fontPt: 12,
} as const;

export const HEAD_LABELS = ["Fach/Kurs:", "Name/Kenn-Nr.:", "Datum:"] as const;

/** Seitenmaß für die Seitenansicht (Textspalte im Raster) */
export function klausurLayout(): PageLayout {
  const b = BOGEN;
  return {
    width: b.width * MM,
    height: b.height * MM,
    top: b.box.top * MM,
    right: (b.width - b.divider + b.inset) * MM,
    bottom: (b.height - b.box.bottom) * MM,
    left: (b.box.left + b.inset) * MM,
    gap: 28,
    grid: b.pitch * MM,
  };
}

export interface KlausurHead {
  fach: string;
  name: string;
  datum: string;
}

const str = (v: unknown, max = 120) => (typeof v === "string" ? v.slice(0, max) : "");

/** Kopffelder aus den Metadaten; leere Felder mit Vorgaben (Veranstaltung, heute) */
export function klausurHead(meta: Record<string, unknown> | undefined, defaults: { fach?: string; today?: Date } = {}): KlausurHead {
  const k = (meta?.klausur ?? {}) as Record<string, unknown>;
  const d = defaults.today ?? new Date();
  const today = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  return {
    fach: str(k.fach) || defaults.fach || "",
    name: str(k.name),
    datum: str(k.datum, 40) || today,
  };
}

/** Grundlinie einer Zeile (mm von oben), Text senkrecht in der Zeile mittig (Times: Ober-/Unterlänge 0,891/0,216) */
export function baselineMm(rowTopMm: number, pitchMm: number, fontPt: number): number {
  const fsMm = fontPt / PT_PER_MM;
  return rowTopMm + pitchMm / 2 + (0.891 - (0.891 + 0.216) / 2) * fsMm;
}

/** Dateien (Dokument-IDs), deren Seiten vor dem ersten Bogen stehen (Sachverhalt, Deckblatt …) */
export function vorabIds(meta: Record<string, unknown> | undefined): string[] {
  const v = ((meta?.klausur ?? {}) as Record<string, unknown>).vorab;
  return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && /^[\w-]{8,64}$/.test(x)))].slice(0, 20) : [];
}

/** Dateitypen, deren Seiten vorangestellt werden können */
export const VORAB_EXT = ["pdf", "png", "jpg", "jpeg"] as const;
export const isVorabExt = (ext: string) => (VORAB_EXT as readonly string[]).includes(ext.toLowerCase());
