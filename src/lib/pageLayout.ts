/**
 * Seitenansicht für Dokumente (A4): Maße und Seitenumbrüche. Gerechnet wird
 * in CSS-Pixeln (96 dpi); die Ränder entsprechen dem Druck (print.ts).
 *
 * „Fluss“-Koordinaten: Seite k reicht inhaltlich von k·S bis k·S + C
 * (C = Inhaltshöhe, S = C + unterer Rand + Abstand + oberer Rand).
 */

export type PageMargins = "normal" | "korrektur";
export type PageStyle = "notiz" | "hausarbeit";

export interface PageSettings {
  margins: PageMargins;
  style: PageStyle;
}

export const DEFAULT_PAGE: PageSettings = { margins: "normal", style: "notiz" };

export function pageSettings(meta: Record<string, unknown> | undefined): PageSettings {
  const p = (meta?.page ?? {}) as Partial<PageSettings>;
  return { margins: p.margins === "korrektur" ? "korrektur" : "normal", style: p.style === "hausarbeit" ? "hausarbeit" : "notiz" };
}

const CM = 96 / 2.54;

export interface PageLayout {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** Abstand zwischen zwei Blättern auf dem Bildschirm */
  gap: number;
}

export function layoutFor(s: PageSettings): PageLayout {
  // wie printCss: oben rechts unten links
  const [t, r, b, l] = s.margins === "korrektur" ? [2.5, 7, 2, 2] : [2.5, 2, 2, 2.5];
  return { width: 21 * CM, height: 29.7 * CM, top: t * CM, right: r * CM, bottom: b * CM, left: l * CM, gap: 28 };
}

export const contentHeight = (L: PageLayout) => L.height - L.top - L.bottom;
export const stride = (L: PageLayout) => contentHeight(L) + L.bottom + L.gap + L.top;

export interface Block {
  /** oberer Rand im Fluss ohne Seitenabstände (0 = Beginn des Inhalts) */
  top: number;
  /** Höhe einschließlich Abstand zum nächsten Block */
  height: number;
  /** Seitenumbruch: der nächste Block beginnt auf einer neuen Seite */
  pageBreak?: boolean;
}

export interface Gap {
  /** vor diesem Block (Index) */
  index: number;
  /** Höhe des Zwischenraums */
  height: number;
  /** Seite, die davor endet (0-basiert) */
  page: number;
  /** Abstand vom Beginn des Zwischenraums bis zum unteren Seitenende der endenden Seite */
  toPageEnd: number;
}

/**
 * Wo Blöcke auf die nächste Seite rücken. Ein Block, der nicht mehr ganz auf
 * die Seite passt, beginnt auf der nächsten (außer er ist höher als eine
 * ganze Seite – dann läuft er über die Grenze).
 */
export function pageBreaks(blocks: Block[], L: PageLayout): { gaps: Gap[]; pages: number } {
  const C = contentHeight(L);
  const S = stride(L);
  const gaps: Gap[] = [];
  let extra = 0;
  let forceNext = false;
  let page = 0;
  let lastEnd = 0;
  blocks.forEach((b, i) => {
    const y = b.top + extra;
    page = Math.max(page, Math.floor(y / S));
    const pageStart = page * S;
    const pageEnd = pageStart + C;
    let push = false;
    if (forceNext && i > 0) push = true;
    else if (y > pageEnd) push = true;
    else if (y + b.height > pageEnd + 0.5 && b.height <= C && y > pageStart + 0.5) push = true;
    if (push) {
      const target = (page + 1) * S;
      const h = target - y;
      gaps.push({ index: i, height: h, page, toPageEnd: pageEnd + L.bottom - y });
      extra += h;
      page++;
    }
    forceNext = !!b.pageBreak;
    lastEnd = b.top + extra + b.height;
  });
  const pages = Math.max(1, Math.floor(Math.max(0, lastEnd - 1) / S) + 1, page + 1);
  return { gaps, pages };
}
