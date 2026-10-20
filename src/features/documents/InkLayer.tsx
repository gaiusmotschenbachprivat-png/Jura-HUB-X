/**
 * Handschrift-Ebene über einer PDF-Seite. Zeichnet mit Apple Pencil (oder Maus);
 * Finger scrollen weiter ganz normal durch das Dokument, die aufgelegte Hand
 * malt also nicht mit. Ohne Stift lässt sich „Finger zeichnen“ einschalten.
 */
import { useEffect, useLayoutEffect, useRef } from "react";

import { hitStroke, type Stroke } from "../../lib/drawing";
import { drawInk, INK_WIDTH } from "../../lib/ink";

export type InkTool = "pen" | "marker" | "eraser";

export interface InkSettings {
  tool: InkTool;
  color: string;
  size: number;
  /** Finger zeichnen ebenfalls (für die Arbeit ohne Stift) */
  finger: boolean;
}

export function InkLayer({
  width,
  height,
  strokes,
  active,
  settings,
  onCommit,
}: {
  width: number;
  height: number;
  strokes: Stroke[];
  active: boolean;
  settings: InkSettings;
  onCommit: (next: Stroke[]) => void;
}) {
  const base = useRef<HTMLCanvasElement>(null);
  const live = useRef<HTMLCanvasElement>(null);
  const current = useRef<Stroke | null>(null);
  const erasing = useRef<Stroke[] | null>(null);
  const pointer = useRef<number | null>(null);
  const k = width / INK_WIDTH;

  const paint = (c: HTMLCanvasElement | null, list: Stroke[]) => {
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawInk(ctx, list, width);
  };

  useLayoutEffect(() => paint(base.current, erasing.current ?? strokes), [strokes, width, height]);

  // Stift darf nicht scrollen; Finger schon (natives Scrollen mit Schwung)
  useEffect(() => {
    const el = live.current;
    if (!el || !active) return;
    const block = (e: TouchEvent) => {
      const stylus = [...e.changedTouches].some((t) => (t as Touch & { touchType?: string }).touchType === "stylus");
      if (stylus || settings.finger) e.preventDefault();
    };
    el.addEventListener("touchstart", block, { passive: false });
    el.addEventListener("touchmove", block, { passive: false });
    return () => {
      el.removeEventListener("touchstart", block);
      el.removeEventListener("touchmove", block);
    };
  }, [active, settings.finger]);

  const point = (e: { clientX: number; clientY: number; pressure: number; pointerType: string }): [number, number, number] => {
    const r = live.current!.getBoundingClientRect();
    const p = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
    return [(e.clientX - r.left) / k, (e.clientY - r.top) / k, Math.min(1, p)];
  };

  const erase = (x: number, y: number) => {
    const list = erasing.current ?? strokes;
    const next = list.filter((s) => !hitStroke(s, x, y, 12 / k));
    if (next.length !== list.length) {
      erasing.current = next;
      paint(base.current, next);
    }
  };

  const onDown = (e: React.PointerEvent) => {
    if (!active) return;
    if (e.pointerType === "touch" && !settings.finger) return;
    if (pointer.current !== null) return;
    e.preventDefault();
    e.stopPropagation();
    pointer.current = e.pointerId;
    try {
      live.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ohne Capture weiterzeichnen */
    }
    const p = point(e);
    if (settings.tool === "eraser") {
      erasing.current = strokes;
      erase(p[0], p[1]);
      return;
    }
    current.current = { tool: settings.tool, color: settings.color, size: settings.size, points: [p] };
    paint(live.current, [current.current]);
  };

  const onMove = (e: React.PointerEvent) => {
    if (e.pointerId !== pointer.current) return;
    e.preventDefault();
    const native = e.nativeEvent;
    const events = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [native]) {
      const p = point({ clientX: ev.clientX, clientY: ev.clientY, pressure: ev.pressure, pointerType: e.pointerType });
      if (settings.tool === "eraser") {
        erase(p[0], p[1]);
        continue;
      }
      const s = current.current;
      if (!s) return;
      const last = s.points[s.points.length - 1]!;
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 1.5) s.points.push(p);
    }
    if (current.current) paint(live.current, [current.current]);
  };

  const onUp = (e: React.PointerEvent) => {
    if (e.pointerId !== pointer.current) return;
    pointer.current = null;
    if (settings.tool === "eraser") {
      const next = erasing.current;
      erasing.current = null;
      if (next && next.length !== strokes.length) onCommit(next);
      return;
    }
    const s = current.current;
    current.current = null;
    paint(live.current, []);
    if (s) onCommit([...strokes, s]);
  };

  return (
    <>
      <canvas ref={base} className="ink-canvas" style={{ width, height }} aria-hidden />
      <canvas
        ref={live}
        className={`ink-canvas ink-live ${active ? "is-active" : ""} ${active && settings.finger ? "is-finger" : ""} ${active && settings.tool === "eraser" ? "is-eraser" : ""}`}
        style={{ width, height }}
        data-ink-page
        aria-label={active ? "Handschrift-Fläche" : undefined}
        aria-hidden={!active}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
    </>
  );
}
