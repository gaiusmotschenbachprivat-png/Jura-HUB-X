import { Eraser, Highlighter, PenLine, Plus, Redo2, Trash2, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { bounds, CANVAS_WIDTH, drawStroke, hitStroke, MARKER_COLORS, PEN_COLORS, type Drawing, type Stroke, type Tool } from "../../lib/drawing";
import { Button, IconButton } from "../../ui/Button";

type Mode = Tool | "eraser";

export interface DrawingResult {
  png: Blob;
  drawing: Drawing;
  /** Anzeigebreite in der Notiz (logische Pixel). */
  width: number;
}

/**
 * Zeichenfläche für Apple Pencil (oder Finger/Maus). Sobald ein Stift erkannt
 * wird, zeichnet nur noch der Stift – die aufgelegte Hand malt nicht mit.
 */
export function DrawingDialog({ initial, onSave, onDelete, onClose }: { initial: Drawing | null; onSave: (r: DrawingResult) => void; onDelete?: () => void; onClose: () => void }) {
  const [strokes, setStrokes] = useState<Stroke[]>(initial?.strokes ?? []);
  const [height, setHeight] = useState(initial?.height ?? 640);
  const [mode, setMode] = useState<Mode>("pen");
  const [penColor, setPenColor] = useState(PEN_COLORS[0]!);
  const [markerColor, setMarkerColor] = useState(MARKER_COLORS[0]!);
  const [size, setSize] = useState(3);
  const [penSeen, setPenSeen] = useState(false);
  const [undo, setUndo] = useState<Stroke[][]>([]);
  const [redo, setRedo] = useState<Stroke[][]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const current = useRef<Stroke | null>(null);
  const activePointer = useRef<number | null>(null);

  // Größe an den verfügbaren Platz anpassen
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1.4, (el.clientWidth - 2) / CANVAS_WIDTH)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const redraw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(CANVAS_WIDTH * scale * dpr);
    c.height = Math.round(height * scale * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    ctx.clearRect(0, 0, CANVAS_WIDTH, height);
    for (const s of strokes) drawStroke(ctx, s);
    if (current.current) drawStroke(ctx, current.current);
  }, [strokes, height, scale]);
  useEffect(redraw, [redraw]);

  const commit = (next: Stroke[]) => {
    setUndo((u) => [...u.slice(-50), strokes]);
    setRedo([]);
    setStrokes(next);
  };

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const p = e.pointerType === "pen" ? (e.pressure || 0.5) : e.pointerType === "mouse" ? 0.5 : 0.45;
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale, Math.min(1, p)] as [number, number, number];
  };

  const fingerScroll = useRef<{ id: number; y: number; x: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === "pen" && !penSeen) setPenSeen(true);
    // Mit Stift: Finger scrollt (Handballen malt nicht mit)
    if (penSeen && e.pointerType === "touch") {
      fingerScroll.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    if (activePointer.current !== null) return;
    e.preventDefault();
    activePointer.current = e.pointerId;
    try {
      canvas.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ohne Capture weiterzeichnen */
    }
    const p = pos(e);
    if (mode === "eraser") {
      erase(p[0], p[1], true);
      return;
    }
    current.current = { tool: mode, color: mode === "marker" ? markerColor : penColor, size, points: [p] };
    redraw();
  };
  const eraseStart = useRef<Stroke[] | null>(null);
  const erase = (x: number, y: number, first = false) => {
    if (first) eraseStart.current = strokes;
    setStrokes((list) => list.filter((s) => !hitStroke(s, x, y, 10 / scale)));
  };
  const onMove = (e: React.PointerEvent) => {
    const fs = fingerScroll.current;
    if (fs && fs.id === e.pointerId && wrap.current) {
      wrap.current.scrollTop -= e.clientY - fs.y;
      wrap.current.scrollLeft -= e.clientX - fs.x;
      fingerScroll.current = { id: fs.id, x: e.clientX, y: e.clientY };
      return;
    }
    if (e.pointerId !== activePointer.current) return;
    e.preventDefault();
    const events = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
    const list = events.length ? events.map((ev) => ({ ...e, clientX: ev.clientX, clientY: ev.clientY, pressure: ev.pressure, pointerType: e.pointerType }) as React.PointerEvent) : [e];
    for (const ev of list) {
      const p = pos(ev);
      if (mode === "eraser") {
        erase(p[0], p[1]);
        continue;
      }
      const s = current.current;
      if (!s) return;
      const last = s.points[s.points.length - 1]!;
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 1.2) s.points.push(p);
    }
    redraw();
  };
  const onUp = (e: React.PointerEvent) => {
    if (fingerScroll.current?.id === e.pointerId) fingerScroll.current = null;
    if (e.pointerId !== activePointer.current) return;
    activePointer.current = null;
    if (mode === "eraser") {
      if (eraseStart.current && eraseStart.current.length !== strokes.length) {
        setUndo((u) => [...u.slice(-50), eraseStart.current!]);
        setRedo([]);
      }
      eraseStart.current = null;
      return;
    }
    const s = current.current;
    current.current = null;
    if (s) commit([...strokes, s]);
  };

  const save = async () => {
    const b = bounds(strokes);
    if (!b) return onClose();
    const pad = 16;
    const x = Math.max(0, Math.floor(b.x - pad));
    const y = Math.max(0, Math.floor(b.y - pad));
    const w = Math.max(160, Math.min(CANVAS_WIDTH - x, Math.ceil(b.w + 2 * pad)));
    const h = Math.max(60, Math.ceil(b.h + 2 * pad));
    const k = 2; // doppelte Auflösung für scharfe Darstellung
    const off = document.createElement("canvas");
    off.width = w * k;
    off.height = h * k;
    const ctx = off.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, off.width, off.height);
    ctx.setTransform(k, 0, 0, k, -x * k, -y * k);
    for (const s of strokes) drawStroke(ctx, s);
    const png = await new Promise<Blob | null>((r) => off.toBlob(r, "image/png"));
    if (!png) return;
    onSave({ png, width: w, drawing: { v: 1, width: CANVAS_WIDTH, height, strokes } });
  };

  const colors = mode === "marker" ? MARKER_COLORS : PEN_COLORS;
  const color = mode === "marker" ? markerColor : penColor;

  return createPortal(
    <div className="draw-overlay" role="dialog" aria-modal="true" aria-label="Zeichnung">
      <div className="draw-bar">
        <div className="tb-group">
          <IconButton label="Stift" active={mode === "pen"} onClick={() => setMode("pen")}>
            <PenLine size={18} />
          </IconButton>
          <IconButton label="Textmarker" active={mode === "marker"} onClick={() => setMode("marker")}>
            <Highlighter size={18} />
          </IconButton>
          <IconButton label="Radierer" active={mode === "eraser"} onClick={() => setMode("eraser")}>
            <Eraser size={18} />
          </IconButton>
        </div>
        {mode !== "eraser" && (
          <div className="tb-group" role="radiogroup" aria-label="Farbe">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={c === color}
                aria-label={`Farbe ${c}`}
                className={`swatch draw-swatch ${c === color ? "is-active" : ""}`}
                style={{ background: c }}
                onClick={() => (mode === "marker" ? setMarkerColor(c) : setPenColor(c))}
              />
            ))}
            <select aria-label="Strichstärke" value={size} onChange={(e) => setSize(Number(e.target.value))}>
              <option value={2}>fein</option>
              <option value={3}>mittel</option>
              <option value={5}>kräftig</option>
              <option value={8}>dick</option>
            </select>
          </div>
        )}
        <div className="tb-group">
          <IconButton
            label="Rückgängig"
            disabled={!undo.length}
            onClick={() => {
              setRedo((r) => [...r, strokes]);
              setStrokes(undo[undo.length - 1]!);
              setUndo((u) => u.slice(0, -1));
            }}
          >
            <Undo2 size={18} />
          </IconButton>
          <IconButton
            label="Wiederholen"
            disabled={!redo.length}
            onClick={() => {
              setUndo((u) => [...u, strokes]);
              setStrokes(redo[redo.length - 1]!);
              setRedo((r) => r.slice(0, -1));
            }}
          >
            <Redo2 size={18} />
          </IconButton>
          <IconButton label="Alles löschen" disabled={!strokes.length} onClick={() => commit([])}>
            <Trash2 size={18} />
          </IconButton>
          <IconButton label="Mehr Platz nach unten" onClick={() => setHeight((h) => Math.min(4000, h + 400))}>
            <Plus size={18} />
          </IconButton>
        </div>
        <span className="grow small muted">{penSeen ? "Apple Pencil erkannt – die Hand kann aufliegen." : "Mit Apple Pencil, Finger oder Maus zeichnen."}</span>
        {onDelete && (
          <Button variant="ghost" onClick={onDelete}>
            Zeichnung entfernen
          </Button>
        )}
        <Button onClick={onClose} icon={<X size={15} />}>
          Abbrechen
        </Button>
        <Button variant="primary" onClick={() => void save()} disabled={!strokes.length}>
          Fertig
        </Button>
      </div>
      <div className="draw-scroll" ref={wrap}>
        <canvas
          ref={canvas}
          className={`draw-canvas mode-${mode}`}
          style={{ width: CANVAS_WIDTH * scale, height: height * scale }}
          aria-label="Zeichenfläche"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
      </div>
    </div>,
    document.body,
  );
}
