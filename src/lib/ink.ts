/**
 * Handschrift auf PDF-Seiten (Apple Pencil). Striche werden wie bei Zeichnungen
 * in der Notiz als Vektordaten gespeichert (`lib/drawing.ts`), aber relativ zur
 * Seite: Breite INK_WIDTH entspricht der Seitenbreite, unabhängig vom Zoom.
 */
import type { PdfDoc } from "./pdf";
import { decodeDrawing, drawStroke, encodeDrawing, type Stroke } from "./drawing";

export const INK_WIDTH = 2000;
export const INK_PEN_COLORS = ["#1d2433", "#2f5fb3", "#c0392b", "#2e7d5b"];
export const INK_MARKER_COLORS = ["#ffe066", "#8ce99a", "#74c0fc", "#ffa8d2"];
/** Strichstärken (fein, mittel, dick) in Seiteneinheiten */
export const INK_SIZES: Record<"pen" | "marker", readonly number[]> = { pen: [3, 5, 8], marker: [5, 7, 10] };

/** `ratio` = Seitenhöhe / Seitenbreite */
export function encodeInk(strokes: Stroke[], ratio: number): string {
  if (!strokes.length) return "";
  return encodeDrawing({ v: 1, width: INK_WIDTH, height: Math.round(INK_WIDTH * (Number.isFinite(ratio) && ratio > 0 ? ratio : 1.414)), strokes });
}

export function decodeInk(s: string | null | undefined): Stroke[] {
  return decodeDrawing(s)?.strokes ?? [];
}

/** Striche auf eine Zeichenfläche der Breite `widthPx` (logische Pixel) zeichnen. */
export function drawInk(ctx: CanvasRenderingContext2D, strokes: Stroke[], widthPx: number) {
  const k = widthPx / INK_WIDTH;
  ctx.save();
  ctx.scale(k, k);
  for (const s of strokes) drawStroke(ctx, s);
  ctx.restore();
}

/** Seite samt Handschrift als PNG, z. B. um eine Folie in die Mitschrift zu übernehmen. */
export async function renderPageImage(pdf: PdfDoc, n: number, strokes: Stroke[], widthPx = 1400): Promise<{ png: Blob; width: number; height: number }> {
  const page = await pdf.getPage(n);
  const vp0 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: widthPx / vp0.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport: vp }).promise;
  drawInk(ctx, strokes, canvas.width);
  const png = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Bild konnte nicht erzeugt werden."))), "image/png"));
  // Speicher sofort freigeben (iPad)
  canvas.width = canvas.height = 0;
  return { png, width: Math.round(vp0.width), height: Math.round(vp0.height) };
}
