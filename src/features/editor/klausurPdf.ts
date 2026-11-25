/**
 * Klausurbogen als PDF (zum Hochladen): Bogen (Kopffelder, Linien,
 * Korrekturrand, „Bogen Nr.“) und Text werden direkt als PDF gezeichnet –
 * durchsuchbarer Text, kleine Datei. Jedes Wort steht an der Stelle, an der es
 * in der Seitenansicht steht; senkrecht sitzt es mittig in seiner Zeile.
 * Läuft vollständig auf dem Gerät.
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

import { api, errorMessage } from "../../api";
import { BOGEN, HEAD_LABELS, MM, PT_PER_MM, baselineMm, type KlausurHead } from "../../lib/klausurBogen";
import { useApp } from "../../state/store";

/** Ein Wort (oder Zeichen) im Text mit Lage und Auszeichnung */
export interface Run {
  text: string;
  page: number;
  row: number;
  /** linker Rand in mm vom Blattrand */
  x: number;
  /** Breite in mm (für Unterstreichung, Markierung) */
  w: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  sizePt: number;
  color: [number, number, number] | null;
  highlight: [number, number, number] | null;
}

// Zeichen außerhalb der PDF-Standardschrift (WinAnsi) ersetzen
const REPLACE: Record<string, string> = {
  "→": "->", "←": "<-", "↔": "<->", "⇒": "=>", "⇔": "<=>", "≥": ">=", "≤": "<=", "≠": "!=", "≈": "~",
  " ": " ", " ": " ", " ": " ", "‑": "-", "−": "-", "✓": "v", "✗": "x", "×": "x",
};

export function pdfSafe(text: string, font: PDFFont): string {
  let out = "";
  for (const ch of text) {
    const c = REPLACE[ch] ?? ch;
    try {
      font.encodeText(c);
      out += c;
    } catch {
      out += "?";
    }
  }
  return out;
}

function parseColor(css: string): [number, number, number, number] | null {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(css);
  if (!m) return null;
  let a = m[4] === undefined ? 1 : m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
  if (!Number.isFinite(a)) a = 1;
  return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255, a];
}

/** Auszeichnungen eines Textknotens aus den berechneten Stilen */
function styleOf(el: Element, root: Element) {
  const cs = getComputedStyle(el);
  let underline = false;
  let strike = false;
  let highlight: [number, number, number] | null = null;
  for (let e: Element | null = el; e && e !== root; e = e.parentElement) {
    const s = getComputedStyle(e);
    const line = s.textDecorationLine || "";
    if (line.includes("underline") && !e.matches(".norm-ref, a.norm, [data-norm]")) underline = true;
    if (line.includes("line-through")) strike = true;
    if (!highlight && e.tagName === "MARK") {
      const c = parseColor(s.backgroundColor);
      if (c && c[3] > 0.05) highlight = [1 - (1 - c[0]) * c[3], 1 - (1 - c[1]) * c[3], 1 - (1 - c[2]) * c[3]];
    }
  }
  const col = parseColor(cs.color);
  // fast schwarz → schwarz (Grundfarbe des Bogens)
  const color: [number, number, number] | null = col && Math.max(col[0], col[1], col[2]) > 0.25 ? [col[0], col[1], col[2]] : null;
  return {
    bold: Number(cs.fontWeight) >= 600 || cs.fontWeight === "bold",
    italic: cs.fontStyle === "italic" || cs.fontStyle === "oblique",
    underline,
    strike,
    sizePt: Math.round(parseFloat(cs.fontSize) * 0.75 * 10) / 10 || BOGEN.fontPt,
    color,
    highlight,
  };
}

/**
 * Liest die Wörter aus der Seitenansicht. `root` ist die ProseMirror-Fläche
 * (Breite = Blattbreite, Blätter untereinander mit `gap` Abstand).
 */
export function collectRuns(root: HTMLElement, gap: number): Run[] {
  const rootRect = root.getBoundingClientRect();
  const scale = rootRect.width / (BOGEN.width * MM) || 1;
  const pagePx = BOGEN.height * MM + gap;
  const pitchPx = BOGEN.pitch * MM;
  const topPx = BOGEN.box.top * MM;
  const runs: Run[] = [];
  const place = (r: DOMRect) => {
    const x = (r.left - rootRect.left) / scale;
    const yMid = (r.top + r.height / 2 - rootRect.top) / scale;
    const page = Math.floor(yMid / pagePx);
    const row = Math.floor((yMid - page * pagePx - topPx) / pitchPx);
    return { page, row, x: x / MM, w: r.width / scale / MM };
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const p = n.parentElement;
      if (!p || p.closest(".page-gap, [contenteditable=false]:not(.ProseMirror)")) return NodeFilter.FILTER_REJECT;
      return n.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const range = document.createRange();
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const st = styleOf(n.parentElement!, root);
    const text = n.data;
    const re = /\S+/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      range.setStart(n, m.index);
      range.setEnd(n, m.index + m[0].length);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
      if (rects.length === 1) {
        runs.push({ text: m[0], ...place(rects[0]!), ...st });
        continue;
      }
      // Wort über zwei Zeilen (sehr lang): Zeichen einzeln
      for (let i = 0; i < m[0].length; i++) {
        range.setStart(n, m.index + i);
        range.setEnd(n, m.index + i + 1);
        const r = range.getClientRects()[0];
        if (r && r.width > 0) runs.push({ text: m[0][i]!, ...place(r), ...st });
      }
    }
  }
  // Aufzählungszeichen und Nummern (::marker ist kein Text)
  for (const li of Array.from(root.querySelectorAll("li"))) {
    const list = li.parentElement;
    if (!list || list.closest("[data-type=taskList]")) continue;
    const first = li.firstElementChild ?? li;
    range.selectNodeContents(first);
    const r = Array.from(range.getClientRects()).find((q) => q.width > 0) ?? li.getBoundingClientRect();
    const idx = Array.from(list.children).indexOf(li);
    const start = Number(list.getAttribute("start") ?? 1) || 1;
    const marker = list.tagName === "OL" ? `${start + idx}.` : "•";
    const p = place(r);
    const st = styleOf(first, root);
    runs.push({ text: marker, page: p.page, row: p.row, x: p.x - (list.tagName === "OL" ? 6 : 4), w: 3, ...st, bold: false, italic: false, underline: false, strike: false, highlight: null });
  }
  return runs.filter((r) => r.row >= 0 && r.row < BOGEN.rows && r.page >= 0);
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  sans: PDFFont;
}

const mmY = (page: PDFPage, mm: number) => page.getHeight() - mm * PT_PER_MM;
const pt = (mm: number) => mm * PT_PER_MM;
const INK = rgb(0.13, 0.13, 0.13);
const RULE = rgb(0.55, 0.58, 0.61);

/** Leerer Bogen: Kopffelder, Rahmen, Linien, Trennlinie, „Bogen Nr.“ */
export function drawSheet(page: PDFPage, f: Fonts, head: KlausurHead, nr: number) {
  const b = BOGEN;
  page.drawLine({ start: { x: pt(b.head.left), y: mmY(page, b.head.topRule) }, end: { x: pt(b.head.right), y: mmY(page, b.head.topRule) }, thickness: 0.6, color: INK });
  const values = [head.fach, head.name, head.datum];
  b.head.lines.forEach((y, k) => {
    page.drawLine({ start: { x: pt(b.head.left), y: mmY(page, y) }, end: { x: pt(b.head.right), y: mmY(page, y) }, thickness: 0.6, color: INK });
    const label = HEAD_LABELS[k]!;
    page.drawText(label, { x: pt(b.head.left), y: mmY(page, y) + 2, size: 7, font: f.sans, color: INK });
    const v = pdfSafe(values[k] ?? "", f.regular);
    if (v) {
      const x0 = pt(b.head.left) + f.sans.widthOfTextAtSize(label, 7) + 5;
      const room = pt(b.head.right) - x0 - 2;
      let size = 12;
      while (size > 7 && f.regular.widthOfTextAtSize(v, size) > room) size -= 0.5;
      page.drawText(v, { x: x0, y: mmY(page, baselineMm(y - b.pitch, b.pitch, size)), size, font: f.regular, color: INK });
    }
  });
  // Rahmen und Linien
  const { left, top, right, bottom } = b.box;
  page.drawRectangle({ x: pt(left), y: mmY(page, bottom), width: pt(right - left), height: pt(bottom - top), borderColor: INK, borderWidth: 0.8 });
  for (let i = 1; i < b.rows; i++) {
    const y = top + i * b.pitch;
    page.drawLine({ start: { x: pt(left), y: mmY(page, y) }, end: { x: pt(b.divider), y: mmY(page, y) }, thickness: 0.5, color: RULE });
  }
  page.drawLine({ start: { x: pt(b.divider), y: mmY(page, top) }, end: { x: pt(b.divider), y: mmY(page, bottom) }, thickness: 0.8, color: INK });
  // Bogen Nr.
  const fy = b.foot.y;
  page.drawText("Bogen Nr.", { x: pt(b.foot.left), y: mmY(page, fy) + 2, size: 8, font: f.sans, color: INK });
  const lx = pt(b.foot.left) + f.sans.widthOfTextAtSize("Bogen Nr.", 8) + 4;
  page.drawLine({ start: { x: lx, y: mmY(page, fy) }, end: { x: pt(b.foot.right), y: mmY(page, fy) }, thickness: 0.6, color: INK });
  const num = String(nr);
  page.drawText(num, { x: (lx + pt(b.foot.right)) / 2 - f.regular.widthOfTextAtSize(num, 12) / 2, y: mmY(page, fy) + 2.5, size: 12, font: f.regular, color: INK });
}

export async function buildKlausurPdf(runs: Run[], head: KlausurHead, opts: { title: string; pages: number }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(opts.title);
  pdf.setCreator("Studium OS");
  pdf.setProducer("Studium OS");
  const f: Fonts = {
    regular: await pdf.embedFont(StandardFonts.TimesRoman),
    bold: await pdf.embedFont(StandardFonts.TimesRomanBold),
    italic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
    boldItalic: await pdf.embedFont(StandardFonts.TimesRomanBoldItalic),
    sans: await pdf.embedFont(StandardFonts.Helvetica),
  };
  const count = Math.max(1, opts.pages, ...runs.map((r) => r.page + 1));
  const pages = Array.from({ length: count }, (_, i) => {
    const p = pdf.addPage([pt(BOGEN.width), pt(BOGEN.height)]);
    drawSheet(p, f, head, i + 1);
    return p;
  });
  for (const r of runs) {
    const page = pages[r.page]!;
    const font = r.bold && r.italic ? f.boldItalic : r.bold ? f.bold : r.italic ? f.italic : f.regular;
    const text = pdfSafe(r.text, font);
    const rowTop = BOGEN.box.top + r.row * BOGEN.pitch;
    const base = mmY(page, baselineMm(rowTop, BOGEN.pitch, r.sizePt));
    const x = pt(r.x);
    const w = Math.max(pt(r.w), font.widthOfTextAtSize(text, r.sizePt));
    if (r.highlight) page.drawRectangle({ x: x - 0.5, y: base - r.sizePt * 0.25, width: w + 1, height: r.sizePt * 1.15, color: rgb(...r.highlight) });
    const color = r.color ? rgb(...r.color) : rgb(0, 0, 0);
    page.drawText(text, { x, y: base, size: r.sizePt, font, color });
    if (r.underline) page.drawLine({ start: { x, y: base - 1.4 }, end: { x: x + w, y: base - 1.4 }, thickness: 0.6, color });
    if (r.strike) page.drawLine({ start: { x, y: base + r.sizePt * 0.3 }, end: { x: x + w, y: base + r.sizePt * 0.3 }, thickness: 0.6, color });
  }
  return pdf.save();
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Klausur";

/** Seitenansicht → PDF → Teilen-Menü bzw. Speichern-Dialog */
export async function exportKlausurPdf(root: HTMLElement, opts: { title: string; head: KlausurHead }) {
  const st = useApp.getState();
  try {
    const gap = 28;
    const pages = Number(root.getAttribute("data-pages") ?? 1) || 1;
    const bytes = await buildKlausurPdf(collectRuns(root, gap), opts.head, { title: opts.title, pages });
    const path = await api.pickSavePath(`${safeName(opts.title)}.pdf`, "pdf");
    if (!path) return;
    await api.exportWrite(path, bytes);
    st.toast(`PDF gespeichert: ${path.replace(/^download:/, "").split(/[\\/]/).pop()}`, "success");
  } catch (e) {
    st.toast(`PDF konnte nicht erstellt werden: ${errorMessage(e)}`, "error");
  }
}
