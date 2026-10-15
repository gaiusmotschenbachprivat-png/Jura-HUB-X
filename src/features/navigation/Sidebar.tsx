import {
  ArrowUpDown,
  Check,
  Scale,
  Archive,
  CalendarCheck,
  CalendarDays,
  GraduationCap,
  ArchiveRestore,
  Copy,
  FilePlus2,
  FileStack,
  FolderPlus,
  Home,
  Pencil,
  Plus,
  Search,
  Settings,
  Share2,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../api";
import type { NodeKind, StudyNode } from "../../api/types";
import { KIND_LABEL, SUGGESTED_CHILDREN } from "../../lib/kinds";
import { useCardStats } from "../learn/CardsView";
import { SORT_LABEL, type SortMode } from "../../lib/noteTypes";
import { buildTree } from "../../lib/tree";
import { reportError, useApp, viewId } from "../../state/store";
import { IconButton } from "../../ui/Button";
import { useMenu, type MenuItem } from "../../ui/Menu";
import { AreaDot, MOD } from "../../ui/misc";
import { createNode, defaultTitle, openNode, renameNode, trashNode } from "./actions";
import { KindIcon, NodeIcon, NoteTypeIcon } from "./icons";
import { NewNodeDialog, type NewNodeRequest } from "./NewNodeDialog";
import { Tree } from "./Tree";
import { TYPE_LABEL_PLURAL } from "../knowledge/meta";

export function Sidebar() {
  const areas = useApp((s) => s.areas);
  const areaId = useApp((s) => s.areaId);
  const selectArea = useApp((s) => s.selectArea);
  const nodes = useApp((s) => s.nodes);
  const areaRefs = useApp((s) => s.areaRefs);
  const view = useApp((s) => s.view);
  const open = useApp((s) => s.open);
  const setPalette = useApp((s) => s.setPalette);
  const showArchived = useApp((s) => s.showArchived);
  const treeSort = useApp((s) => s.treeSort);
  const setPref = useApp((s) => s.setPref);
  const reload = useApp((s) => s.reloadNodes);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newReq, setNewReq] = useState<NewNodeRequest | null>(null);
  const menu = useMenu();

  const activeId = viewId(view);
  const stats = useCardStats();
  const [knowledgeType, setKnowledgeType] = useState<string | null>(null);
  useEffect(() => {
    if (view.type !== "knowledge") return setKnowledgeType(null);
    api.knowledgeGet(view.id).then((k) => setKnowledgeType(k.type)).catch(() => {});
  }, [view]);
  const visibleAreas = areas.filter((a) => !a.archived_at);
  const archivedCount = nodes.filter((n) => n.archived_at).length;

  const groups = useMemo(() => {
    const tree = buildTree(nodes, { showArchived, sort: treeSort });
    if (areaId !== "all") return [{ area: null, items: tree }];
    return visibleAreas.map((a) => ({ area: a, items: tree.filter((t) => t.node.area_id === a.id) }));
  }, [nodes, showArchived, areaId, visibleAreas, treeSort]);

  /** Ort für „Neu …“: aktuell geöffnetes Element bzw. Ordner der geöffneten Notiz. */
  const contextParent = (): StudyNode | null => {
    const id = viewId(view);
    const n = id ? nodes.find((x) => x.id === id) : undefined;
    if (!n) return null;
    if (n.kind !== "note") return n;
    return n.parent_id ? (nodes.find((x) => x.id === n.parent_id) ?? null) : null;
  };
  const openNew = (extra: Partial<NewNodeRequest> = {}) => {
    const p = contextParent();
    setNewReq({ parentId: p?.id ?? null, areaId: p?.area_id ?? currentArea, ...extra });
  };
  const sortMenu = (el: HTMLElement) =>
    menu.openBelow(
      el,
      (Object.keys(SORT_LABEL) as SortMode[]).map((m) => ({
        label: SORT_LABEL[m],
        icon: treeSort === m ? <Check size={14} /> : <span style={{ width: 14 }} />,
        onSelect: () => setPref("treeSort", m),
      })),
    );

  const currentArea = areaId === "all" ? null : areaId;

  const quickCreate = (parent: StudyNode | null, kind: NodeKind, aId?: string) => {
    const target = parent?.area_id ?? aId ?? currentArea;
    if (!target) return setNewReq({ parentId: parent?.id ?? null, areaId: null, kind });
    void createNode({ areaId: target, parentId: parent?.id ?? null, kind, title: defaultTitle(kind) }).then((n) => {
      if (n && kind !== "note") setRenaming(n.id);
    });
  };

  const nodeMenu = (e: React.MouseEvent, n: StudyNode) => {
    const kids = SUGGESTED_CHILDREN[n.kind].filter((k) => k !== "note");
    const others = areas.filter((a) => a.id !== n.area_id && !a.archived_at);
    // Notizen liegen neben der angeklickten Notiz, sonst im angeklickten Element
    const host = n.kind === "note" ? (n.parent_id ? nodes.find((x) => x.id === n.parent_id) : undefined) : n;
    const req = { parentId: host?.id ?? null, areaId: n.area_id };
    const items: MenuItem[] = [
      { label: "Vorlesung hinzufügen …", icon: <NoteTypeIcon type="vorlesung" size={14} />, onSelect: () => setNewReq({ ...req, noteType: "vorlesung" }) },
      { label: "Notiz hinzufügen", icon: <NoteTypeIcon type="notiz" size={14} />, onSelect: () => (host ? quickCreate(host, "note") : quickCreate(null, "note", n.area_id)) },
      ...(n.kind === "note"
        ? []
        : kids.slice(0, 3).map((k) => ({
            label: `${KIND_LABEL[k]} hinzufügen`,
            icon: <KindIcon kind={k} size={14} />,
            onSelect: () => quickCreate(n, k),
          }))),
      { label: "Weitere (Fall, Zusammenfassung …)", icon: <Plus size={14} />, onSelect: () => setNewReq(req) },
      { separator: true, label: "" },
      { label: "Umbenennen", icon: <Pencil size={14} />, shortcut: "F2", onSelect: () => setRenaming(n.id) },
      {
        label: n.archived_at ? "Wieder aktivieren" : "Archivieren",
        icon: n.archived_at ? <ArchiveRestore size={14} /> : <Archive size={14} />,
        onSelect: async () => {
          try {
            await api.nodeSetArchived(n.id, !n.archived_at);
            await reload();
          } catch (err) {
            reportError(err);
          }
        },
      },
      ...others.map((a) => ({
        label: `Auch in „${a.name}“ zeigen`,
        icon: <Share2 size={14} />,
        onSelect: async () => {
          try {
            await api.nodeAreaRefAdd(n.id, a.id);
            useApp.getState().toast(`„${n.title}“ erscheint jetzt auch in „${a.name}“.`, "success");
          } catch (err) {
            reportError(err);
          }
        },
      })),
      { label: "Link kopieren", icon: <Copy size={14} />, onSelect: () => void navigator.clipboard?.writeText(`studium:node/${n.id}`) },
      { separator: true, label: "" },
      { label: "In den Papierkorb", icon: <Trash2 size={14} />, danger: true, onSelect: () => void trashNode(n) },
    ];
    menu.openAt(e, items);
  };

  const addMenu = (target: HTMLElement, aId?: string) => {
    const kinds: NodeKind[] = ["semester", "module", "course", "folder", "note"];
    menu.openBelow(
      target,
      [
        ...kinds.map((k) => ({ label: KIND_LABEL[k], icon: <KindIcon kind={k} size={14} />, onSelect: () => quickCreate(null, k, aId) })),
        { separator: true, label: "" },
        { label: "Mehr …", icon: <Plus size={14} />, onSelect: () => setNewReq({ parentId: null, areaId: aId ?? currentArea }) },
      ],
    );
  };

  return (
    <nav className="sidebar" aria-label="Navigation">
      <div className="area-switch" role="tablist" aria-label="Studienbereich">
        {visibleAreas.map((a, i) => (
          <button
            key={a.id}
            role="tab"
            aria-selected={areaId === a.id}
            className={`area-tab ${areaId === a.id ? "is-active" : ""}`}
            onClick={() => void selectArea(a.id)}
            title={`${a.name} (${MOD}+${i + 1})`}
            style={{ "--area": a.color } as React.CSSProperties}
          >
            <AreaDot color={a.color} />
            <span className="ellipsis">{a.name}</span>
          </button>
        ))}
        <button
          role="tab"
          aria-selected={areaId === "all"}
          className={`area-tab ${areaId === "all" ? "is-active" : ""}`}
          onClick={() => void selectArea("all")}
          title={`Alle Bereiche (${MOD}+0)`}
        >
          <span className="area-dot is-all" aria-hidden />
          <span>Alle Bereiche</span>
        </button>
      </div>

      <div className="side-actions">
        <button className="side-search" onClick={() => setPalette(true)}>
          <Search size={15} />
          <span className="grow">Suchen</span>
          <kbd>{MOD} K</kbd>
        </button>
        <IconButton label="Sortierung" onClick={(e) => sortMenu(e.currentTarget)}>
          <ArrowUpDown size={16} />
        </IconButton>
        <IconButton label="Neu: Vorlesung, Notiz, Ordner …" onClick={() => openNew()}>
          <FilePlus2 size={16} />
        </IconButton>
      </div>

      <div className="side-scroll">
      <div className="side-nav">
          <NavItem icon={<Home size={15} />} label="Übersicht" active={view.type === "dashboard"} onClick={() => open({ type: "dashboard" })} />
          <NavItem icon={<FileStack size={15} />} label="Dokumente" active={view.type === "documents"} onClick={() => open({ type: "documents" })} />
          <NavItem
            icon={<GraduationCap size={15} />}
            label="Karteikarten"
            badge={stats?.due_now || undefined}
            active={view.type === "cards" || view.type === "learn"}
            onClick={() => open({ type: "cards" })}
          />
          <NavItem icon={<CalendarCheck size={15} />} label="Aufgaben & Prüfungen" active={view.type === "planning"} onClick={() => open({ type: "planning" })} />
          <NavItem icon={<CalendarDays size={15} />} label="Stundenplan" active={view.type === "timetable"} onClick={() => open({ type: "timetable" })} />
          <NavItem icon={<Scale size={15} />} label="KI-Assistent" active={view.type === "assistant"} onClick={() => open({ type: "assistant" })} />
          <div className="side-sub label">Wissen</div>
          {(["definition", "schema", "case", "citation", "quelle"] as const).map((k) => (
            <NavItem
              key={k}
              icon={<KindIcon kind={k} />}
              label={k === "definition" ? "Glossar" : TYPE_LABEL_PLURAL[k]}
              active={(view.type === "knowledge-list" && view.kind === k) || (view.type === "knowledge" && knowledgeType === k)}
              onClick={() => open({ type: "knowledge-list", kind: k })}
            />
          ))}
        </div>
        {groups.map(({ area, items }) => (
          <section key={area?.id ?? "tree"} className="side-section">
            <div className="side-head">
              <span className="label ellipsis">{area ? area.name : "Studienstruktur"}</span>
              <IconButton label={`Neu in ${area ? area.name : "der Struktur"}`} className="side-add" onClick={(e) => addMenu(e.currentTarget, area?.id)}>
                <FolderPlus size={14} />
              </IconButton>
            </div>
            {items.length === 0 ? (
              <button className="side-empty" onClick={() => quickCreate(null, "semester", area?.id)}>
                + Semester anlegen
              </button>
            ) : (
              <Tree
                items={items}
                activeId={activeId}
                renamingId={renaming}
                showAreaDots={false}
                onOpen={openNode}
                onContextMenu={nodeMenu}
                onRename={(id, title) => {
                  if (title === "") return setRenaming(id);
                  setRenaming(null);
                  if (title) void renameNode(id, title);
                }}
              />
            )}
          </section>
        ))}

        {areaRefs.length > 0 && (
          <section className="side-section">
            <div className="side-head">
              <span className="label">Auch relevant</span>
            </div>
            {areaRefs.map((n) => (
              <div
                key={n.id}
                className={`tree-row ${activeId === n.id ? "is-active" : ""}`}
                style={{ paddingLeft: 22 }}
                tabIndex={0}
                onClick={() => openNode(n)}
                onKeyDown={(e) => e.key === "Enter" && openNode(n)}
              >
                <span className="tree-icon">
                  <NodeIcon node={n} />
                </span>
                <span className="tree-title ellipsis">{n.title}</span>
                <AreaDot color={areas.find((a) => a.id === n.area_id)?.color ?? "#999"} size={6} />
              </div>
            ))}
          </section>
        )}

        {(archivedCount > 0 || showArchived) && (
          <button className="side-toggle" onClick={() => setPref("showArchived", !showArchived)}>
            {showArchived ? "Archivierte ausblenden" : `Archivierte zeigen (${archivedCount})`}
          </button>
        )}
      </div>

      <div className="side-foot">
        <NavItem icon={<Trash2 size={15} />} label="Papierkorb" active={view.type === "trash"} onClick={() => open({ type: "trash" })} />
        <NavItem
          icon={<Settings size={15} />}
          label="Einstellungen & Backup"
          active={view.type === "settings"}
          onClick={() => open({ type: "settings" })}
        />
      </div>

      {menu.el}
      {newReq && <NewNodeDialog req={newReq} onClose={() => setNewReq(null)} />}
    </nav>
  );
}

function NavItem({ icon, label, active, onClick, badge }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void; badge?: number }) {
  return (
    <button className={`nav-item ${active ? "is-active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}>
      {icon}
      <span className="grow">{label}</span>
      {badge ? <span className="nav-badge tnum" title="fällige Karten">{badge}</span> : null}
    </button>
  );
}
