/**
 * PDF-Ansicht mit pdf.js: Seiten werden erst gerendert, wenn sie sichtbar
 * werden (auch bei Skripten mit Hunderten Seiten flüssig). Mit Textebene zum
 * Markieren und Kopieren, Seitenübersicht, Zoom und Textsuche.
 */
import "../../styles/pdf-textlayer.css";

import { ChevronLeft, ChevronRight, PanelLeft, Search, ZoomIn, ZoomOut } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { closePdf, loadPdf, type PdfDoc } from "../../lib/pdf";
import { IconButton } from "../../ui/Button";

const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

export function PdfViewer({
  bytes,
  page,
  onPageChange,
  pageTexts,
  toolbarExtra,
}: {
  bytes: Uint8Array;
  page: number;
  onPageChange: (p: number) => void;
  /** Bereits extrahierter Text je Seite (für die Suche) */
  pageTexts?: string[];
  toolbarExtra?: React.ReactNode;
}) {
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [baseSize, setBaseSize] = useState<{ w: number; h: number } | null>(null);
  const [fit, setFit] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(800);
  const [thumbs, setThumbs] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pageInput, setPageInput] = useState(String(page));
  const scroller = useRef<HTMLDivElement>(null);
  const jumpRef = useRef<number | null>(page);
  const currentRef = useRef(page);

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
      })
      .catch(() => alive && setError("Die PDF-Datei konnte nicht geöffnet werden. Sie ist eventuell beschädigt oder passwortgeschützt."));
    return () => {
      alive = false;
      void closePdf(doc);
    };
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
    if (fit) return Math.max(0.3, (width - 48) / baseSize.w);
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
        <span className="grow" />
        {toolbarExtra}
      </div>
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
        {thumbs && pdf && <Thumbnails pdf={pdf} current={Number(pageInput)} onPick={go} />}
        <div className="pdf-scroll" ref={scroller} onScroll={onScroll}>
          {!pdf || !baseSize ? (
            <div className="loading">Lade PDF …</div>
          ) : (
            Array.from({ length: pdf.numPages }, (_, i) => (
              <PdfPage key={i + 1} pdf={pdf} n={i + 1} scale={scale} base={baseSize} root={scroller.current} />
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

function PdfPage({ pdf, n, scale, base, root }: { pdf: PdfDoc; n: number; scale: number; base: { w: number; h: number }; root: HTMLElement | null }) {
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
      <div className="textLayer" ref={textRef} />
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
