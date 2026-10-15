import { Printer, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { api, errorMessage } from "../../api";
import { imageSources, type PMNode } from "../../lib/pm";
import { Button } from "../../ui/Button";
import { buildPrintHtml, printCss, type PrintOptions } from "./print";

/**
 * Druckansicht mit echten Seiten. „Drucken / PDF“ öffnet den Druckdialog des
 * Systems; auf dem iPad lässt sich dort über „Teilen → In Dateien sichern“ ein PDF ablegen.
 */
export function PrintView({ doc, title, onClose }: { doc: PMNode; title: string; onClose: () => void }) {
  const [opts, setOpts] = useState<PrintOptions>({ title, toc: false, margins: "normal", style: "notiz", pageNumbers: true });
  const [state, setState] = useState<{ busy: boolean; pages: number; error: string | null }>({ busy: true, pages: 0, error: null });
  const target = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.classList.add("is-printing");
    return () => document.body.classList.remove("is-printing");
  }, []);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    let cleanup: (() => void) | null = null;
    (async () => {
      setState({ busy: true, pages: 0, error: null });
      try {
        // Bilder aus dem App-Speicher
        const images = new Map<string, string>();
        for (const src of imageSources(doc)) {
          const m = /^studium:asset\/([0-9a-f]{64})$/.exec(src);
          if (!m) continue;
          const bytes = await api.imageBytes(m[1]!).catch(() => null);
          if (!bytes) continue;
          const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer]));
          urls.push(url);
          images.set(src, url);
        }
        const html = buildPrintHtml(doc, opts, (s) => images.get(s));
        const { Previewer } = await import("pagedjs");
        if (cancelled || !target.current) return;
        target.current.innerHTML = "";
        const previewer = new Previewer();
        const flow = await previewer.preview(html, [{ "studium-print.css": printCss(opts) }], target.current);
        cleanup = () => previewer.polisher?.destroy?.();
        if (!cancelled) setState({ busy: false, pages: flow.total ?? flow.pages?.length ?? 0, error: null });
      } catch (e) {
        if (!cancelled) setState({ busy: false, pages: 0, error: errorMessage(e) });
      }
    })();
    return () => {
      cancelled = true;
      cleanup?.();
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [doc, opts]);

  const set = <K extends keyof PrintOptions>(k: K, v: PrintOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  return createPortal(
    <div className="print-overlay" role="dialog" aria-modal="true" aria-label="Druckansicht">
      <div className="print-bar">
        <strong className="grow ellipsis">Druckansicht · {title}</strong>
        <label className="row small">
          <input type="checkbox" checked={opts.toc} onChange={(e) => set("toc", e.target.checked)} /> Inhaltsverzeichnis
        </label>
        <label className="row small">
          <input type="checkbox" checked={opts.pageNumbers} onChange={(e) => set("pageNumbers", e.target.checked)} /> Seitenzahlen
        </label>
        <select aria-label="Seitenränder" value={opts.margins} onChange={(e) => set("margins", e.target.value as PrintOptions["margins"])}>
          <option value="normal">Ränder normal</option>
          <option value="korrektur">Korrekturrand 7 cm</option>
        </select>
        <select aria-label="Schrift" value={opts.style} onChange={(e) => set("style", e.target.value as PrintOptions["style"])}>
          <option value="notiz">Schrift wie in der Notiz</option>
          <option value="hausarbeit">Hausarbeit: Times 12 pt, 1,5-zeilig</option>
        </select>
        <span className="small muted tnum">{state.busy ? "Setze Seiten …" : `${state.pages} Seite${state.pages === 1 ? "" : "n"}`}</span>
        <Button variant="primary" icon={<Printer size={15} />} disabled={state.busy || !!state.error} onClick={() => window.print()}>
          Drucken / PDF
        </Button>
        <Button variant="ghost" icon={<X size={15} />} onClick={onClose} aria-label="Druckansicht schließen">
          Schließen
        </Button>
      </div>
      {state.error && <div className="notice notice-warn">Die Druckansicht konnte nicht erstellt werden: {state.error}</div>}
      <div className="print-scroll">
        <div ref={target} className="print-pages" />
      </div>
      <p className="print-hint xs muted">Auf dem iPad: „Drucken / PDF“ → im Druckdialog auf Teilen tippen → „In Dateien sichern“ legt ein PDF ab.</p>
    </div>,
    document.body,
  );
}
