/**
 * Folie neben Mitschrift: Die Vorlesungsfolien öffnen sich neben (oder auf dem
 * iPad hochkant über) der Notiz. Die Notiz merkt sich Foliensatz und Seite,
 * sodass „Folien“ beim nächsten Mal an derselben Stelle weitermacht.
 */
import { FileUp, Presentation, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../api";
import type { DocumentInfo, StudyNode } from "../../api/types";
import { ancestors } from "../../lib/tree";
import { reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { DocIcon } from "./DocumentList";
import { startImport } from "./ImportDialog";

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
  const saved = slidesOf(node);
  const isOpen = secondary?.type === "document";

  const onClick = async () => {
    const st = useApp.getState();
    if (isOpen) return st.openSecondary(null);
    if (saved) {
      const ok = await api.documentGet(saved.document_id).then(
        (d) => !d.document.deleted_at && d.document.file_present,
        () => false,
      );
      if (ok) return st.openSecondary({ type: "document", id: saved.document_id, page: saved.page });
    }
    setPicking(true);
  };

  return (
    <>
      <Button
        size="sm"
        variant={isOpen ? "primary" : "secondary"}
        icon={<Presentation size={14} />}
        onClick={() => void onClick()}
        onContextMenu={(e) => {
          e.preventDefault();
          setPicking(true);
        }}
        title={isOpen ? "Folien schließen" : saved ? `Folien öffnen (S. ${saved.page})` : "Folien neben der Mitschrift öffnen"}
        aria-pressed={isOpen}
      >
        Folien
      </Button>
      {picking && (
        <SlidePicker
          node={node}
          onClose={() => setPicking(false)}
          onPick={(d) => {
            setPicking(false);
            const page = saved?.document_id === d.id ? saved.page : 1;
            useApp.getState().openSecondary({ type: "document", id: d.id, page });
            rememberSlides(node.id, d.id, page, 0);
          }}
        />
      )}
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
    const pdf = (l: DocumentInfo[]) => l.filter((d) => d.ext === "pdf" && !d.deleted_at);
    (scope ? api.documentsList({ kind: "subtree", id: scope.id }) : Promise.resolve([]))
      .then((l) => setOwn(pdf(l)))
      .catch(() => setOwn([]));
    api
      .documentsList({ kind: "all" })
      .then((l) => {
        setAll(pdf(l));
        // andere Formate zeigen, damit klar ist, warum sie nicht wählbar sind
        setOther(l.filter((d) => d.ext !== "pdf" && !d.deleted_at));
      })
      .catch(reportError);
  }, [scope, dataVersion]);
  const t = q.trim().toLowerCase();
  const match = (d: DocumentInfo) => !t || d.title.toLowerCase().includes(t) || d.original_name.toLowerCase().includes(t);
  const ownIds = new Set((own ?? []).map((d) => d.id));
  const first = (own ?? []).filter(match);
  const rest = all.filter((d) => !ownIds.has(d.id) && match(d));
  const others = other.filter(match);
  const isSlides = (d: DocumentInfo) => ["pptx", "ppt", "key", "odp"].includes(d.ext);
  const row = (d: DocumentInfo) => (
    <button key={d.id} className="slide-pick" onClick={() => onPick(d)}>
      <DocIcon ext={d.ext} size={16} />
      <span className="grow ellipsis">{d.title}</span>
      {d.page_count ? <span className="xs muted tnum">{d.page_count} S.</span> : null}
    </button>
  );
  return (
    <Dialog title="Folien auswählen" onClose={onClose} width={520} footer={
        <>
          <Button icon={<FileUp size={14} />} onClick={() => void startImport({ nodeId: scope?.id ?? node.parent_id })}>
            PDF importieren
          </Button>
          <span className="grow" />
          <Button onClick={onClose}>Abbrechen</Button>
        </>
      }
    >
      <div className="stack">
        <label className="slide-search">
          <Search size={14} />
          <input autoFocus placeholder="Foliensatz suchen …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Foliensatz suchen" />
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
              <p className="small muted">{all.length ? "Kein Treffer." : "Noch keine PDFs vorhanden. Mit „PDF importieren“ holst du die Folien aus der Dateien-App."}</p>
            )}
            {others.length > 0 && (
              <>
                <div className="label">Andere Formate · nur PDFs lassen sich neben der Mitschrift zeigen</div>
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
