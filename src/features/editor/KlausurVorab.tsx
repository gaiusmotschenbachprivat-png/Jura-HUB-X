/**
 * Klausurbogen: Seiten anderer Dateien vor dem ersten Bogen (Sachverhalt,
 * Aufgabenstellung, Deckblatt). Auswahl über der Seite, Anzeige vor Bogen 1,
 * im PDF vorne (klausurPdf.ts). Die Dateien bleiben in „Dokumente“.
 */
import { FilePlus2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api, errorMessage } from "../../api";
import type { DocumentInfo } from "../../api/types";
import { BOGEN, isVorabExt, MM } from "../../lib/klausurBogen";
import { closePdf, loadPdf } from "../../lib/pdf";
import { reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { useMenu } from "../../ui/Menu";

/** Auswahl der vorangestellten Dateien (Leiste über dem Bogen) */
export function VorabControl({ ids, courseId, onChange }: { ids: string[]; courseId: string | null; onChange: (ids: string[]) => void }) {
  const menu = useMenu();
  const toast = useApp((s) => s.toast);
  const [docs, setDocs] = useState<Map<string, DocumentInfo>>(new Map());
  useEffect(() => {
    let alive = true;
    void Promise.all(ids.map((id) => api.documentGet(id).then((d) => d.document).catch(() => null))).then((list) => {
      if (alive) setDocs(new Map(list.filter((d): d is DocumentInfo => !!d).map((d) => [d.id, d])));
    });
    return () => {
      alive = false;
    };
  }, [ids]);

  const fromDevice = async () => {
    try {
      const paths = await api.pickFiles({ multiple: true, extensions: ["pdf", "png", "jpg", "jpeg"], title: "Datei vor den Klausurbogen" });
      if (!paths?.length) return;
      const res = await api.documentsImport(paths, courseId, "klausur");
      const added = res.flatMap((r) => (r.document && isVorabExt(r.document.ext) ? [r.document.id] : []));
      for (const r of res) if (r.error) toast(`${r.file_name}: ${r.error}`, "error");
      if (added.length) onChange([...ids, ...added]);
    } catch (e) {
      reportError(e);
    }
  };

  const choose = async (el: HTMLElement) => {
    try {
      const scope = courseId ? ({ kind: "subtree", id: courseId } as const) : ({ kind: "all" } as const);
      let list = (await api.documentsList(scope)).filter((d) => !d.deleted_at && d.file_present && isVorabExt(d.ext) && !ids.includes(d.id));
      if (courseId && !list.length) list = (await api.documentsList({ kind: "all" })).filter((d) => !d.deleted_at && d.file_present && isVorabExt(d.ext) && !ids.includes(d.id));
      menu.openBelow(el, [
        { label: "Vom Gerät wählen (PDF oder Bild) …", icon: <FilePlus2 size={14} />, onSelect: () => void fromDevice() },
        ...(list.length ? [{ separator: true, label: "" }, { header: true, label: courseId ? "Unterlagen der Veranstaltung" : "Dokumente" }] : []),
        ...list.slice(0, 40).map((d) => ({
          label: `${d.title}${d.page_count ? ` · ${d.page_count} S.` : ""}`,
          onSelect: () => onChange([...ids, d.id]),
        })),
      ]);
    } catch (e) {
      toast(`Dokumente konnten nicht geladen werden: ${errorMessage(e)}`, "error");
    }
  };

  return (
    <div className="vorab-control">
      <span className="xs muted">Seiten davor:</span>
      {ids.map((id, i) => (
        <span key={id} className="vorab-chip">
          <span className="ellipsis">{docs.get(id)?.title ?? "Datei"}</span>
          {i > 0 && (
            <button className="vorab-mini" aria-label="Weiter nach vorne" onClick={() => onChange(ids.map((x, k) => (k === i - 1 ? id : k === i ? ids[i - 1]! : x)))}>
              ↑
            </button>
          )}
          <button className="vorab-mini" aria-label={`„${docs.get(id)?.title ?? "Datei"}“ entfernen`} onClick={() => onChange(ids.filter((x) => x !== id))}>
            <X size={12} />
          </button>
        </span>
      ))}
      <Button size="sm" variant="ghost" icon={<FilePlus2 size={14} />} onClick={(e) => void choose(e.currentTarget)}>
        Datei davor …
      </Button>
      {menu.el}
    </div>
  );
}

/** Seiten der vorangestellten Dateien, in Blattbreite (vor Bogen 1) */
export function VorabPages({ ids, zoom }: { ids: string[]; zoom: number }) {
  const width = BOGEN.width * MM * zoom;
  return (
    <div className="vorab-pages" style={{ width }}>
      {ids.map((id) => (
        <VorabDoc key={id} id={id} width={width} />
      ))}
    </div>
  );
}

function VorabDoc({ id, width }: { id: string; width: number }) {
  const [info, setInfo] = useState<DocumentInfo | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const urls = useRef<string[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = (await api.documentGet(id)).document;
        if (!alive) return;
        setInfo(d);
        const bytes = await api.documentBytes(id);
        if (!alive) return;
        if (d.ext.toLowerCase() === "pdf") {
          const pdf = await loadPdf(bytes);
          try {
            const out: string[] = [];
            const px = Math.min(2400, Math.round(BOGEN.width * MM * Math.min(2, window.devicePixelRatio || 1)));
            for (let i = 1; i <= Math.min(pdf.numPages, 40) && alive; i++) {
              const page = await pdf.getPage(i);
              const vp0 = page.getViewport({ scale: 1 });
              const vp = page.getViewport({ scale: px / vp0.width });
              const canvas = document.createElement("canvas");
              canvas.width = Math.round(vp.width);
              canvas.height = Math.round(vp.height);
              await page.render({ canvas, viewport: vp, background: "#ffffff" } as never).promise;
              const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
              page.cleanup();
              if (blob) {
                const u = URL.createObjectURL(blob);
                urls.current.push(u);
                out.push(u);
                if (alive) setPages([...out]);
              }
            }
          } finally {
            await closePdf(pdf);
          }
        } else {
          const u = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: d.mime || "image/png" }));
          urls.current.push(u);
          setPages([u]);
        }
      } catch (e) {
        if (alive) setError(errorMessage(e));
      }
    })();
    return () => {
      alive = false;
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = [];
    };
  }, [id]);
  if (error) return <div className="vorab-sheet vorab-error small">Datei nicht verfügbar: {error}</div>;
  if (!pages.length) return <div className="vorab-sheet vorab-loading small muted" style={{ height: width * 1.414 }}>Lade {info?.title ?? "Datei"} …</div>;
  return (
    <>
      {pages.map((u, i) => (
        <figure key={u} className="vorab-sheet" aria-label={`${info?.title ?? "Datei"}, Seite ${i + 1}`}>
          <img src={u} alt="" draggable={false} />
          <figcaption className="xs">
            {info?.title} · Seite {i + 1}/{pages.length}
          </figcaption>
        </figure>
      ))}
    </>
  );
}
