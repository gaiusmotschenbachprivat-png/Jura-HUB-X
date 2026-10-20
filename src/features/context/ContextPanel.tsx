import { ArrowDownLeft, ArrowUpRight, FileText, Link2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../../api";
import type { DocumentInfo, LinkView } from "../../api/types";
import { ancestors } from "../../lib/tree";
import { reportError, useApp } from "../../state/store";
import { Button, IconButton } from "../../ui/Button";
import { DocIcon } from "../documents/DocumentList";
import { LinkPicker } from "../editor/LinkPicker";
import { KindIcon } from "../navigation/icons";

/** Rechte Seitenleiste: Verknüpfungen, Rückverweise und Unterlagen zum geöffneten Inhalt. */
export function ContextPanel() {
  const view = useApp((s) => s.view);
  const close = useApp((s) => s.toggleContext);
  const entity =
    view.type === "note" || view.type === "node"
      ? { type: "node" as const, id: view.id }
      : view.type === "document"
        ? { type: "document" as const, id: view.id }
        : view.type === "knowledge"
          ? { type: "knowledge" as const, id: view.id }
          : null;

  return (
    <aside className="context" aria-label="Kontext">
      <div className="context-head">
        <span className="label">Kontext</span>
        <IconButton label="Kontextbereich schließen" onClick={close}>
          <X size={15} />
        </IconButton>
      </div>
      <div className="context-scroll">
        {entity ? <EntityContext key={entity.id} entity={entity} isNote={view.type === "note"} /> : <p className="muted small context-pad">Öffne eine Notiz, eine Veranstaltung oder ein Dokument, um Verknüpfungen und Unterlagen zu sehen.</p>}
      </div>
    </aside>
  );
}

function EntityContext({ entity, isNote }: { entity: { type: "node" | "document" | "knowledge"; id: string }; isNote: boolean }) {
  const [links, setLinks] = useState<LinkView[]>([]);
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [picker, setPicker] = useState(false);
  const nodes = useApp((s) => s.nodes);
  const dataVersion = useApp((s) => s.dataVersion);
  const saveStatus = useApp((s) => s.saveStatus);
  const open = useApp((s) => s.open);
  const openSecondary = useApp((s) => s.openSecondary);
  const secondary = useApp((s) => s.secondary);
  const bump = useApp((s) => s.bump);

  const load = useCallback(() => {
    api.linksFor(entity.type, entity.id).then(setLinks).catch(() => {});
  }, [entity.type, entity.id]);
  // Nach dem Speichern neu laden: interne Links im Text werden dabei erfasst.
  useEffect(load, [load, dataVersion, saveStatus === "saved"]);

  // Unterlagen der nächstgelegenen Veranstaltung / des Termins
  const scopeNode = useMemo(() => {
    if (entity.type !== "node") return null;
    const chain = [entity.id, ...ancestors(nodes, entity.id)];
    return chain.map((id) => nodes.find((n) => n.id === id)).find((n) => n && (n.kind === "session" || n.kind === "course" || n.kind === "module")) ?? null;
  }, [entity, nodes]);
  useEffect(() => {
    if (!scopeNode) return setDocs([]);
    api.documentsList({ kind: "subtree", id: scopeNode.id }).then(setDocs).catch(() => {});
  }, [scopeNode, dataVersion]);

  const outgoing = links.filter((l) => l.direction === "outgoing");
  const incoming = links.filter((l) => l.direction === "incoming");

  const openLink = (l: LinkView) => {
    if (l.other_type === "document") {
      if (isNote) openSecondary({ type: "document", id: l.other_id, page: l.anchor?.page });
      else open({ type: "document", id: l.other_id, page: l.anchor?.page }, { title: l.other_title });
    } else if (l.other_type === "knowledge") {
      open({ type: "knowledge", id: l.other_id }, { title: l.other_title });
    } else {
      open(l.other_kind === "note" ? { type: "note", id: l.other_id } : { type: "node", id: l.other_id }, { title: l.other_title });
    }
  };

  const row = (l: LinkView) => (
    <div key={l.id} className={`ctx-row ${l.other_missing ? "is-missing" : ""}`}>
      <button className="ctx-main" onClick={() => !l.other_missing && openLink(l)} title={l.other_path}>
        <span className="ctx-icon">{l.other_type === "document" ? <FileText size={14} /> : l.other_kind ? <KindIcon kind={l.other_kind} size={14} /> : null}</span>
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="ellipsis block">
            {l.other_title}
            {l.anchor?.page ? <span className="muted"> · S. {l.anchor.page}</span> : null}
          </span>
          <span className="xs muted ellipsis block">{l.kind === "mention" ? "im Text verlinkt" : l.other_path || " "}</span>
        </span>
      </button>
      {l.kind !== "mention" && (
        <IconButton
          label="Verknüpfung entfernen"
          className="ctx-remove"
          onClick={async () => {
            await api.linkRemove(l.id).catch(reportError);
            load();
          }}
        >
          <X size={13} />
        </IconButton>
      )}
    </div>
  );

  return (
    <div className="context-pad stack">
      {secondary?.type === "document" && isNote && (
        <div className="hint-card small">Die geöffnete Folie kannst du mit „Seite verknüpfen“ dieser Notiz zuordnen oder mit „Folie übernehmen“ als Bild einfügen. Die Verknüpfung bleibt dauerhaft erhalten.</div>
      )}
      <section>
        <div className="row">
          <h4 className="label grow">
            <ArrowUpRight size={12} /> Verknüpft mit
          </h4>
          <Button size="sm" variant="ghost" icon={<Link2 size={13} />} onClick={() => setPicker(true)}>
            Hinzufügen
          </Button>
        </div>
        {outgoing.length ? outgoing.map(row) : <p className="muted xs">Noch keine Verknüpfungen.</p>}
      </section>
      <section>
        <h4 className="label">
          <ArrowDownLeft size={12} /> {entity.type === "knowledge" ? "Verwendet in (Rückverweise)" : "Verwendet in"}
        </h4>
        {incoming.length ? incoming.map(row) : <p className="muted xs">Kein anderer Inhalt verweist hierher.</p>}
      </section>
      {scopeNode && (
        <section>
          <h4 className="label ellipsis">Unterlagen · {scopeNode.title}</h4>
          {docs.length ? (
            docs.slice(0, 30).map((d) => (
              <div key={d.id} className="ctx-row">
                <button className="ctx-main" onClick={() => (isNote ? openSecondary({ type: "document", id: d.id, page: 1 }) : open({ type: "document", id: d.id }, { title: d.title }))}>
                  <span className="ctx-icon">
                    <DocIcon ext={d.ext} size={14} />
                  </span>
                  <span className="ellipsis grow">{d.title}</span>
                </button>
              </div>
            ))
          ) : (
            <p className="muted xs">Keine Unterlagen zugeordnet.</p>
          )}
          {isNote && docs.length > 0 && <p className="xs muted">Ein Klick öffnet die Unterlage neben der Notiz.</p>}
        </section>
      )}
      {picker && (
        <LinkPicker
          excludeId={entity.id}
          onClose={() => setPicker(false)}
          onPick={async (t) => {
            setPicker(false);
            try {
              await api.linkAdd({
                source_type: entity.type,
                source_id: entity.id,
                target_type: t.type,
                target_id: t.id,
                kind: t.page ? "page" : "related",
                anchor: t.page ? { page: t.page } : undefined,
              });
              load();
              bump();
            } catch (e) {
              reportError(e);
            }
          }}
        />
      )}
    </div>
  );
}
