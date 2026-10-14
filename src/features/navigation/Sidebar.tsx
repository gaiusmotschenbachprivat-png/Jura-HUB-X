import {
  Archive,
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
import { useMemo, useState } from "react";

import { api } from "../../api";
import type { NodeKind, StudyNode } from "../../api/types";
import { KIND_LABEL, SUGGESTED_CHILDREN } from "../../lib/kinds";
import { buildTree } from "../../lib/tree";
import { reportError, useApp } from "../../state/store";
import { IconButton } from "../../ui/Button";
import { useMenu, type MenuItem } from "../../ui/Menu";
import { AreaDot, MOD } from "../../ui/misc";
import { createNode, defaultTitle, openNode, renameNode, trashNode } from "./actions";
import { KindIcon } from "./icons";
import { NewNodeDialog, type NewNodeRequest } from "./NewNodeDialog";
import { Tree } from "./Tree";

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
  const setPref = useApp((s) => s.setPref);
  const reload = useApp((s) => s.reloadNodes);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newReq, setNewReq] = useState<NewNodeRequest | null>(null);
  const menu = useMenu();

  const activeId = "id" in view ? view.id : null;
  const visibleAreas = areas.filter((a) => !a.archived_at);
  const archivedCount = nodes.filter((n) => n.archived_at).length;

  const groups = useMemo(() => {
    const tree = buildTree(nodes, { showArchived });
    if (areaId !== "all") return [{ area: null, items: tree }];
    return visibleAreas.map((a) => ({ area: a, items: tree.filter((t) => t.node.area_id === a.id) }));
  }, [nodes, showArchived, areaId, visibleAreas]);

  const currentArea = areaId === "all" ? null : areaId;

  const quickCreate = (parent: StudyNode | null, kind: NodeKind, aId?: string) => {
    const target = parent?.area_id ?? aId ?? currentArea;
    if (!target) return setNewReq({ parentId: parent?.id ?? null, areaId: null, kind });
    void createNode({ areaId: target, parentId: parent?.id ?? null, kind, title: defaultTitle(kind) }).then((n) => {
      if (n && kind !== "note") setRenaming(n.id);
    });
  };

  const nodeMenu = (e: React.MouseEvent, n: StudyNode) => {
    const kids = SUGGESTED_CHILDREN[n.kind];
    const others = areas.filter((a) => a.id !== n.area_id && !a.archived_at);
    const items: MenuItem[] = [
      ...kids.slice(0, 4).map((k) => ({
        label: `${KIND_LABEL[k]} hinzufügen`,
        icon: <KindIcon kind={k} size={14} />,
        onSelect: () => quickCreate(n, k),
      })),
      { label: "Anderes Element …", icon: <Plus size={14} />, onSelect: () => setNewReq({ parentId: n.id, areaId: n.area_id }) },
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
      kinds.map((k) => ({ label: KIND_LABEL[k], icon: <KindIcon kind={k} size={14} />, onSelect: () => quickCreate(null, k, aId) })),
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
        <IconButton label={`Neue Notiz (${MOD}+N)`} onClick={() => quickCreate(null, "note")}>
          <FilePlus2 size={16} />
        </IconButton>
      </div>

      <div className="side-nav">
        <NavItem icon={<Home size={15} />} label="Übersicht" active={view.type === "dashboard"} onClick={() => open({ type: "dashboard" })} />
        <NavItem icon={<FileStack size={15} />} label="Dokumente" active={view.type === "documents"} onClick={() => open({ type: "documents" })} />
      </div>

      <div className="side-scroll">
        {groups.map(({ area, items }) => (
          <section key={area?.id ?? "tree"} className="side-section">
            <div className="side-head">
              <span className="label ellipsis">{area ? area.name : "Studienstruktur"}</span>
              <IconButton label="Hinzufügen" className="side-add" onClick={(e) => addMenu(e.currentTarget, area?.id)}>
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
                  <KindIcon kind={n.kind} />
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

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`nav-item ${active ? "is-active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}>
      {icon}
      <span>{label}</span>
    </button>
  );
}
