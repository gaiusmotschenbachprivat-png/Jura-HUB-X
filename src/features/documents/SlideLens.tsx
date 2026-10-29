/** Anzeige der Folien-Lupe (siehe lensState.ts). */
import { Minus, Plus, ScanSearch, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { IconButton } from "../../ui/Button";
import { drawLens, LENS_ZOOMS, lensFrame, relPoint, useSlideLens } from "./lensState";

export function SlideLensView({ className = "", onClose }: { className?: string; onClose?: () => void }) {
  const target = useSlideLens((s) => s.target);
  const zoom = useSlideLens((s) => s.zoom);
  const setZoom = useSlideLens((s) => s.setZoom);
  const setActive = useSlideLens((s) => s.setActive);
  const canvas = useRef<HTMLCanvasElement>(null);

  const draw = () => {
    const c = canvas.current;
    if (c && target) drawLens(c, target, zoom, getComputedStyle(c).getPropertyValue("--lens-bg").trim() || "#fff");
  };
  useLayoutEffect(draw);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ro = new ResizeObserver(() => {
      useSlideLens.getState().setSize({ w: c.clientWidth, h: c.clientHeight });
      draw();
    });
    ro.observe(c);
    return () => ro.disconnect();
  });

  const i = LENS_ZOOMS.indexOf(zoom as (typeof LENS_ZOOMS)[number]);
  return (
    <div className={`slide-lens ${className}`} role="region" aria-label="Folien-Lupe">
      <div className="slide-lens-bar">
        <ScanSearch size={14} />
        <span className="small grow">{target ? `Lupe · ${target.label}` : "Lupe – mit dem Zeiger über die Folie fahren oder auf eine Stelle tippen"}</span>
        <IconButton label="Weniger vergrößern" disabled={i <= 0} onClick={() => setZoom(LENS_ZOOMS[Math.max(0, i - 1)]!)}>
          <Minus size={14} />
        </IconButton>
        <span className="xs tnum">{zoom.toLocaleString("de-DE")}×</span>
        <IconButton label="Stärker vergrößern" disabled={i >= LENS_ZOOMS.length - 1} onClick={() => setZoom(LENS_ZOOMS[Math.min(LENS_ZOOMS.length - 1, i + 1)]!)}>
          <Plus size={14} />
        </IconButton>
        <IconButton label="Lupe ausschalten" onClick={() => (setActive(false), onClose?.())}>
          <X size={14} />
        </IconButton>
      </div>
      <canvas ref={canvas} className="slide-lens-canvas" aria-hidden />
    </div>
  );
}

/** Bild als Folie mit Lupe (Ein/Aus über `LensToggle`). */
export function LensImage({ src, alt, label }: { src: string; alt: string; label: string }) {
  const lensOn = useSlideLens((s) => s.active);
  const hosts = useSlideLens((s) => s.hosts);
  const img = useRef<HTMLImageElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => () => useSlideLens.getState().setActive(false), []);
  useEffect(() => {
    if (!lensOn) setBox(null);
  }, [lensOn]);
  const onPointer = (e: React.PointerEvent) => {
    const el = img.current;
    if (!el || !el.naturalWidth || (e.type === "pointermove" && e.pointerType === "touch")) return;
    const { x, y, rect } = relPoint(el, e.clientX, e.clientY);
    useSlideLens.getState().setTarget({ source: el, srcW: el.naturalWidth, srcH: el.naturalHeight, x, y, shownW: rect.width, label });
    const f = lensFrame(rect, x, y);
    setBox({ ...f, left: f.left + el.offsetLeft, top: f.top + el.offsetTop });
  };
  return (
    <>
      <div className={`img-view ${lensOn ? "is-lens" : ""}`} onPointerMove={lensOn ? onPointer : undefined} onPointerDown={lensOn ? onPointer : undefined}>
        <img ref={img} src={src} alt={alt} />
        {lensOn && box && <div className="lens-frame" style={box} aria-hidden />}
      </div>
      {lensOn && hosts === 0 && <SlideLensView className="is-floating" />}
    </>
  );
}

/** Lupen-Symbol für Folienleisten. */
export function LensToggle() {
  const on = useSlideLens((s) => s.active);
  return (
    <IconButton label={on ? "Lupe ausschalten" : "Lupe: vergrößerte Ansicht in der Mitschrift"} active={on} onClick={() => useSlideLens.getState().setActive(!on)}>
      <ScanSearch size={16} />
    </IconButton>
  );
}
