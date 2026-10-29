/**
 * Folie neben Mitschrift: Die Vorlesungsfolien öffnen sich neben (oder auf dem
 * iPad hochkant über) der Notiz. Die Notiz merkt sich Foliensatz und Seite,
 * sodass „Folien“ beim nächsten Mal an derselben Stelle weitermacht.
 */
import { ChevronLeft, ChevronRight, FileUp, ImagePlus, Presentation, Replace, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LensToggle } from "./SlideLens";

import { api } from "../../api";
import type { DocumentInfo, StudyNode } from "../../api/types";
import { ancestors } from "../../lib/tree";
import { reportError, useApp } from "../../state/store";
import { Button, IconButton } from "../../ui/Button";
import { INSERT_SLIDE_EVENT, storeImageFile, type InsertSlideDetail } from "../editor/AssetImage";
import { Dialog } from "../../ui/Dialog";
import { useMenu } from "../../ui/Menu";
import { DocIcon } from "./DocumentList";
import { startImport } from "./ImportDialog";

/** Bilder, die sich als Folie zeigen lassen (z. B. Fotos oder Screenshots der Folien). */
export const SLIDE_IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp"];
export const isSlideDoc = (d: Pick<DocumentInfo, "ext">) => d.ext === "pdf" || SLIDE_IMAGE_EXT.includes(d.ext);
const byName = (a: DocumentInfo, b: DocumentInfo) => a.title.localeCompare(b.title, "de", { numeric: true }) || a.created_at.localeCompare(b.created_at);

export interface SlidesRef {
  document_id: string;
  page: number;
}

export function slidesOf(node: StudyNode | undefined): SlidesRef | null {
  const s = node?.meta?.slides as Partial<SlidesRef> | undefined;
  return s && typeof s.document_id === "string" && /^[0-9a-f-]{36}$/.test(s.document_id) ? { document_id: s.document_id, page: Math.max(1, Math.floor(Number(s.page) || 1)) } : null;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Foliensatz und Seite in der Notiz merken (verzögert, damit Blättern nicht ständig speichert). */
export function rememberSlides(noteId: string, documentId: string, page: number, delay = 1500) {
  clearTimeout(timers.get(noteId));
  timers.set(
    noteId,
    setTimeout(async () => {
      timers.delete(noteId);
      const n = useApp.getState().nodes.find((x) => x.id === noteId);
      if (!n || n.kind !== "note") return;
      const cur = slidesOf(n);
      if (cur?.document_id === documentId && cur.page === page) return;
      try {
        const u = await api.nodeUpdate(noteId, { meta: { ...n.meta, slides: { document_id: documentId, page } } });
        useApp.setState((s) => ({ nodes: s.nodes.map((x) => (x.id === noteId ? { ...x, meta: u.meta } : x)) }));
      } catch {
        /* nur eine Komfortfunktion – kein Fehler anzeigen */
      }
    }, delay),
  );
}

/** Knopf im Kopf der Notiz: Folien daneben öffnen oder schließen. */
export function SlidesButton({ node }: { node: StudyNode }) {
  const secondary = useApp((s) => s.secondary);
  const [picking, setPicking] = useState(false);
  const menu = useMenu();
  const saved = slidesOf(node);
  const isOpen = secondary?.type === "document";

  const onClick = async (anchor: HTMLElement) => {
    const st = useApp.getState();
    if (isOpen)
      return menu.openBelow(anchor, [
        { label: "Andere Folien wählen …", icon: <Replace size={14} />, onSelect: () => setPicking(true) },
        { label: "Folien schließen", icon: <X size={14} />, onSelect: () => st.openSecondary(null) },
      ]);
    if (saved) {
      const d = await api.documentGet(saved.document_id).then(
        (r) => (!r.document.deleted_at && r.document.file_present ? r.document : null),
        () => null,
      );
      if (d)
        return menu.openBelow(anchor, [
          { label: `Weiter: ${d.title}${d.ext === "pdf" ? ` (S. ${saved.page})` : ""}`, icon: <Presentation size={14} />, onSelect: () => st.openSecondary({ type: "document", id: d.id, page: saved.page }) },
          { label: "Andere Folien wählen …", icon: <Replace size={14} />, onSelect: () => setPicking(true) },
        ]);
    }
    setPicking(true);
  };

  return (
    <>
      <Button
        size="sm"
        variant={isOpen ? "primary" : "secondary"}
        icon={<Presentation size={14} />}
        onClick={(e) => void onClick(e.currentTarget)}
        title={isOpen ? "Folien wechseln oder schließen" : saved ? "Folien öffnen oder andere wählen" : "Folien neben der Mitschrift öffnen"}
        aria-pressed={isOpen}
      >
        Folien
      </Button>
      {menu.el}
      {picking && <SlidePicker node={node} onClose={() => setPicking(false)} onPick={(d) => (setPicking(false), showSlides(node, d))} />}
    </>
  );
}

/** Foliensatz neben der Notiz öffnen und merken (gleicher Satz: an der gemerkten Seite weiter). */
function showSlides(node: StudyNode, d: DocumentInfo) {
  const saved = slidesOf(node);
  const page = saved?.document_id === d.id ? saved.page : 1;
  useApp.getState().openSecondary({ type: "document", id: d.id, page });
  rememberSlides(node.id, d.id, page, 0);
}

/** Knopf in der geöffneten Folie: andere Datei als Folie wählen. */
export function SwitchSlidesButton({ noteId }: { noteId: string }) {
  const node = useApp((s) => s.nodes.find((n) => n.id === noteId));
  const [picking, setPicking] = useState(false);
  if (!node) return null;
  return (
    <>
      <Button size="sm" variant="ghost" icon={<Replace size={14} />} onClick={() => setPicking(true)} title="Andere Datei als Folie wählen">
        Wechseln
      </Button>
      {picking && <SlidePicker node={node} onClose={() => setPicking(false)} onPick={(d) => (setPicking(false), showSlides(node, d))} />}
    </>
  );
}

/** Auswahl eines Foliensatzes: zuerst die PDFs der Veranstaltung, dann alle. */
export function SlidePicker({ node, onPick, onClose }: { node: StudyNode; onPick: (d: DocumentInfo) => void; onClose: () => void }) {
  const nodes = useApp((s) => s.nodes);
  const dataVersion = useApp((s) => s.dataVersion);
  const [own, setOwn] = useState<DocumentInfo[] | null>(null);
  const [all, setAll] = useState<DocumentInfo[]>([]);
  const [other, setOther] = useState<DocumentInfo[]>([]);
  const [q, setQ] = useState("");
  const scope = useMemo(() => {
    const chain = [node.id, ...ancestors(nodes, node.id)];
    return chain.map((id) => nodes.find((n) => n.id === id)).find((n) => n && (n.kind === "session" || n.kind === "course" || n.kind === "module")) ?? null;
  }, [node.id, nodes]);
  useEffect(() => {
    const pdf = (l: DocumentInfo[]) => l.filter((d) => isSlideDoc(d) && !d.deleted_at);
    (scope ? api.documentsList({ kind: "subtree", id: scope.id }) : Promise.resolve([]))
      .then((l) => setOwn(pdf(l)))
      .catch(() => setOwn([]));
    api
      .documentsList({ kind: "all" })
      .then((l) => {
        setAll(pdf(l));
        // andere Formate zeigen, damit klar ist, warum sie nicht wählbar sind
        setOther(l.filter((d) => !isSlideDoc(d) && !d.deleted_at));
      })
      .catch(reportError);
  }, [scope, dataVersion]);
  const t = q.trim().toLowerCase();
  const match = (d: DocumentInfo) => !t || d.title.toLowerCase().includes(t) || d.original_name.toLowerCase().includes(t);
  const ownIds = new Set((own ?? []).map((d) => d.id));
  // PDFs zuerst, dann Bilder (nach Namen, „Folie 2“ vor „Folie 10“)
  const order = (l: DocumentInfo[]) => [...l.filter((d) => d.ext === "pdf"), ...l.filter((d) => d.ext !== "pdf").sort(byName)];
  const first = order((own ?? []).filter(match));
  const rest = order(all.filter((d) => !ownIds.has(d.id) && match(d)));
  const others = other.filter(match);
  const isSlides = (d: DocumentInfo) => ["pptx", "ppt", "key", "odp"].includes(d.ext);
  const row = (d: DocumentInfo) => (
    <button key={d.id} className="slide-pick" onClick={() => onPick(d)}>
      <DocIcon ext={d.ext} size={16} />
      <span className="grow ellipsis">{d.title}</span>
      {d.page_count ? <span className="xs muted tnum">{d.page_count} S.</span> : d.ext !== "pdf" ? <span className="xs muted">Bild</span> : null}
    </button>
  );
  return (
    <Dialog title="Folien auswählen" onClose={onClose} width={520} footer={
        <>
          <Button icon={<FileUp size={14} />} onClick={() => void startImport({ nodeId: scope?.id ?? node.parent_id })}>
            Importieren
          </Button>
          <span className="grow" />
          <Button onClick={onClose}>Abbrechen</Button>
        </>
      }
    >
      <div className="stack">
        <label className="slide-search">
          <Search size={14} />
          <input autoFocus placeholder="Folien suchen …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Foliensatz suchen" />
        </label>
        {own === null ? (
          <div className="loading">Lade Unterlagen …</div>
        ) : (
          <div className="slide-list">
            {scope && first.length > 0 && <div className="label">Unterlagen · {scope.title}</div>}
            {first.map(row)}
            {rest.length > 0 && <div className="label">{first.length ? "Weitere PDFs" : "Alle PDFs"}</div>}
            {rest.map(row)}
            {!first.length && !rest.length && (
              <p className="small muted">{all.length ? "Kein Treffer." : "Noch keine Folien vorhanden. Mit „Importieren“ holst du PDFs oder Bilder aus der Dateien-App oder den Fotos."}</p>
            )}
            {others.length > 0 && (
              <>
                <div className="label">Andere Formate · nur PDFs und Bilder lassen sich neben der Mitschrift zeigen</div>
                {others.map((d) => (
                  <div key={d.id} className="slide-pick is-disabled" aria-disabled="true">
                    <DocIcon ext={d.ext} size={16} />
                    <span className="grow ellipsis">{d.title}</span>
                    <span className="xs muted">{d.ext.toUpperCase()}</span>
                  </div>
                ))}
                {others.some(isSlides) && (
                  <p className="xs muted">
                    PowerPoint/Keynote-Folien: In PowerPoint oder Keynote „Exportieren → PDF“ wählen (auf dem iPad: Teilen → Exportieren → PDF) und das PDF hier
                    mit „PDF importieren“ hinzufügen.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Bilder als Folien: Vor/Zurück durch die Bilder derselben Veranstaltung (nach
 * Namen sortiert) und „Folie übernehmen“ in die Mitschrift daneben.
 */
export function ImageSlideBar({ doc, placementNodeId, bytes, noteId }: { doc: DocumentInfo; placementNodeId: string | null; bytes: Uint8Array | null; noteId?: string }) {
  const dataVersion = useApp((s) => s.dataVersion);
  const [siblings, setSiblings] = useState<DocumentInfo[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .documentsList(placementNodeId ? { kind: "node", id: placementNodeId } : { kind: "unassigned" })
      .then((l) => alive && setSiblings(l.filter((d) => SLIDE_IMAGE_EXT.includes(d.ext) && !d.deleted_at).sort(byName)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [placementNodeId, dataVersion]);
  const idx = siblings.findIndex((d) => d.id === doc.id);
  const go = (d: DocumentInfo | undefined) => {
    if (!d) return;
    const st = useApp.getState();
    if (noteId) {
      st.openSecondary({ type: "document", id: d.id, page: 1 });
      rememberSlides(noteId, d.id, 1, 0);
    } else st.open({ type: "document", id: d.id });
  };
  const take = async () => {
    if (!noteId || !bytes || busy) return;
    setBusy(true);
    try {
      const src = await storeImageFile(new Blob([bytes.slice().buffer as ArrayBuffer], { type: doc.mime }));
      window.dispatchEvent(new CustomEvent<InsertSlideDetail>(INSERT_SLIDE_EVENT, { detail: { noteId, src, page: 0, documentId: doc.id, title: doc.title } }));
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pdf-toolbar image-slide-bar">
      {siblings.length > 1 && idx >= 0 && (
        <>
          <IconButton label="Vorige Folie" disabled={idx <= 0} onClick={() => go(siblings[idx - 1])}>
            <ChevronLeft size={16} />
          </IconButton>
          <span className="small tnum" aria-live="polite">
            {idx + 1} / {siblings.length}
          </span>
          <IconButton label="Nächste Folie" disabled={idx >= siblings.length - 1} onClick={() => go(siblings[idx + 1])}>
            <ChevronRight size={16} />
          </IconButton>
        </>
      )}
      <LensToggle />
      <span className="grow" />
      {noteId && (
        <Button size="sm" variant="primary" icon={<ImagePlus size={14} />} disabled={busy || !bytes} onClick={() => void take()} title="Dieses Bild in die Mitschrift einfügen">
          Folie übernehmen
        </Button>
      )}
    </div>
  );
}
