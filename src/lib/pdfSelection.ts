/**
 * Wandelt Bildschirm-Rechtecke einer Textauswahl in Rechtecke relativ zur
 * PDF-Seite (0..1) um und fasst Stücke derselben Zeile zusammen.
 */
import type { Rect } from "../api/types";

export interface BoxLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function toPageRects(rects: BoxLike[], page: BoxLike): Rect[] {
  const out: Rect[] = [];
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const items = rects
    .filter((r) => r.width > 0.5 && r.height > 0.5)
    // nur Teile innerhalb der Seite
    .filter((r) => r.left < page.left + page.width && r.left + r.width > page.left && r.top < page.top + page.height && r.top + r.height > page.top)
    .map((r) => {
      const x1 = clamp((r.left - page.left) / page.width);
      const y1 = clamp((r.top - page.top) / page.height);
      const x2 = clamp((r.left + r.width - page.left) / page.width);
      const y2 = clamp((r.top + r.height - page.top) / page.height);
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
  for (const r of items) {
    const last = out[out.length - 1];
    const sameLine = last && Math.abs(last.y - r.y) < r.h * 0.5 && Math.abs(last.h - r.h) < r.h * 0.6;
    if (last && sameLine && r.x <= last.x + last.w + 0.02) {
      const x2 = Math.max(last.x + last.w, r.x + r.w);
      const y1 = Math.min(last.y, r.y);
      const y2 = Math.max(last.y + last.h, r.y + r.h);
      last.x = Math.min(last.x, r.x);
      last.w = x2 - last.x;
      last.y = y1;
      last.h = y2 - y1;
    } else if (!out.some((o) => Math.abs(o.x - r.x) < 1e-4 && Math.abs(o.y - r.y) < 1e-4 && Math.abs(o.w - r.w) < 1e-4)) {
      out.push({ ...r });
    }
  }
  return out.map((r) => ({ x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) }));
}

const round = (v: number) => Math.round(v * 10000) / 10000;

export const HIGHLIGHT_COLORS: Record<string, string> = {
  gelb: "#f6dd4b",
  gruen: "#8fdc8f",
  blau: "#8fc1ff",
  rot: "#ff9a9a",
  lila: "#cfa8ff",
};
