/**
 * Folien-Lupe: Ist sie an der Folie eingeschaltet (Lupen-Symbol), zeigt der
 * Bereich der Werkzeugleiste in der Mitschrift eine vergrößerte, rechteckige
 * Ansicht der Stelle, über die der Mauszeiger bzw. Stift fährt (mit dem
 * Finger: antippen). Ohne geöffnete Mitschrift erscheint die Lupe über der Folie.
 */
import { create } from "zustand";

export interface LensTarget {
  /** Bildquelle in hoher Auflösung (gerenderte PDF-Seite oder Bild) */
  source: CanvasImageSource;
  srcW: number;
  srcH: number;
  /** Mittelpunkt relativ zur Folie (0–1) */
  x: number;
  y: number;
  /** Breite der Folie auf dem Bildschirm (CSS-Pixel) – Bezug für die Vergrößerung */
  shownW: number;
  label: string;
}

interface LensState {
  active: boolean;
  target: LensTarget | null;
  /** Vergrößerung gegenüber der angezeigten Folie */
  zoom: number;
  /** Anzahl der Mitschriften, die die Lupe anzeigen können */
  hosts: number;
  /** Größe der Lupe (CSS-Pixel) – für den Rahmen auf der Folie */
  size: { w: number; h: number };
  setSize(s: { w: number; h: number }): void;
  setActive(v: boolean): void;
  setTarget(t: LensTarget | null): void;
  setZoom(z: number): void;
  addHost(): () => void;
}

export const LENS_ZOOMS = [1.5, 2, 2.5, 3, 4] as const;

export const useSlideLens = create<LensState>((set, get) => ({
  active: false,
  target: null,
  zoom: 2.5,
  hosts: 0,
  size: { w: 600, h: 220 },
  setSize: (size) => set({ size }),
  setActive: (active) => set({ active, ...(active ? {} : { target: null }) }),
  setTarget: (target) => set({ target }),
  setZoom: (zoom) => set({ zoom }),
  addHost() {
    set({ hosts: get().hosts + 1 });
    return () => set({ hosts: Math.max(0, get().hosts - 1) });
  },
}));

/** Mittelpunkt (0–1) eines Zeigers auf einem Element. */
export function relPoint(el: HTMLElement, clientX: number, clientY: number) {
  const r = el.getBoundingClientRect();
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x: clamp((clientX - r.left) / r.width), y: clamp((clientY - r.top) / r.height), rect: r };
}

/** Rahmen auf der Folie, der den Ausschnitt der Lupe zeigt (relativ zum Element, CSS-Pixel). */
export function lensFrame(rect: DOMRect, x: number, y: number) {
  const { size, zoom } = useSlideLens.getState();
  const w = Math.min(rect.width, size.w / zoom);
  const h = Math.min(rect.height, size.h / zoom);
  return { left: Math.min(Math.max(0, x * rect.width - w / 2), rect.width - w), top: Math.min(Math.max(0, y * rect.height - h / 2), rect.height - h), width: w, height: h };
}

/** Ausschnitt der Quelle (in Quellpixeln) für eine Lupe der Größe w × h. */
export function lensRegion(t: LensTarget, w: number, h: number, zoom: number) {
  // Bildschirm-Pixel der Folie → Quellpixel
  const perCss = t.srcW / t.shownW;
  const sw = Math.min(t.srcW, (w / zoom) * perCss);
  const sh = Math.min(t.srcH, (h / zoom) * perCss);
  const sx = Math.min(Math.max(0, t.x * t.srcW - sw / 2), t.srcW - sw);
  const sy = Math.min(Math.max(0, t.y * t.srcH - sh / 2), t.srcH - sh);
  return { sx, sy, sw, sh };
}

/** Zeichnet den Ausschnitt in die Lupe (Rest bleibt Hintergrund). */
export function drawLens(canvas: HTMLCanvasElement, t: LensTarget, zoom: number, background: string) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
  if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, w, h);
  const r = lensRegion(t, w, h, zoom);
  // Quellpixel → Lupenpixel; ist die Folie in einer Richtung kleiner als die Lupe, steht sie mittig
  const scale = zoom * (t.shownW / t.srcW);
  const dw = r.sw * scale;
  const dh = r.sh * scale;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(t.source, r.sx, r.sy, r.sw, r.sh, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
