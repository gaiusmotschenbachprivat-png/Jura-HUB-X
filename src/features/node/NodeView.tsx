import { Archive, ArchiveRestore, FilePlus2, FileUp, FileInput, Share2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api, errorMessage } from "../../api";
import type { DocumentInfo, NodeDetail, NodeKind, NodeMeta } from "../../api/types";
import { KIND_LABEL, KIND_LABEL_PLURAL } from "../../lib/kinds";
import { compareNodes, formatDateDe, NOTE_TYPES, noteTypeOf } from "../../lib/noteTypes";
import { formatRelative } from "../../lib/format";
import { reportError, useApp } from "../../state/store";
import { Button } from "../../ui/Button";
import { useMenu } from "../../ui/Menu";
import { AreaDot, EmptyState } from "../../ui/misc";
import { DocumentList } from "../documents/DocumentList";
import { useImport } from "../documents/ImportDialog";
import { importFileAsNote } from "../editor/exportImport";
import { createNode, openNode, renameNode } from "../navigation/actions";
import { NewNodeDialog, type NewNodeRequest } from "../navigation/NewNodeDialog";
import { NodeTasks } from "../planning/NodeTasks";
import { KindIcon, NodeIcon, NoteTypeIcon } from "../navigation/icons";

const FIELDS: Record<string, { key: keyof NodeMeta; label: string; placeholder?: string; multiline?: boolean }[]> = {
  semester: [{ key: "description", label: "Notiz zum Semester", multiline: true }],
  module: [
    { key: "ects", label: "Leistungspunkte", placeholder: "z. B. 6 ECTS" },
    { key: "description", label: "Beschreibung", multiline: true },
    { key: "goals", label: "Lernziele", multiline: true },
  ],
  course: [
    { key: "lecturer", label: "Dozent/in" },
    { key: "weekday", label: "Wochentag (für den Stundenplan)", placeholder: "z. B. Mo, Do" },
    { key: "time", label: "Uhrzeit", placeholder: "z. B. 10:15–11:45" },
    { key: "room", label: "Ort", placeholder: "z. B. Hörsaal H 24" },
    { key: "description", label: "Beschreibung", multiline: true },
    { key: "goals", label: "Lernziele", multiline: true },
  ],
  session: [
    { key: "date", label: "Datum", placeholder: "TT.MM.JJJJ" },
    { key: "description", label: "Inhalt / Stichworte", multiline: true },
  ],
  topic: [{ key: "description", label: "Beschreibung", multiline: true }],
  folder: [{ key: "description", label: "Beschreibung", multiline: true }],
};

export function NodeView({ id }: { id: string }) {
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nodes = useApp((s) => s.nodes);
  const areas = useApp((s) => s.areas);
  const dataVersion = useApp((s) => s.dataVersion);
  const reloadNodes = useApp((s) => s.reloadNodes);
  const rememberTitle = useApp((s) => s.rememberTitle);
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [includeSub, setIncludeSub] = useState(true);
  const [title, setTitle] = useState("");
  const [meta, setMeta] = useState<NodeMeta>({});
  const menu = useMenu();
  const startImport = useImport();
  const treeSort = useApp((s) => s.treeSort);
  const [newReq, setNewReq] = useState<NewNodeRequest | null>(null);

  const nodeFromTree = nodes.find((n) => n.id === id);
  useEffect(() => {
    let alive = true;
    api
      .nodeGet(id)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setTitle(d.node.title);
        setMeta(d.node.meta ?? {});
        rememberTitle({ type: "node", id }, d.node.title);
      })
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [id, nodeFromTree?.title, nodeFromTree?.archived_at, rememberTitle]);

  useEffect(() => {
    api
      .documentsList(includeSub ? { kind: "subtree", id } : { kind: "node", id })
      .then(setDocs)
      .catch(reportError);
  }, [id, includeSub, dataVersion]);

  const children = useMemo(() => nodes.filter((n) => n.parent_id === id).sort(compareNodes(treeSort)), [nodes, id, treeSort]);

  if (error) return <EmptyState title="Nicht verfügbar">{error}</EmptyState>;
  if (!detail) return <div className="loading">Lade …</div>;
  const node = detail.node;
  const area = areas.find((a) => a.id === node.area_id);
  const fields = FIELDS[node.kind] ?? [];

  const saveMeta = async (next: NodeMeta) => {
    try {
      await api.nodeUpdate(id, { meta: next });
      // Baum aktualisieren: neue Vorlesungen übernehmen z. B. Dozent/in der Veranstaltung
      await reloadNodes();
    } catch (e) {
      reportError(e);
    }
  };
  const lectureHost = node.kind === "course" || node.kind === "session";
  const newIn = (extra: Partial<NewNodeRequest> = {}) => setNewReq({ parentId: id, areaId: node.area_id, ...extra });

  // Struktur nach Art, Notizen nach Schreibart (Vorlesungen chronologisch)
  const grouped = [
    ...(["semester", "module", "course", "session", "topic", "folder"] as NodeKind[]).map((k) => ({
      key: k,
      label: KIND_LABEL_PLURAL[k],
      icon: <KindIcon kind={k} size={14} />,
      items: children.filter((c) => c.kind === k),
    })),
    ...NOTE_TYPES.map((t) => ({
      key: t.id,
      label: t.plural,
      icon: <NoteTypeIcon type={t.id} size={14} />,
      items: children.filter((c) => noteTypeOf(c) === t.id),
    })),
  ].filter((g) => g.items.length);

  const otherAreas = areas.filter((a) => a.id !== node.area_id && !detail.also_in_areas.includes(a.id) && !a.archived_at);

  return (
    <div className="page">
      <header className="page-head">
        <div className="small muted row">
          <KindIcon kind={node.kind} size={14} />
          <span>{KIND_LABEL[node.kind]}</span>
          {area && (
            <>
              <span>·</span>
              <AreaDot color={area.color} />
              <span>{area.name}</span>
            </>
          )}
          {detail.path && <span className="ellipsis">· {detail.path}</span>}
          {node.archived_at && <span className="pill">Archiviert</span>}
        </div>
        <input
          className="page-title"
          value={title}
          aria-label="Titel"
          maxLength={300}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title.trim() !== node.title && void renameNode(id, title.trim())}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <div className="row wrap">
          {lectureHost && (
            <Button variant="primary" icon={<NoteTypeIcon type="vorlesung" size={15} plain />} onClick={() => newIn({ noteType: "vorlesung" })}>
              Vorlesung
            </Button>
          )}
          <Button
            variant={lectureHost ? undefined : "primary"}
            icon={<NoteTypeIcon type="notiz" size={15} plain />}
            onClick={() => void createNode({ areaId: node.area_id, parentId: id, kind: "note", title: "Neue Notiz", meta: { noteType: "notiz" } })}
          >
            Notiz
          </Button>
          <Button icon={<FilePlus2 size={15} />} onClick={() => newIn()}>
            Neu …
          </Button>
          <Button icon={<FileUp size={15} />} onClick={() => void startImport({ nodeId: id })}>
            Dokumente importieren
          </Button>
          <Button icon={<FileInput size={15} />} onClick={() => void importFileAsNote({ areaId: node.area_id, parentId: id })}>
            Word-Datei als Notiz
          </Button>
          <Button
            variant="ghost"
            icon={node.archived_at ? <ArchiveRestore size={15} /> : <Archive size={15} />}
            onClick={async () => {
              try {
                await api.nodeSetArchived(id, !node.archived_at);
                await reloadNodes();
              } catch (e) {
                reportError(e);
              }
            }}
          >
            {node.archived_at ? "Wieder aktivieren" : "Archivieren"}
          </Button>
        </div>
      </header>

      <div className="page-grid">
        <div className="page-main">
          {grouped.length === 0 ? (
            <div className="hint-card">
              <p>
                Noch leer. Lege {node.kind === "course" ? "Vorlesungstermine, Themen oder Notizen" : "Unterelemente oder Notizen"} an oder importiere
                Folien und Skripte.
              </p>
            </div>
          ) : (
            grouped.map((g) => (
              <section key={g.key} className="section">
                <h3 className="label row">
                  {g.icon} {g.label} <span className="muted">· {g.items.length}</span>
                </h3>
                <div className="list">
                  {g.items.map((c) => (
                    <button key={c.id} className={`list-row ${c.archived_at ? "is-archived" : ""}`} onClick={() => openNode(c)}>
                      <NodeIcon node={c} />
                      <span className="grow ellipsis">{c.title}</span>
                      {typeof c.meta?.date === "string" && c.meta.date && <span className="muted small tnum">{formatDateDe(c.meta.date)}</span>}
                      <span className="muted xs nowrap">{formatRelative(c.updated_at)}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}

          <section className="section">
            <div className="row wrap section-head">
              <h3 className="label grow">Unterlagen</h3>
              <label className="small muted row nowrap">
                <input type="checkbox" checked={includeSub} onChange={(e) => setIncludeSub(e.target.checked)} /> inkl. Unterelemente
              </label>
            </div>
            <DocumentList docs={docs} placementNodeId={includeSub ? undefined : id} emptyText="Noch keine Unterlagen zugeordnet." />
          </section>
        </div>

        <aside className="page-side">
          <NodeTasks nodeId={id} />
          {fields.length > 0 && (
            <section className="section">
              <h3 className="label">Angaben</h3>
              <div className="stack">
                {fields.map((f) => (
                  <label key={String(f.key)} className="field">
                    <span className="field-label">{f.label}</span>
                    {f.multiline ? (
                      <textarea
                        rows={3}
                        value={(meta[f.key] as string) ?? ""}
                        placeholder={f.placeholder}
                        onChange={(e) => setMeta({ ...meta, [f.key]: e.target.value })}
                        onBlur={() => void saveMeta(meta)}
                      />
                    ) : (
                      <input
                        value={(meta[f.key] as string) ?? ""}
                        placeholder={f.placeholder}
                        onChange={(e) => setMeta({ ...meta, [f.key]: e.target.value })}
                        onBlur={() => void saveMeta(meta)}
                      />
                    )}
                  </label>
                ))}
              </div>
            </section>
          )}
          <section className="section">
            <h3 className="label">Auch relevant für</h3>
            <div className="chips">
              {detail.also_in_areas.map((aid) => {
                const a = areas.find((x) => x.id === aid);
                if (!a) return null;
                return (
                  <span key={aid} className="chip">
                    <AreaDot color={a.color} /> {a.name}
                    <button
                      aria-label={`Aus ${a.name} entfernen`}
                      onClick={async () => {
                        await api.nodeAreaRefRemove(id, aid).catch(reportError);
                        setDetail({ ...detail, also_in_areas: detail.also_in_areas.filter((x) => x !== aid) });
                      }}
                    >
                      <X size={12} />
                    </button>
                  </span>
                );
              })}
              {otherAreas.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Share2 size={13} />}
                  onClick={(e) =>
                    menu.openBelow(
                      e.currentTarget,
                      otherAreas.map((a) => ({
                        label: a.name,
                        icon: <AreaDot color={a.color} />,
                        onSelect: async () => {
                          await api.nodeAreaRefAdd(id, a.id).catch(reportError);
                          setDetail({ ...detail, also_in_areas: [...detail.also_in_areas, a.id] });
                        },
                      })),
                    )
                  }
                >
                  Bereich hinzufügen
                </Button>
              )}
              {detail.also_in_areas.length === 0 && otherAreas.length === 0 && <span className="muted small">–</span>}
            </div>
            <p className="xs muted">Der Inhalt erscheint dann auch dort, ohne Kopie.</p>
          </section>
        </aside>
      </div>
      {menu.el}
      {newReq && <NewNodeDialog req={newReq} onClose={() => setNewReq(null)} />}
    </div>
  );
}
