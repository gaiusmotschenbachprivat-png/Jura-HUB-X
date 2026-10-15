/** Umrechnungen für Schriftformatierung (Editor und Word-Export). */

/** Abstand aus CSS (pt, px, cm, mm, in, em) in Punkt. */
export function cssLengthToPt(v: string): number | null {
  const m = /^(-?[\d.]+)\s*(pt|px|cm|mm|in|em|rem)?$/i.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? "px").toLowerCase();
  const f: Record<string, number> = { pt: 1, px: 0.75, cm: 28.3465, mm: 2.83465, in: 72, em: 12, rem: 12 };
  return n * (f[unit] ?? 0.75);
}

/** Erster Schriftname aus einer CSS-Schriftliste (für Word). */
export function primaryFont(css: string): string {
  return (css.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "");
}

/** Schriftgröße aus CSS ("12pt", "16px") in Punkt. */
export function fontSizePt(css: string): number | null {
  const pt = cssLengthToPt(css);
  return pt && pt > 0 && pt < 500 ? Math.round(pt * 2) / 2 : null;
}
