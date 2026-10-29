import { Columns2, ExternalLink, FilePlus2, ImagePlus, Link2, MoreHorizontal, Plus, Rows2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, errorMessage } from "../../api";
import type { Annotation, DocumentDetail, LinkView, NewCard } from "../../api/types";
import type { Stroke } from "../../lib/drawing";
import { decodeInk, encodeInk, renderPageImage } from "../../lib/ink";
import { DOC_TYPE_LABEL, TEXT_STATUS_LABEL } from "../../lib/kinds";
import type { PdfDoc } from "../../lib/pdf";
import { buildTree, type TreeItem } from "../../lib/tree";
import { reportError, useApp } from "../../state/store";
import { Button, IconButton } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { useMenu } from "../../ui/Menu";
import { EmptyState, Field } from "../../ui/misc";
import { INSERT_SLIDE_EVENT, storeImageFile, type InsertSlideDetail } from "../editor/AssetImage";
import { LinkPicker } from "../editor/LinkPicker";
import { createNode } from "../navigation/actions";
import { KindIcon } from "../navigation/icons";
import { openExternally, saveCopyAs, trashDocument } from "./docActions";
import { DocIcon, TextStatus } from "./DocumentList";
import { AnnotationPopover, SelectionToolbar } from "./AnnotationPopups";
import { PdfViewer, type PdfSelection } from "./PdfViewer";
import { ImageSlideBar, rememberSlides, SwitchSlidesButton } from "./Slides";
import { LensImage } from "./SlideLens";
import { useSplitLayoutToggle } from "../editor/SplitNotes";
import { CardDialog } from "../learn/CardDialog";

/**
 * Dokumentansicht. `compact` = geteilte Ansicht neben einer Notiz.
 * In der geteilten Ansicht verknüpft „Seite verknüpfen“ die aktuelle Seite mit der offenen Notiz.
 */
export function DocumentViewer({ id, page: initialPage = 1, compact = false, linkTargetNoteId }: { id: string; page?: number; compact?: boolean; linkTargetNoteId?: string }) {
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [texts, setTexts] = useState<string[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(initialPage);
  const [links, setLinks] = useState<LinkView[]>([]);
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [annos, setAnnos] = useState<Annotation[]>([]);
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const [activeAnno, setActiveAnno] = useState<{ a: Annotation; x: number; y: number } | null>(null);
  const [cardFrom, setCardFrom] = useState<Partial<NewCard> | null>(null);
  const dataVersion = useApp((s) => s.dataVersion);
  const bump = useApp((s) => s.bump);
  const open = useApp((s) => s.open);
  const toast = useApp((s) => s.toast);
  const rememberTitle = useApp((s) => s.rememberTitle);
  const menu = useMenu();

  useEffect(() => setPage(initialPage), [initialPage, id]);
  // Neben einer Mitschrift: Foliensatz und Seite in der Notiz merken
  useEffect(() => {
    if (compact && linkTargetNoteId) rememberSlides(linkTargetNoteId, id, page);
  }, [compact, linkTargetNoteId, id, page]);
  const { stacked: stackedNow, toggle: toggleLayout } = useSplitLayoutToggle();

  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .documentGet(id)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        rememberTitle({ type: "document", id }, d.document.title);
        if (d.document.text_status === "ok") api.documentPagesText(id).then((t) => alive && setTexts(t)).catch(() => {});
        else if (d.document.text_status !== "pending") setTexts([]);
      })
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [id, dataVersion, rememberTitle]);

  const fileKind = detail?.document.ext;
  useEffect(() => {
    if (!detail || !detail.document.file_present) return;
    const ext = detail.document.ext;
    if (!["pdf", "png", "jpg", "jpeg", "gif", "webp", "txt", "md", "markdown"].includes(ext)) return;
    let alive = true;
    api
      .documentBytes(id)
      .then((b) => alive && setBytes(b))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
    // Bytes nur neu laden, wenn sich das Dokument ändert
  }, [id, fileKind, detail?.document.file_present]);

  // Handschrift: lokal sofort sichtbar, gespeichert kurz nach dem letzten Strich
  const [inks, setInks] = useState<Map<number, Stroke[]>>(() => new Map());
  const inkIds = useRef(new Map<number, string>());
  const inkLoaded = useRef<string | null>(null);
  const inkPending = useRef(new Map<number, { strokes: Stroke[]; ratio: number; timer: ReturnType<typeof setTimeout> }>());
  const inkChain = useRef<Promise<void>>(Promise.resolve());
  const pdfRef = useRef<PdfDoc | null>(null);
  const [slideBusy, setSlideBusy] = useState(false);

  const loadAnnos = useCallback(() => {
    api
      .annotationsList(id)
      .then((list) => {
        setAnnos(list);
        for (const a of list) if (a.kind === "ink") inkIds.current.set(a.page, a.id);
        if (inkLoaded.current !== id) {
          inkLoaded.current = id;
          setInks(new Map(list.filter((a) => a.kind === "ink").map((a) => [a.page, decodeInk(a.ink)])));
        }
      })
      .catch(() => {});
  }, [id]);
  useEffect(loadAnnos, [loadAnnos]);

  const persistInk = useCallback(
    (p: number, strokes: Stroke[], ratio: number) => {
      inkChain.current = inkChain.current.then(async () => {
        try {
          const ink = encodeInk(strokes, ratio);
          const existing = inkIds.current.get(p);
          if (!ink) {
            if (existing) {
              await api.annotationDelete(existing);
              inkIds.current.delete(p);
              loadAnnos();
            }
          } else if (existing) {
            await api.annotationUpdate(existing, { ink });
          } else {
            const a = await api.annotationCreate({ document_id: id, page: p, kind: "ink", ink });
            inkIds.current.set(p, a.id);
            loadAnnos();
          }
        } catch (e) {
          reportError(e);
        }
      });
      return inkChain.current;
    },
    [id, loadAnnos],
  );
  const flushInk = useCallback(() => {
    for (const [p, v] of inkPending.current) {
      clearTimeout(v.timer);
      void persistInk(p, v.strokes, v.ratio);
    }
    inkPending.current.clear();
    return inkChain.current;
  }, [persistInk]);
  const onInkChange = (p: number, strokes: Stroke[], ratio: number) => {
    setInks((m) => new Map(m).set(p, strokes));
    const prev = inkPending.current.get(p);
    if (prev) clearTimeout(prev.timer);
    const timer = setTimeout(() => {
      inkPending.current.delete(p);
      void persistInk(p, strokes, ratio);
    }, 800);
    inkPending.current.set(p, { strokes, ratio, timer });
  };
  // Beim Verlassen, App-Wechsel oder Schließen sofort speichern
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && void flushInk();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushInk);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushInk);
      void flushInk();
    };
  }, [flushInk]);

  const loadLinks = useCallback(() => {
    api.linksFor("document", id).then(setLinks).catch(() => {});
  }, [id]);
  useEffect(loadLinks, [loadLinks, dataVersion]);

  const pageLinks = useMemo(() => links.filter((l) => l.other_type === "node" && l.anchor?.page === page), [links, page]);
  const docLinks = useMemo(() => links.filter((l) => l.other_type === "node" && !l.anchor?.page), [links]);

  const imageUrl = useMemo(() => {
    if (!bytes || !detail || !["png", "jpg", "jpeg", "gif", "webp"].includes(detail.document.ext)) return null;
    return URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: detail.document.mime }));
  }, [bytes, detail]);
  useEffect(() => () => void (imageUrl && URL.revokeObjectURL(imageUrl)), [imageUrl]);

  if (error) return <EmptyState title="Dokument nicht verfügbar">{error}</EmptyState>;
  if (!detail) return <div className="loading">Lade Dokument …</div>;
  const d = detail.document;

  const linkPage = async (noteId: string) => {
    try {
      await api.linkAdd({ source_type: "node", source_id: noteId, target_type: "document", target_id: id, kind: "page", anchor: { page } });
      loadLinks();
      bump();
      toast(`Seite ${page} verknüpft.`, "success");
    } catch (e) {
      reportError(e);
    }
  };

  const newNoteForPage = async () => {
    const target = detail.placements[0];
    const areaId = target?.area_id ?? useApp.getState().areas[0]?.id;
    if (!areaId) return;
    const n = await createNode({
      areaId,
      parentId: target?.node_id ?? null,
      kind: "note",
      title: `${d.title} – S. ${page}`,
      templateId: "mitschrift",
      openAfter: false,
    });
    if (!n) return;
    await api.linkAdd({ source_type: "node", source_id: n.id, target_type: "document", target_id: id, kind: "page", anchor: { page } }).catch(reportError);
    // Folie bleibt rechts offen, Mitschrift links
    useApp.getState().open({ type: "note", id: n.id }, { title: n.title });
    useApp.getState().openSecondary({ type: "document", id, page });
    bump();
  };

  /** Aktuelle Seite (mit Handschrift) als Bild in die Mitschrift daneben übernehmen. */
  const takeSlide = async (noteId: string) => {
    const pdf = pdfRef.current;
    if (!pdf || slideBusy) return;
    setSlideBusy(true);
    try {
      const { png } = await renderPageImage(pdf, page, inks.get(page) ?? []);
      const src = await storeImageFile(png);
      window.dispatchEvent(new CustomEvent<InsertSlideDetail>(INSERT_SLIDE_EVENT, { detail: { noteId, src, page, documentId: id, title: d.title } }));
      // Seite dauerhaft mit der Notiz verknüpfen (falls noch nicht geschehen)
      if (!links.some((l) => l.other_id === noteId && l.anchor?.page === page)) {
        await api.linkAdd({ source_type: "node", source_id: noteId, target_type: "document", target_id: id, kind: "page", anchor: { page } }).catch(() => {});
        loadLinks();
      }
    } catch (e) {
      reportError(e);
    } finally {
      setSlideBusy(false);
    }
  };

  const isPdf = d.ext === "pdf";
  const linkButtons = isPdf && (
    <>
      {linkTargetNoteId ? (
        <>
          <Button size="sm" variant="primary" icon={<ImagePlus size={14} />} disabled={slideBusy} onClick={() => void takeSlide(linkTargetNoteId)} title="Diese Seite als Bild in die Mitschrift einfügen">
            Folie übernehmen
          </Button>
          <Button size="sm" icon={<Link2 size={14} />} onClick={() => void linkPage(linkTargetNoteId)} title="Diese Seite mit der geöffneten Notiz verknüpfen">
            Seite {page} verknüpfen
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" icon={<Link2 size={14} />} onClick={() => setPicker(true)}>
            Seite mit Notiz verknüpfen
          </Button>
          <Button size="sm" icon={<FilePlus2 size={14} />} onClick={() => void newNoteForPage()}>
            Mitschrift zu Seite {page}
          </Button>
        </>
      )}
    </>
  );

  return (
    <div className={`docview ${compact ? "is-compact" : ""}`}>
      <div className="doc-head">
        <DocIcon ext={d.ext} size={18} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="doc-title ellipsis" title={d.original_name}>
            {d.title}
          </div>
          {!compact && (
            <div className="xs muted row wrap">
              <span>{DOC_TYPE_LABEL[d.doc_type]}</span>
              <span>·</span>
              <span title={TEXT_STATUS_LABEL[d.text_status]}>
                <TextStatus status={d.text_status} />
              </span>
              {detail.placements.map((p) => (
                <button key={p.node_id} className="chip chip-btn" onClick={() => open({ type: "node", id: p.node_id })} title={p.path}>
                  {p.title}
                </button>
              ))}
              <button className="chip chip-btn" onClick={() => setPlacing(true)}>
                <Plus size={11} /> zuordnen
              </button>
            </div>
          )}
        </div>
        {compact && (
          <IconButton
            label={stackedNow ? "Folie neben die Mitschrift" : "Folie über die Mitschrift"}
            onClick={toggleLayout}
          >
            {stackedNow ? <Columns2 size={15} /> : <Rows2 size={15} />}
          </IconButton>
        )}
        {compact && (
          <IconButton label="Als Hauptansicht öffnen" onClick={() => open({ type: "document", id, page })}>
            <ExternalLink size={15} />
          </IconButton>
        )}
        <IconButton
          label="Aktionen"
          onClick={(e) =>
            menu.openBelow(e.currentTarget, [
              { label: "Titel und Typ ändern", onSelect: () => setEditing(true) },
              { label: "Zuordnen …", onSelect: () => setPlacing(true) },
              { label: "Mit Standardprogramm öffnen (Kopie)", onSelect: () => void openExternally(d) },
              { label: "Kopie speichern unter …", onSelect: () => void saveCopyAs(d) },
              { separator: true, label: "" },
              {
                label: "In den Papierkorb",
                danger: true,
                onSelect: async () => {
                  if (await trashDocument(d)) open({ type: "documents" });
                },
              },
            ])
          }
        >
          <MoreHorizontal size={16} />
        </IconButton>
        {compact && linkTargetNoteId && <SwitchSlidesButton noteId={linkTargetNoteId} />}
        {compact && (
          <Button size="sm" variant="ghost" icon={<X size={15} />} aria-label="Geteilte Ansicht schließen" title="Folie schließen" onClick={() => useApp.getState().openSecondary(null)}>
            Schließen
          </Button>
        )}
      </div>

      {(d.text_status === "none" || d.text_status === "error") && isPdf && !compact && (
        <div className="notice small">
          {d.text_status === "none"
            ? "Dieses Dokument enthält keinen auslesbaren Text (vermutlich ein Scan). Es ist sichtbar, aber nicht durchsuchbar. Eine lokale Texterkennung (OCR) ist für eine spätere Version geplant."
            : "Der Text dieses Dokuments konnte nicht gelesen werden. Die Ansicht funktioniert trotzdem."}
        </div>
      )}

      {pageLinks.length > 0 && (
        <div className="page-links small">
          <span className="muted">Zu Seite {page}:</span>
          {pageLinks.map((l) => (
            <span key={l.id} className="chip">
              <button className="chip-link" onClick={() => open({ type: "note", id: l.other_id }, { title: l.other_title })}>
                {l.other_kind && <KindIcon kind={l.other_kind} size={12} />} {l.other_title}
              </button>
              {l.kind === "page" && (
                <button
                  aria-label="Verknüpfung entfernen"
                  onClick={async () => {
                    await api.linkRemove(l.id).catch(reportError);
                    loadLinks();
                  }}
                >
                  <X size={11} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="doc-body">
        {!d.file_present ? (
          <EmptyState title="Datei fehlt">
            Die Datei dieses Dokuments ist im Dokumentenspeicher nicht mehr vorhanden. Stelle sie aus einem Backup wieder her.
          </EmptyState>
        ) : isPdf ? (
          bytes ? (
            <PdfViewer
              bytes={bytes}
              page={page}
              onPageChange={setPage}
              pageTexts={texts}
              inks={inks}
              onInkChange={onInkChange}
              onDocument={(p) => (pdfRef.current = p)}
              toolbarExtra={linkButtons}
              annotations={annos}
              onTextSelected={setSelection}
              onQuickHighlight={async (h) => {
                try {
                  await api.annotationCreate({ document_id: id, page: h.page, kind: "highlight", color: h.color, rects: h.rects, quote: h.quote });
                  loadAnnos();
                } catch (e) {
                  reportError(e);
                }
              }}
              onAnnotationClick={(a, x, y) => setActiveAnno({ a, x, y })}
              onToggleBookmark={async (p) => {
                const existing = annos.find((a) => a.kind === "bookmark" && a.page === p);
                try {
                  if (existing) await api.annotationDelete(existing.id);
                  else await api.annotationCreate({ document_id: id, page: p, kind: "bookmark" });
                  loadAnnos();
                } catch (e) {
                  reportError(e);
                }
              }}
            />
          ) : (
            <div className="loading">Lade PDF …</div>
          )
        ) : imageUrl ? (
          <>
            <ImageSlideBar doc={d} placementNodeId={detail.placements[0]?.node_id ?? null} bytes={bytes} noteId={linkTargetNoteId} />
            <LensImage src={imageUrl} alt={d.title} label={d.title} />
          </>
        ) : bytes && ["txt", "md", "markdown"].includes(d.ext) ? (
          <pre className="text-view">{new TextDecoder().decode(bytes)}</pre>
        ) : (
          <EmptyState
            title={`${d.ext.toUpperCase()}-Datei`}
            action={
              <Button variant="primary" onClick={() => void openExternally(d)}>
                Mit Standardprogramm öffnen
              </Button>
            }
          >
            Dieses Format wird in Studium OS nicht direkt angezeigt. {d.ext === "docx" && d.text_status === "ok" && "Der Text ist trotzdem durchsuchbar. "}
            Es öffnet sich eine Kopie, das Original bleibt unverändert.
          </EmptyState>
        )}
      </div>

      {!compact && docLinks.length > 0 && (
        <div className="doc-foot small">
          <span className="muted">Verknüpft mit:</span>
          {docLinks.map((l) => (
            <button key={l.id} className="chip chip-btn" onClick={() => open({ type: "note", id: l.other_id })}>
              {l.other_title}
            </button>
          ))}
        </div>
      )}

      {picker && (
        <LinkPicker
          title={`Seite ${page} mit Notiz verknüpfen`}
          onClose={() => setPicker(false)}
          onPick={(t) => {
            setPicker(false);
            if (t.type !== "node") return toast("Bitte eine Notiz oder ein Strukturelement wählen.", "error");
            void linkPage(t.id);
          }}
        />
      )}
      {selection && (
        <SelectionToolbar
          sel={selection}
          onClose={() => setSelection(null)}
          onHighlight={async (color, comment) => {
            try {
              await api.annotationCreate({ document_id: id, page: selection.page, kind: "highlight", color, rects: selection.rects, quote: selection.quote, comment });
              window.getSelection()?.removeAllRanges();
              setSelection(null);
              loadAnnos();
            } catch (e) {
              reportError(e);
            }
          }}
          onCard={() => {
            setCardFrom({ front: "", back: `${selection.quote}\n\n(${d.title}, S. ${selection.page})`, source_type: "document", source_id: id });
            setSelection(null);
          }}
        />
      )}
      {activeAnno && (
        <AnnotationPopover
          a={activeAnno.a}
          x={activeAnno.x}
          y={activeAnno.y}
          onClose={() => setActiveAnno(null)}
          onSave={async (patch) => {
            try {
              const u = await api.annotationUpdate(activeAnno.a.id, patch);
              setAnnos((xs) => xs.map((x) => (x.id === u.id ? u : x)));
              if (patch.color) setActiveAnno((cur) => (cur ? { ...cur, a: u } : cur));
            } catch (e) {
              reportError(e);
            }
          }}
          onDelete={async () => {
            await api.annotationDelete(activeAnno.a.id).catch(reportError);
            setActiveAnno(null);
            loadAnnos();
          }}
          onCard={() => {
            const a = activeAnno.a;
            setCardFrom({ front: a.comment || "", back: `${a.quote}\n\n(${d.title}, S. ${a.page})`, source_type: "document", source_id: id });
            setActiveAnno(null);
          }}
        />
      )}
      {cardFrom && <CardDialog initial={cardFrom} onClose={() => setCardFrom(null)} />}
      {editing && <EditDocDialog detail={detail} onClose={() => setEditing(false)} onSaved={() => bump()} />}
      {placing && <PlacementDialog detail={detail} onClose={() => setPlacing(false)} onChanged={() => bump()} />}
      {menu.el}
    </div>
  );
}

function EditDocDialog({ detail, onClose, onSaved }: { detail: DocumentDetail; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(detail.document.title);
  const [type, setType] = useState(detail.document.doc_type);
  const save = async () => {
    try {
      await api.documentUpdate(detail.document.id, title, type);
      onSaved();
      onClose();
    } catch (e) {
      reportError(e);
    }
  };
  return (
    <Dialog title="Dokument bearbeiten" onClose={onClose} footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" onClick={save}>Speichern</Button></>}>
      <div className="stack">
        <Field label="Titel" hint={`Originaldatei: ${detail.document.original_name}`}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Dokumenttyp">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(DOC_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Dialog>
  );
}

function flatten(items: TreeItem[], out: TreeItem[] = []) {
  for (const it of items) {
    if (it.node.kind !== "note") out.push(it);
    flatten(it.children, out);
  }
  return out;
}

function PlacementDialog({ detail, onClose, onChanged }: { detail: DocumentDetail; onClose: () => void; onChanged: () => void }) {
  const areas = useApp((s) => s.areas);
  const [nodes, setNodes] = useState<Awaited<ReturnType<typeof api.nodesList>>>([]);
  const [placed, setPlaced] = useState(new Set(detail.placements.map((p) => p.node_id)));
  useEffect(() => {
    api.nodesList(null).then(setNodes).catch(reportError);
  }, []);
  const toggle = async (nodeId: string) => {
    try {
      if (placed.has(nodeId)) await api.documentRemovePlacement(detail.document.id, nodeId);
      else await api.documentAddPlacement(detail.document.id, nodeId);
      const next = new Set(placed);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      setPlaced(next);
      onChanged();
    } catch (e) {
      reportError(e);
    }
  };
  return (
    <Dialog title="Zuordnung" onClose={onClose} width={560} footer={<Button variant="primary" onClick={onClose}>Fertig</Button>}>
      <p className="small muted">Ein Dokument kann mehreren Veranstaltungen und Themen zugeordnet sein – auch in verschiedenen Studienbereichen. Es wird dabei nicht kopiert.</p>
      <div className="placement-list">
        {areas.map((a) => {
          const items = flatten(buildTree(nodes.filter((n) => n.area_id === a.id), { showArchived: true }));
          if (!items.length) return null;
          return (
            <div key={a.id}>
              <div className="label" style={{ margin: "10px 0 4px" }}>
                {a.name}
              </div>
              {items.map((it) => (
                <label key={it.node.id} className="placement-row" style={{ paddingLeft: 6 + it.depth * 16 }}>
                  <input type="checkbox" checked={placed.has(it.node.id)} onChange={() => void toggle(it.node.id)} />
                  <KindIcon kind={it.node.kind} size={14} />
                  <span className="ellipsis">{it.node.title}</span>
                </label>
              ))}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
