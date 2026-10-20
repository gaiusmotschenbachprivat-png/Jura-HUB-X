/**
 * PDF-Ansicht mit pdf.js: Seiten werden erst gerendert, wenn sie sichtbar
 * werden (auch bei Skripten mit Hunderten Seiten flüssig). Mit Textebene zum
 * Markieren und Kopieren, Seitenübersicht, Zoom und Textsuche. Im Stiftmodus
 * lässt sich mit dem Apple Pencil direkt auf die Seiten schreiben.
 */
import "../../styles/pdf-textlayer.css";

import { Bookmark, Check, ChevronLeft, ChevronRight, Eraser, Hand, Highlighter, PanelLeft, PenLine, Redo2, Search, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { Annotation, Rect } from "../../api/types";
import type { Stroke } from "../../lib/drawing";
import { INK_MARKER_COLORS, INK_PEN_COLORS, INK_SIZES } from "../../lib/ink";
import { closePdf, loadPdf, type PdfDoc } from "../../lib/pdf";
import { HIGHLIGHT_COLORS, toPageRects } from "../../lib/pdfSelection";
import { IconButton } from "../../ui/Button";
import { InkLayer, type InkSettings, type InkTool } from "./InkLayer";

const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

export interface PdfSelection {
  page: number;
  rects: Rect[];
  quote: string;
  /** Bildschirmposition für die Auswahl-Werkzeugleiste */
  x: number;
  y: number;
}

export function PdfViewer({
  bytes,
  page,
  onPageChange,
  pageTexts,
  toolbarExtra,
  annotations = [],
  onTextSelected,
  onAnnotationClick,
  onToggleBookmark,
  inks,
  onInkChange,
  onDocument,
}: {
  bytes: Uint8Array;
  page: number;
  onPageChange: (p: number) => void;
  /** Bereits extrahierter Text je Seite (für die Suche) */
  pageTexts?: string[];
  toolbarExtra?: React.ReactNode;
  annotations?: Annotation[];
  onTextSelected?: (s: PdfSelection | null) => void;
  onAnnotationClick?: (a: Annotation, x: number, y: number) => void;
  onToggleBookmark?: (page: number) => void;
  /** Handschrift je Seite; ohne `onInkChange` gibt es keinen Stiftmodus */
  inks?: Map<number, Stroke[]>;
  onInkChange?: (page: number, strokes: Stroke[], ratio: number) => void;
  /** Geladenes PDF (z. B. um eine Seite als Bild zu übernehmen) */
  onDocument?: (pdf: PdfDoc | null) => void;
}) {
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [baseSize, setBaseSize] = useState<{ w: number; h: number } | null>(null);
  const [fit, setFit] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(800);
  const [thumbs, setThumbs] = useState(false);
  const [panelTab, setPanelTab] = useState<"seiten" | "markierungen">("seiten");
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pageInput, setPageInput] = useState(String(page));
  const scroller = useRef<HTMLDivElement>(null);
  const jumpRef = useRef<number | null>(page);
  const currentRef = useRef(page);
  const [inkOn, setInkOn] = useState(false);
  const [tool, setTool] = useState<InkTool>("pen");
  const [penColor, setPenColor] = useState(INK_PEN_COLORS[0]!);
  const [markerColor, setMarkerColor] = useState(INK_MARKER_COLORS[0]!);
  const [sizeIdx, setSizeIdx] = useState(1);
  const [finger, setFinger] = useState(false);
  const [undo, setUndo] = useState<{ page: number; strokes: Stroke[]; ratio: number }[]>([]);
  const [redo, setRedo] = useState<{ page: number; strokes: Stroke[]; ratio: number }[]>([]);
  const inkSettings: InkSettings = {
    tool,
    color: tool === "marker" ? markerColor : penColor,
    size: INK_SIZES[tool === "marker" ? "marker" : "pen"][sizeIdx]!,
    finger,
  };
  const commitInk = (p: number, next: Stroke[], ratio: number) => {
    if (!onInkChange) return;
    setUndo((u) => [...u.slice(-80), { page: p, strokes: inks?.get(p) ?? [], ratio }]);
    setRedo([]);
    onInkChange(p, next, ratio);
  };
  const stepHistory = (from: "undo" | "redo") => {
    const stack = from === "undo" ? undo : redo;
    const last = stack[stack.length - 1];
    if (!last || !onInkChange) return;
    const back = { page: last.page, strokes: inks?.get(last.page) ?? [], ratio: last.ratio };
    if (from === "undo") {
      setUndo(stack.slice(0, -1));
      setRedo((r) => [...r, back]);
    } else {
      setRedo(stack.slice(0, -1));
      setUndo((u) => [...u, back]);
    }
    onInkChange(last.page, last.strokes, last.ratio);
    if (last.page !== currentRef.current) scrollToPage(last.page);
  };

  useEffect(() => {
    let doc: PdfDoc | null = null;
    let alive = true;
    setPdf(null);
    setError(null);
    loadPdf(bytes)
      .then(async (d) => {
        if (!alive) return void closePdf(d);
        doc = d;
        const p1 = await d.getPage(1);
        const vp = p1.getViewport({ scale: 1 });
        setBaseSize({ w: vp.width, h: vp.height });
        setPdf(d);
        onDocument?.(d);
      })
      .catch(() => alive && setError("Die PDF-Datei konnte nicht geöffnet werden. Sie ist eventuell beschädigt oder passwortgeschützt."));
    return () => {
      alive = false;
      onDocument?.(null);
      void closePdf(doc);
    };
    // onDocument absichtlich nicht als Abhängigkeit (nur beim Laden)
  }, [bytes]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [pdf]);

  const scale = useMemo(() => {
    if (!baseSize) return 1;
    if (fit) return Math.max(0.3, (width - 40) / baseSize.w);
    return zoom;
  }, [fit, zoom, width, baseSize]);

  // Zu einer Seite springen, wenn sich die Vorgabe von außen ändert
  useEffect(() => {
    if (page !== currentRef.current) {
      jumpRef.current = page;
      scrollToPage(page);
    }
    setPageInput(String(page));
  }, [page]);

  const scrollToPage = (p: number) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${p}"]`);
    if (el) {
      scroller.current!.scrollTo({ top: el.offsetTop - 12 });
      currentRef.current = p;
    }
  };

  // Nach dem Laden zur Startseite springen
  useEffect(() => {
    if (pdf && jumpRef.current && jumpRef.current > 1) {
      requestAnimationFrame(() => scrollToPage(jumpRef.current!));
    }
  }, [pdf, scale]);

  // Aktuelle Seite beim Scrollen bestimmen
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight * 0.35;
    const pages = el.querySelectorAll<HTMLElement>("[data-page]");
    let cur = 1;
    for (const p of pages) {
      if (p.offsetTop <= mid) cur = Number(p.dataset.page);
      else break;
    }
    if (cur !== currentRef.current) {
      currentRef.current = cur;
      setPageInput(String(cur));
      onPageChange(cur);
    }
  };

  const go = (p: number) => {
    if (!pdf) return;
    const target = Math.min(pdf.numPages, Math.max(1, p));
    scrollToPage(target);
    setPageInput(String(target));
    onPageChange(target);
  };

  const onMouseUp = (ev: React.MouseEvent) => {
    if (!onTextSelected || inkOn) return;
    const cx = ev.clientX;
    const cy = ev.clientY;
    // Auswahl erst nach dem Loslassen auswerten
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        // Einfacher Klick: liegt er auf einer Markierung?
        const pageEl = document.elementFromPoint(cx, cy)?.closest<HTMLElement>("[data-page]");
        if (pageEl && onAnnotationClick) {
          const b = pageEl.getBoundingClientRect();
          const px = (cx - b.left) / b.width;
          const py = (cy - b.top) / b.height;
          const hit = byPage.get(Number(pageEl.dataset.page))?.find((a) => a.rects.some((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h));
          if (hit) {
            onTextSelected(null);
            return onAnnotationClick(hit, cx, cy);
          }
        }
        return onTextSelected(null);
      }
      const range = sel.getRangeAt(0);
      const startEl = (range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement)?.closest<HTMLElement>("[data-page]");
      if (!startEl || !scroller.current?.contains(startEl)) return onTextSelected(null);
      const pageBox = startEl.getBoundingClientRect();
      const rects = toPageRects([...range.getClientRects()], pageBox);
      const quote = sel.toString().replace(/\s+/g, " ").trim();
      if (!rects.length || !quote) return onTextSelected(null);
      const last = range.getBoundingClientRect();
      onTextSelected({ page: Number(startEl.dataset.page), rects, quote, x: last.left + last.width / 2, y: last.bottom });
    }, 0);
  };

  const byPage = useMemo(() => {
    const m = new Map<number, Annotation[]>();
    for (const a of annotations) {
      if (a.kind !== "highlight") continue;
      const l = m.get(a.page) ?? [];
      l.push(a);
      m.set(a.page, l);
    }
    return m;
  }, [annotations]);
  const bookmarked = annotations.some((a) => a.kind === "bookmark" && a.page === Number(pageInput));

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t || !pageTexts) return [];
    const out: { page: number; excerpt: string }[] = [];
    pageTexts.forEach((txt, i) => {
      const k = txt.toLowerCase().indexOf(t);
      if (k >= 0) out.push({ page: i + 1, excerpt: txt.slice(Math.max(0, k - 40), k + t.length + 60).replace(/\s+/g, " ") });
    });
    return out;
  }, [q, pageTexts]);

  const zoomStep = (dir: 1 | -1) => {
    const cur = scale;
    const next = dir > 0 ? ZOOMS.find((z) => z > cur + 0.01) ?? 3 : [...ZOOMS].reverse().find((z) => z < cur - 0.01) ?? 0.5;
    setFit(false);
    setZoom(next);
    jumpRef.current = currentRef.current;
  };

  if (error) return <div className="pdf-error">{error}</div>;

  return (
    <div className="pdf">
      <div className="pdf-toolbar">
        <IconButton label="Seitenübersicht" active={thumbs} onClick={() => setThumbs(!thumbs)}>
          <PanelLeft size={16} />
        </IconButton>
        <IconButton label="Vorherige Seite" onClick={() => go(currentRef.current - 1)}>
          <ChevronLeft size={16} />
        </IconButton>
        <input
          className="pdf-page-input tnum"
          aria-label="Seite"
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && go(Number(pageInput) || 1)}
          onBlur={() => setPageInput(String(currentRef.current))}
        />
        <span className="muted small tnum">/ {pdf?.numPages ?? "–"}</span>
        <IconButton label="Nächste Seite" onClick={() => go(currentRef.current + 1)}>
          <ChevronRight size={16} />
        </IconButton>
        <span className="tb-sep" />
        <IconButton label="Verkleinern" onClick={() => zoomStep(-1)}>
          <ZoomOut size={16} />
        </IconButton>
        <button className={`pdf-zoom tnum ${fit ? "is-active" : ""}`} onClick={() => setFit(!fit)} title="Auf Breite einpassen">
          {Math.round(scale * 100)} %
        </button>
        <IconButton label="Vergrößern" onClick={() => zoomStep(1)}>
          <ZoomIn size={16} />
        </IconButton>
        <span className="tb-sep" />
        <IconButton label="Im Dokument suchen" active={searchOpen} onClick={() => setSearchOpen(!searchOpen)}>
          <Search size={16} />
        </IconButton>
        {onToggleBookmark && (
          <IconButton label={bookmarked ? "Lesezeichen entfernen" : "Lesezeichen für diese Seite"} active={bookmarked} onClick={() => onToggleBookmark(Number(pageInput) || 1)}>
            <Bookmark size={16} fill={bookmarked ? "currentColor" : "none"} />
          </IconButton>
        )}
        {onInkChange && (
          <IconButton label={inkOn ? "Stiftmodus beenden" : "Mit dem Stift schreiben"} active={inkOn} onClick={() => setInkOn(!inkOn)}>
            <PenLine size={16} />
          </IconButton>
        )}
        <span className="grow" />
        {toolbarExtra}
      </div>
      {inkOn && (
        <div className="ink-bar" role="toolbar" aria-label="Stiftwerkzeuge">
          <div className="ink-group">
            <IconButton label="Stift" active={tool === "pen"} onClick={() => setTool("pen")}>
              <PenLine size={16} />
            </IconButton>
            <IconButton label="Textmarker" active={tool === "marker"} onClick={() => setTool("marker")}>
              <Highlighter size={16} />
            </IconButton>
            <IconButton label="Radierer" active={tool === "eraser"} onClick={() => setTool("eraser")}>
              <Eraser size={16} />
            </IconButton>
          </div>
          {tool !== "eraser" && (
            <div className="ink-group">
              {(tool === "marker" ? INK_MARKER_COLORS : INK_PEN_COLORS).map((c) => (
                <button
                  key={c}
                  className={`color-dot ${(tool === "marker" ? markerColor : penColor) === c ? "is-active" : ""}`}
                  style={{ background: c }}
                  aria-label={`Farbe ${c}`}
                  aria-pressed={(tool === "marker" ? markerColor : penColor) === c}
                  onClick={() => (tool === "marker" ? setMarkerColor(c) : setPenColor(c))}
                />
              ))}
              <span className="tb-sep" />
              {["fein", "mittel", "dick"].map((l, i) => (
                <button key={l} className={`ink-size ${sizeIdx === i ? "is-active" : ""}`} aria-label={`Strichstärke ${l}`} aria-pressed={sizeIdx === i} onClick={() => setSizeIdx(i)}>
                  <span style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
                </button>
              ))}
            </div>
          )}
          <div className="ink-group">
            <IconButton label="Rückgängig" disabled={!undo.length} onClick={() => stepHistory("undo")}>
              <Undo2 size={16} />
            </IconButton>
            <IconButton label="Wiederholen" disabled={!redo.length} onClick={() => stepHistory("redo")}>
              <Redo2 size={16} />
            </IconButton>
            <IconButton label={finger ? "Finger zeichnen (an)" : "Finger zeichnen (aus)"} active={finger} onClick={() => setFinger(!finger)}>
              <Hand size={16} />
            </IconButton>
          </div>
          <span className="grow" />
          <span className="xs muted ink-hint">{finger ? "Finger und Stift schreiben – zum Blättern die Leiste links nutzen." : "Stift schreibt, Finger blättert."}</span>
          <button className="btn btn-sm btn-primary" onClick={() => setInkOn(false)}>
            <Check size={14} /> Fertig
          </button>
        </div>
      )}
      {searchOpen && (
        <div className="pdf-search">
          <input autoFocus placeholder={pageTexts ? "Text im Dokument suchen …" : "Text wird noch ausgelesen …"} value={q} onChange={(e) => setQ(e.target.value)} disabled={!pageTexts} />
          {q.trim() && (
            <div className="pdf-search-results">
              {matches.length === 0 ? (
                <div className="muted small">Kein Treffer{pageTexts && pageTexts.every((t) => !t.trim()) ? " – das Dokument enthält keinen auslesbaren Text (z. B. Scan)." : "."}</div>
              ) : (
                matches.slice(0, 100).map((m) => (
                  <button key={m.page} className="pdf-hit" onClick={() => go(m.page)}>
                    <span className="tnum">S. {m.page}</span>
                    <span className="muted ellipsis">{m.excerpt}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
      <div className="pdf-body">
        {thumbs && pdf && (
          <div className="pdf-side">
            <div className="pdf-side-tabs">
              <button className={panelTab === "seiten" ? "is-active" : ""} onClick={() => setPanelTab("seiten")}>
                Seiten
              </button>
              <button className={panelTab === "markierungen" ? "is-active" : ""} onClick={() => setPanelTab("markierungen")}>
                Markierungen{annotations.length ? ` (${annotations.length})` : ""}
              </button>
            </div>
            {panelTab === "seiten" ? (
              <Thumbnails pdf={pdf} current={Number(pageInput)} onPick={go} />
            ) : (
              <div className="pdf-anno-list">
                {annotations.length === 0 && <p className="xs muted">Noch keine Lesezeichen oder Markierungen. Markiere Text im Dokument oder setze ein Lesezeichen.</p>}
                {[...annotations]
                  .sort((a, b) => a.page - b.page || (a.kind === "bookmark" ? -1 : 1))
                  .map((a) => (
                    <button key={a.id} className="pdf-anno-item" onClick={() => go(a.page)}>
                      <span className="xs muted tnum row">
                        {a.kind === "bookmark" ? <Bookmark size={11} /> : a.kind === "ink" ? <PenLine size={11} /> : <span className="anno-dot" style={{ background: HIGHLIGHT_COLORS[a.color] }} />} S. {a.page}
                      </span>
                      <span className="small anno-quote">{a.kind === "bookmark" ? a.comment || "Lesezeichen" : a.kind === "ink" ? "Handschrift" : a.quote}</span>
                      {a.kind === "highlight" && a.comment && <span className="xs muted">{a.comment}</span>}
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}
        <div className={`pdf-scroll ${inkOn ? "is-inking" : ""}`} ref={scroller} onScroll={onScroll} onMouseUp={onMouseUp}>
          {!pdf || !baseSize ? (
            <div className="loading">Lade PDF …</div>
          ) : (
            Array.from({ length: pdf.numPages }, (_, i) => (
              <PdfPage
                key={i + 1}
                pdf={pdf}
                n={i + 1}
                scale={scale}
                base={baseSize}
                root={scroller.current}
                highlights={byPage.get(i + 1)}
                onAnnotationClick={onAnnotationClick}
                ink={inks?.get(i + 1)}
                inkActive={inkOn}
                inkSettings={inkSettings}
                onInk={commitInk}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function useVisible(ref: React.RefObject<HTMLElement | null>, root: HTMLElement | null, margin = "800px") {
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVis(!!e?.isIntersecting), { root, rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, root, margin]);
  return vis;
}

function PdfPage({
  pdf,
  n,
  scale,
  base,
  root,
  highlights,
  onAnnotationClick,
  ink,
  inkActive = false,
  inkSettings,
  onInk,
}: {
  pdf: PdfDoc;
  n: number;
  scale: number;
  base: { w: number; h: number };
  root: HTMLElement | null;
  highlights?: Annotation[];
  onAnnotationClick?: (a: Annotation, x: number, y: number) => void;
  ink?: Stroke[];
  inkActive?: boolean;
  inkSettings?: InkSettings;
  onInk?: (page: number, strokes: Stroke[], ratio: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: base.w * scale, h: base.h * scale });
  const visible = useVisible(ref, root);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: ReturnType<pdfjs.PDFPageProxy["render"]> | null = null;
    let textLayer: pdfjs.TextLayer | null = null;
    (async () => {
      const page = await pdf.getPage(n);
      if (cancelled) return;
      const vp = page.getViewport({ scale });
      setSize({ w: vp.width, h: vp.height });
      const canvas = canvasRef.current!;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;
      task = page.render({ canvas, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      try {
        await task.promise;
      } catch {
        return;
      }
      if (cancelled || !textRef.current) return;
      textRef.current.replaceChildren();
      textRef.current.style.setProperty("--scale-factor", String(scale));
      textLayer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textRef.current, viewport: vp });
      await textLayer.render().catch(() => {});
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      textLayer?.cancel();
    };
  }, [visible, pdf, n, scale]);

  return (
    <div className="pdf-page" data-page={n} ref={ref} style={{ width: size.w, height: size.h }}>
      <canvas ref={canvasRef} />
      {highlights?.map((a) =>
        a.rects.map((r, i) => (
          <div
            key={`${a.id}-${i}`}
            className={`pdf-hl ${a.comment ? "has-comment" : ""}`}
            title={a.comment || undefined}
            style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, background: HIGHLIGHT_COLORS[a.color] }}
          />
        )),
      )}
      <div className="textLayer" ref={textRef} />
      {highlights?.map((a) => {
        const r = a.rects[0];
        if (!r) return null;
        return (
          <button
            key={`m-${a.id}`}
            className={`pdf-hl-marker ${a.comment ? "has-comment" : ""}`}
            style={{ left: `calc(${(r.x + r.w) * 100}% - 4px)`, top: `calc(${r.y * 100}% - 8px)`, background: HIGHLIGHT_COLORS[a.color] }}
            aria-label={a.comment ? `Kommentar: ${a.comment}` : "Markierung bearbeiten"}
            title={a.comment || "Markierung bearbeiten"}
            onClick={(e) => {
              e.stopPropagation();
              onAnnotationClick?.(a, e.clientX, e.clientY);
            }}
          />
        );
      })}
      {visible && inkSettings && (inkActive || !!ink?.length) && (
        <InkLayer width={size.w} height={size.h} strokes={ink ?? []} active={inkActive} settings={inkSettings} onCommit={(next) => onInk?.(n, next, size.h / size.w)} />
      )}
      <span className="pdf-page-no xs tnum">{n}</span>
    </div>
  );
}

function Thumbnails({ pdf, current, onPick }: { pdf: PdfDoc; current: number; onPick: (p: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="pdf-thumbs" ref={ref}>
      {Array.from({ length: pdf.numPages }, (_, i) => (
        <Thumb key={i} pdf={pdf} n={i + 1} active={current === i + 1} onPick={onPick} root={ref.current} />
      ))}
    </div>
  );
}

function Thumb({ pdf, n, active, onPick, root }: { pdf: PdfDoc; n: number; active: boolean; onPick: (p: number) => void; root: HTMLElement | null }) {
  const ref = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visible = useVisible(ref, root, "300px");
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!visible || done) return;
    let cancelled = false;
    (async () => {
      const page = await pdf.getPage(n);
      const vp0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 120 / vp0.width });
      const c = canvasRef.current;
      if (!c || cancelled) return;
      c.width = vp.width;
      c.height = vp.height;
      await page.render({ canvas: c, viewport: vp }).promise.catch(() => {});
      if (!cancelled) setDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, done, pdf, n]);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <button ref={ref} className={`pdf-thumb ${active ? "is-active" : ""}`} onClick={() => onPick(n)} aria-label={`Seite ${n}`}>
      <canvas ref={canvasRef} />
      <span className="xs tnum">{n}</span>
    </button>
  );
}
